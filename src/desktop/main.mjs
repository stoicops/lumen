import { app, BrowserWindow, ipcMain, dialog, session, clipboard } from 'electron';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath, stat, writeFile, copyFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ReaAdapter } from '../core/rea-adapter.mjs';
import { projectArchitecture } from '../core/graph.mjs';
import { reviewSecurity } from '../core/security.mjs';
import { scanTarget } from '../core/secret-scan.mjs';
import { analyzeLicensing } from '../core/license-scan.mjs';
import { resolveTarget } from '../core/target.mjs';
import { ProjectStore, report } from '../core/projects.mjs';
import { discoverModels, streamChat } from '../core/local-model.mjs';
import { describeEvidence } from '../core/findings.mjs';
import { buildContext, checkAnswer, buildMessages } from '../core/grounding.mjs';
const here = dirname(fileURLToPath(import.meta.url));
// Electron's fs treats .asar files as folders; the key scan must read the raw archive bytes.
async function scanWithoutAsarShim(fn, target, signal) {
  const previous = process.noAsar; process.noAsar = true;
  try { return await fn(target, { signal }); } finally { process.noAsar = previous; }
}
async function readBundle(id) {
  const file = join(store.path(id), 'evidence.json');
  let info; try { info = await stat(file); } catch { return { unavailable: 'No saved evidence bundle for this analysis.' }; }
  // Bounded read: the full bundle stays on disk; only projections cross IPC.
  if (info.size > 64 * 1024 * 1024) return { unavailable: `Evidence bundle is ${Math.round(info.size / 1048576)} MB; views are limited to 64 MB.` };
  return { bundle: JSON.parse(await readFile(file, 'utf8')) };
}
let window, store, active;
function trusted(event) { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC caller'); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { trusted(event); return fn(...args); }); }
// No top-level await before ready: in an ESM main module Electron emits 'ready' only after the
// module finishes evaluating, so awaiting it at top level deadlocks (window never appears).
async function start() {
store = new ProjectStore(join(app.getPath('userData'), 'projects')); await store.recover();
session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
// Renderer cannot fetch any network resource. Local AI runs in the main process.
session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
const mac = process.platform === 'darwin';
window = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 650, title: 'Lumen', show: false,
  ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' } : { backgroundColor: '#1c1c1e' }),
  webPreferences: { preload: join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
window.once('ready-to-show', () => window.show());
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
handle('choose', async () => { const result = await dialog.showOpenDialog(window, { title: 'Select JavaScript app folder or ASAR', properties: ['openFile', 'openDirectory'], message: 'Choose an app folder, a Mac .app, or an .asar file' }); return result.canceled ? null : result.filePaths[0]; });
handle('projects', () => store.list());
handle('project', id => store.get(id));
handle('licensing', async id => { const p = await store.get(id); return p.licensing ?? { unavailable: p.evidence ? 'This analysis was made before licensing review existed. Analyse the app again.' : 'Needs a completed analysis.' }; });
handle('events', id => { store.path(id); return store.events(id); });
handle('copyMarkdown', async id => { const project = await store.get(id); clipboard.writeText(report(project, { home: homedir(), security: project.evidence ? await securityFor(id) : null, licensing: project.licensing })); return true; });
handle('map', async id => {
  const { bundle, unavailable } = await readBundle(id); if (unavailable) return { unavailable };
  return projectArchitecture(bundle) ?? { unavailable: 'This evidence has no application graph to draw.' };
});
async function securityFor(id) {
  const project = await store.get(id); const { bundle } = await readBundle(id);
  return { ...reviewSecurity({ bundle, summary: project.evidence, secrets: project.secrets?.error ? null : project.secrets }), scanError: project.secrets?.error ?? null, scanned: Boolean(project.secrets) };
}
handle('security', securityFor);
handle('platform', () => process.platform);
handle('delete', async id => {
  if (typeof id !== 'string') throw new Error('Invalid project');
  if (active?.project.id === id) throw new Error('Cancel the running analysis before deleting it');
  const project = await store.get(id);
  const { response } = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1,
    message: `Delete “${project.name}”?`, detail: 'This removes the saved analysis and its evidence from Lumen. Your original app files are not touched. Reports you exported are kept.' });
  if (response !== 0) return false;
  await store.delete(id); return true;
});
handle('models', () => discoverModels());
handle('cancel', async () => {
  if (!active) return false;
  // Persist the request before aborting; `cancelled` is only written after cleanup is confirmed.
  active.project.status = 'cancelling'; active.project.cancelRequestedAt = new Date().toISOString(); store.event(active.project.id, 'cancel-requested');
  await store.save(active.project); active.controller.abort(); return true;
});
handle('analyze', async path => {
  if (active) throw new Error('Another analysis is running');
  if (typeof path !== 'string' || !path || path.length > 4096 || path !== resolve(path)) throw new Error('Select an absolute local target path');
  const resolved = await resolveTarget(await realpath(path));
  const target = resolved.target;
  const project = await store.create(target);
  project.source = path; project.resolution = resolved.kind; project.resolutionNotes = resolved.notes; const adapter = new ReaAdapter(); const controller = new AbortController();
  let finished; active = { controller, adapter, project, done: new Promise(r => { finished = r; }) };
  project.status = 'running'; project.startedAt = new Date().toISOString(); await store.save(project);
  const progress = value => { if (value.message) store.event(project.id, 'progress', value.message); const update = { projectId: project.id, ...value }; if (!window.isDestroyed()) window.webContents.send('progress', update); };
  let outcome;
  try {
    progress({ message: 'Connecting to local REA engine' });
    project.engine = await adapter.connect({ signal: controller.signal });
    if (controller.signal.aborted) throw new Error('Cancelled before analysis');
    project.evidence = await adapter.analyze(target, { signal: controller.signal, onprogress: progress });
    if (controller.signal.aborted) throw new Error('Cancelled before export');
    progress({ message: 'Saving complete evidence bundle' });
    await adapter.export(join(store.path(project.id), 'evidence.json'), { signal: controller.signal });
    progress({ message: 'Checking the files for exposed keys' });
    project.secrets = await scanWithoutAsarShim(scanTarget, target, controller.signal).catch(error => {
      if (controller.signal.aborted) throw error;
      return { error: String(error.message ?? error) };
    });
    progress({ message: 'Looking at how licensing is enforced' });
    project.licensing = await scanWithoutAsarShim(analyzeLicensing, target, controller.signal).catch(error => {
      if (controller.signal.aborted) throw error;
      return { error: String(error.message ?? error) };
    });
    outcome = controller.signal.aborted ? 'cancelled' : 'completed';
  } catch (error) { outcome = controller.signal.aborted ? 'cancelled' : 'failed'; if (outcome === 'failed') project.error = String(error.message ?? error); }
  finally {
    if (controller.signal.aborted) progress({ message: 'Stopping engine and confirming cleanup' });
    try { project.cleanup = await adapter.close(); } catch (error) { project.cleanup = { verified: false, reason: String(error.message ?? error) }; }
    if (!project.cleanup.verified) project.cleanupWarning = `Engine cleanup not confirmed: ${project.cleanup.reason ?? 'unknown'}. Check for leftover REA processes before retrying.`;
    // A cancellation is only reported as `cancelled` once the engine is confirmed stopped.
    project.status = outcome === 'cancelled' && !project.cleanup.verified ? 'cancelling' : outcome;
    if (outcome === 'cancelled') { project.evidence = undefined; project.secrets = undefined; project.licensing = undefined; } // never expose a partial result after cancel
    project.finishedAt = new Date().toISOString();
    active = null; await store.save(project); store.event(project.id, project.status, project.error ?? (project.cleanup?.verified ? 'Engine stopped (verified)' : project.cleanup?.reason)); finished();
  }
  progress({ message: project.status }); return project;
});
const chats = new Map(); // requestId -> AbortController
handle('ask', async input => {
  if (!input || typeof input !== 'object' || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 8000) throw new Error('Enter a question under 8,000 characters');
  if (typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.requestId)) throw new Error('Invalid request');
  const project = await store.get(input.projectId);
  if (!project.evidence) throw new Error('Analyse an app first');
  let conversationId = input.conversationId;
  if (conversationId && store.conversationProject(conversationId) !== project.id) throw new Error('Conversation does not belong to this project');
  const history = conversationId ? store.messages(conversationId) : [];
  conversationId ??= store.createConversation(project.id, input.question);
  const { bundle } = await readBundle(project.id);
  const context = buildContext({ view: describeEvidence(project.evidence), map: bundle ? projectArchitecture(bundle) : null, security: await securityFor(project.id) });
  store.addMessage(conversationId, 'user', input.question);
  const controller = new AbortController(); chats.set(input.requestId, controller);
  const TIMEOUT = new Error('The model took longer than 5 minutes');
  const timeout = setTimeout(() => controller.abort(TIMEOUT), 300000);
  const send = payload => { if (!window.isDestroyed()) window.webContents.send('chat', { requestId: input.requestId, conversationId, ...payload }); };
  let text = '', partial = '', stopped = false, failure = null;
  try { text = await streamChat({ endpoint: input.endpoint, model: input.model, messages: buildMessages({ contextText: context.text, history, question: input.question }), signal: controller.signal, onDelta: delta => { partial += delta; send({ delta }); } }); }
  catch (error) { text = partial; if (controller.signal.aborted && controller.signal.reason !== TIMEOUT) stopped = true; else failure = String(controller.signal.aborted ? TIMEOUT.message : error.message ?? error); }
  finally { clearTimeout(timeout); chats.delete(input.requestId); }
  if (failure && !text) { store.addMessage(conversationId, 'error', failure); throw new Error(failure); }
  const facts = context.facts.map(({ id, text }) => ({ id, text }));
  const meta = { model: input.model, check: checkAnswer(text, context.facts), facts, omitted: context.omitted, stopped, failure };
  store.addMessage(conversationId, 'assistant', text, meta);
  return { conversationId, answer: text, ...meta };
});
handle('stopAsk', requestId => { chats.get(requestId)?.abort(); return chats.has(requestId); });
handle('conversations', id => { store.path(id); return store.conversations(id); });
handle('conversation', id => { if (typeof id !== 'string' || !store.conversationProject(id)) throw new Error('Conversation not found'); return store.messages(id); });
handle('deleteConversation', id => { if (typeof id !== 'string') throw new Error('Invalid conversation'); store.deleteConversation(id); return true; });

handle('export', async id => {
  const project = await store.get(id);
  const result = await dialog.showSaveDialog(window, { defaultPath: `${project.name.replace(/[^a-z0-9_-]/gi, '_')}-lumen.md`, filters: [{ name: 'Markdown report', extensions: ['md'] }] });
  if (result.canceled) return false;
  await writeFile(result.filePath, report(project, { home: homedir(), security: project.evidence ? await securityFor(id) : null, licensing: project.licensing }), 'utf8');
  if (project.status === 'completed') await copyFile(join(store.path(id), 'evidence.json'), `${result.filePath}.${randomUUID()}.evidence.json`);
  return true;
});
await window.loadFile(join(here, '../../dist/index.html'));
}
app.whenReady().then(start).catch(error => {
  dialog.showErrorBox('Lumen could not start', String(error?.stack ?? error));
  app.exit(1);
});
let quitting = false;
app.on('before-quit', event => {
  if (!active || quitting) return;
  // Hold quit until the engine is confirmed stopped, bounded so a stuck engine cannot block exit forever.
  event.preventDefault(); quitting = true; active.controller.abort();
  Promise.race([active.done, new Promise(r => setTimeout(r, 15000))]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
