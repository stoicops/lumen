import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath, stat, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ReaAdapter } from '../core/rea-adapter.mjs';
import { ProjectStore, report } from '../core/projects.mjs';
import { discoverModels, askEvidence } from '../core/local-model.mjs';
const here = dirname(fileURLToPath(import.meta.url));
let window, store, active;
function trusted(event) { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC caller'); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { trusted(event); return fn(...args); }); }
await app.whenReady();
store = new ProjectStore(join(app.getPath('userData'), 'projects')); await store.recover();
session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
// Renderer cannot fetch any network resource. Local AI runs in the main process.
session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
window = new BrowserWindow({ width: 1280, height: 860, minWidth: 850, minHeight: 650, title: 'Lumen — Local Software Studio', backgroundColor: '#10131b', webPreferences: { preload: join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
handle('choose', async () => { const result = await dialog.showOpenDialog(window, { title: 'Select JavaScript app folder or ASAR', properties: ['openFile', 'openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
handle('projects', () => store.list());
handle('models', () => discoverModels());
handle('cancel', async () => {
  if (!active) return false;
  // Persist the request before aborting; `cancelled` is only written after cleanup is confirmed.
  active.project.status = 'cancelling'; active.project.cancelRequestedAt = new Date().toISOString();
  await store.save(active.project); active.controller.abort(); return true;
});
handle('analyze', async path => {
  if (active) throw new Error('Another analysis is running');
  if (typeof path !== 'string' || !path || path.length > 4096 || path !== resolve(path)) throw new Error('Select an absolute local target path');
  const target = await realpath(path); const info = await stat(target);
  if (!info.isDirectory() && !target.toLowerCase().endsWith('.asar')) throw new Error('Milestone one accepts JavaScript app folders and ASAR files');
  const project = await store.create(target); const adapter = new ReaAdapter(); const controller = new AbortController();
  let finished; active = { controller, adapter, project, done: new Promise(r => { finished = r; }) };
  project.status = 'running'; project.startedAt = new Date().toISOString(); await store.save(project);
  const progress = value => { const update = { projectId: project.id, ...value }; if (!window.isDestroyed()) window.webContents.send('progress', update); };
  let outcome;
  try {
    progress({ message: 'Connecting to local REA engine' });
    project.engine = await adapter.connect({ signal: controller.signal });
    if (controller.signal.aborted) throw new Error('Cancelled before analysis');
    project.evidence = await adapter.analyze(target, { signal: controller.signal, onprogress: progress });
    if (controller.signal.aborted) throw new Error('Cancelled before export');
    progress({ message: 'Saving complete evidence bundle' });
    await adapter.export(join(store.path(project.id), 'evidence.json'), { signal: controller.signal });
    outcome = controller.signal.aborted ? 'cancelled' : 'completed';
  } catch (error) { outcome = controller.signal.aborted ? 'cancelled' : 'failed'; if (outcome === 'failed') project.error = String(error.message ?? error); }
  finally {
    if (controller.signal.aborted) progress({ message: 'Stopping engine and confirming cleanup' });
    try { project.cleanup = await adapter.close(); } catch (error) { project.cleanup = { verified: false, reason: String(error.message ?? error) }; }
    if (!project.cleanup.verified) project.cleanupWarning = `Engine cleanup not confirmed: ${project.cleanup.reason ?? 'unknown'}. Check for leftover REA processes before retrying.`;
    // A cancellation is only reported as `cancelled` once the engine is confirmed stopped.
    project.status = outcome === 'cancelled' && !project.cleanup.verified ? 'cancelling' : outcome;
    if (outcome === 'cancelled') project.evidence = undefined; // never expose a partial result after cancel
    project.finishedAt = new Date().toISOString();
    active = null; await store.save(project); finished();
  }
  progress({ message: project.status }); return project;
});
handle('ask', async input => {
  if (!input || typeof input !== 'object') throw new Error('Invalid chat request');
  const project = await store.get(input.projectId);
  if (!project.evidence) throw new Error('Analyze an app first');
  return askEvidence({ endpoint: input.endpoint, model: input.model, question: input.question, evidence: project.evidence });
});
handle('export', async id => {
  const project = await store.get(id);
  const result = await dialog.showSaveDialog(window, { defaultPath: `${project.name.replace(/[^a-z0-9_-]/gi, '_')}-report.md`, filters: [{ name: 'Markdown report', extensions: ['md'] }] });
  if (result.canceled) return false;
  await writeFile(result.filePath, report(project), 'utf8');
  if (project.status === 'completed') await copyFile(join(store.path(id), 'evidence.json'), `${result.filePath}.${randomUUID()}.evidence.json`);
  return true;
});
await window.loadFile(join(here, '../../dist/index.html'));
let quitting = false;
app.on('before-quit', event => {
  if (!active || quitting) return;
  // Hold quit until the engine is confirmed stopped, bounded so a stuck engine cannot block exit forever.
  event.preventDefault(); quitting = true; active.controller.abort();
  Promise.race([active.done, new Promise(r => setTimeout(r, 15000))]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
