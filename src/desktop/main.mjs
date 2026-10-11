import { app, BrowserWindow, ipcMain, dialog, session, clipboard } from 'electron';
import { homedir, freemem, totalmem } from 'node:os';
import { dirname, join, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath, stat, writeFile, copyFile, readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ReaAdapter } from '../core/rea-adapter.mjs';
import { projectArchitecture } from '../core/graph.mjs';
import { reviewSecurity } from '../core/security.mjs';
import { scanTarget } from '../core/secret-scan.mjs';
import { analyzeLicensing } from '../core/license-scan.mjs';
import { resolveTarget } from '../core/target.mjs';
import { identify, KINDS } from '../core/identify.mjs';
import { openDmg } from '../core/dmg.mjs';
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
let window, store, active, settingsPath;
function readSettings() { try { return JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return {}; } }
function writeSettings(next) { const merged = { ...readSettings(), ...next }; writeFileSync(settingsPath, JSON.stringify(merged, null, 2), { mode: 0o600 }); return merged; }
// A macOS GUI app inherits a minimal PATH and no JAVA_HOME, so Ghidra cannot find Java 21. Resolve a
// JDK (settings override, else /usr/libexec/java_home -v 21) and augment PATH with common tool dirs.
// macOS keeps most RAM in reclaimable caches, so os.freemem() drastically understates what is usable.
// Estimate available memory from vm_stat (free + inactive + speculative + purgeable pages).
function availableMemGiB() {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('/usr/bin/vm_stat', [], { encoding: 'utf8', timeout: 3000 });
      const page = Number(out.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
      const pages = name => Number(out.match(new RegExp(`Pages ${name}:\\s+(\\d+)`))?.[1] ?? 0);
      const usable = (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page;
      if (usable > 0) return usable / 1073741824;
    } catch {}
  }
  return freemem() / 1073741824;
}
function resolveJavaHome(settings) {
  if (settings.javaHome) return settings.javaHome;
  if (process.platform === 'darwin') {
    for (const v of ['21', '21+']) { try { const home = execFileSync('/usr/libexec/java_home', ['-v', v], { encoding: 'utf8', timeout: 5000 }).trim(); if (home) return home; } catch {} }
  }
  return process.env.JAVA_HOME ?? null;
}
// Decompiler-engine locations passed into REA (e.g. GHIDRA_INSTALL_DIR). Only set when configured.
const reaScript = () => { const require = createRequire(import.meta.url); let s = join(dirname(require.resolve('rea-agents/package.json')), 'scripts', 'rea.mjs'); return s.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`); };
// Runs REA's own diagnostics for the configured engine. Fixed script path, no shell, bounded.
function diagnoseEngine() {
  return new Promise(resolve => {
    execFile(process.execPath, [reaScript(), 'doctor', '--json'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...engineEnv(), ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout) => {
      let report; try { report = JSON.parse(stdout); } catch { report = null; }
      const ghidra = report?.scope_checks?.find(c => c.name === 'ghidra') ?? null;
      // The real availability verdict lives in providerInspections, not the folder check. Pull it and
      // the first failing sub-check (e.g. analyzeHeadless not executable) so the true blocker is shown.
      const inspection = report?.providerInspections?.find(p => p.id === 'ghidra') ?? null;
      const failing = inspection?.checks?.find(c => !c.ok) ?? null;
      resolve({ ok: Boolean(report), ghidra, available: inspection?.available ?? null, failing, javaHome: engineEnv().JAVA_HOME ?? null, checks: report?.scope_checks ?? [], raw: stdout?.slice(0, 20000) ?? String(err?.message ?? 'no output') });
    });
  });
}
// GHIDRA_INSTALL_DIR must be the release root (the folder containing Ghidra/application.properties).
// People commonly pick one level too deep (the inner Ghidra/) or one too shallow (the Downloads parent);
// normalise both so a reasonable pick just works.
function normalizeGhidraDir(dir) {
  const isRoot = d => { try { return existsSync(join(d, 'Ghidra', 'application.properties')); } catch { return false; } };
  if (!dir) return dir;
  if (isRoot(dir)) return dir;
  if (basename(dir) === 'Ghidra' && isRoot(dirname(dir))) return dirname(dir);     // pointed at inner Ghidra/
  try { for (const name of readdirSync(dir)) if (/ghidra/i.test(name) && isRoot(join(dir, name))) return join(dir, name); } catch {} // pointed at parent
  return dir; // leave as-is; diagnostics will report the problem
}
function engineEnv() {
  const s = readSettings(); const env = {};
  if (typeof s.ghidraDir === 'string' && s.ghidraDir) env.GHIDRA_INSTALL_DIR = normalizeGhidraDir(s.ghidraDir);
  const maxmem = (typeof s.ghidraMaxMem === 'string' && /^\d+[GM]$/.test(s.ghidraMaxMem)) ? s.ghidraMaxMem : '1G';
  if (env.GHIDRA_INSTALL_DIR) env.GHIDRA_HEADLESS_MAXMEM = maxmem;
  const javaHome = resolveJavaHome(s);
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    // Put the JDK (and, on POSIX, the usual package-manager bins) on PATH so Ghidra finds java.
    // Use the platform's PATH separator — ':' on POSIX, ';' on Windows.
    const extra = process.platform === 'win32' ? [join(javaHome, 'bin')] : [join(javaHome, 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    const PATH_KEY = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[PATH_KEY] = [...extra, process.env[PATH_KEY] ?? ''].filter(Boolean).join(sep === '\\' ? ';' : ':');
  }
  return env;
}
function trusted(event) { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC caller'); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { trusted(event); return fn(...args); }); }
// No top-level await before ready: in an ESM main module Electron emits 'ready' only after the
// module finishes evaluating, so awaiting it at top level deadlocks (window never appears).
async function start() {
settingsPath = join(app.getPath('userData'), 'settings.json');
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
handle('native', async id => { const p = await store.get(id); return p.native ?? { unavailable: 'No native inspection for this analysis.' }; });
handle('settings', () => readSettings());
handle('saveSettings', next => { if (!next || typeof next !== 'object') throw new Error('Invalid settings'); const clean = {}; if ('ghidraDir' in next) clean.ghidraDir = typeof next.ghidraDir === 'string' ? next.ghidraDir : ''; if ('javaHome' in next) clean.javaHome = typeof next.javaHome === 'string' ? next.javaHome : ''; if ('ghidraMaxMem' in next) clean.ghidraMaxMem = typeof next.ghidraMaxMem === 'string' ? next.ghidraMaxMem : ''; return writeSettings(clean); });
handle('diagnoseEngine', () => diagnoseEngine());
handle('prepareGhidra', async () => {
  const dir = engineEnv().GHIDRA_INSTALL_DIR;
  if (!dir || process.platform !== 'darwin') return { ok: false, message: 'No Ghidra folder set, or not macOS.' };
  const steps = [];
  const run = (bin, args) => new Promise(r => execFile(bin, args, { timeout: 60000 }, (e) => r(!e)));
  // Remove the download quarantine that blocks Ghidra's helper scripts, and ensure they are executable.
  steps.push(['Cleared download quarantine', await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dir])]);
  steps.push(['Made analyzeHeadless executable', await run('/bin/chmod', ['-R', '+x', join(dir, 'support')])]);
  steps.push(['Made ghidraRun executable', await run('/bin/chmod', ['+x', join(dir, 'ghidraRun')])]);
  return { ok: steps.every(s => s[1]), steps: steps.map(([label, ok]) => ({ label, ok })) };
});
handle('pickFolder', async () => { const r = await dialog.showOpenDialog(window, { title: 'Select your Ghidra install folder', properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
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
// On-demand deep decompilation: launched only when the user explicitly asks, never on drop. Runs the
// Ghidra engine in its own bounded session with the memory guard, and stores the result on the project.
let decompiling = null;
handle('decompile', async id => {
  if (decompiling) throw new Error('A decompilation is already running');
  const project = await store.get(id);
  const target = project.analysisTarget || project.target;
  if (!engineEnv().GHIDRA_INSTALL_DIR) throw new Error('Set a Ghidra folder in Settings first');
  const need = (parseInt(engineEnv().GHIDRA_HEADLESS_MAXMEM) || 1) + 1.5;
  const free = availableMemGiB();
  if (free < need) return { skipped: `Only about ${free.toFixed(1)} GB free; Ghidra needs ~${need.toFixed(1)} GB. Close other apps (and unload your local AI model), or lower the Ghidra memory limit in Settings.` };
  const adapter = new ReaAdapter({ extraEnv: engineEnv() }); const controller = new AbortController();
  decompiling = { adapter, controller };
  try {
    await adapter.connect({ signal: controller.signal });
    const native = await adapter.inspectNative(target, { signal: controller.signal, providerId: 'ghidra' });
    native.engineConfigured = true;
    const full = await store.get(id); full.native = native; await store.save(full);
    return native;
  } finally { try { await adapter.close(); } catch {} decompiling = null; }
});
handle('cancelDecompile', () => { decompiling?.controller.abort(); return Boolean(decompiling); });
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
  const real = await realpath(path);
  // Identify first so we route natives (.exe/Mach-O/ELF/APK/.NET) to inspection and JS/Electron to deep analysis.
  const topKind = (await identify(real)).kind;
  const family = KINDS[topKind]?.family ?? 'unknown';
  const resolved = family === 'js' || family === 'container' || family === 'unknown' ? await resolveTarget(real) : { target: real, kind: topKind, notes: [] };
  const target = resolved.target;
  // The resolved target may differ (e.g. .app → inner app.asar); re-identify it for the stored kind.
  const kind = resolved.target === real ? topKind : (await identify(resolved.target)).kind;
  const project = await store.create(target);
  project.source = path; project.resolution = resolved.kind; project.resolutionNotes = resolved.notes;
  project.kind = kind; project.family = KINDS[kind]?.family ?? 'unknown';
  const adapter = new ReaAdapter({ extraEnv: engineEnv() }); const controller = new AbortController();
  let finished, dmg = null; active = { controller, adapter, project, done: new Promise(r => { finished = r; }) };
  project.status = 'running'; project.startedAt = new Date().toISOString(); await store.save(project);
  const progress = value => { if (value.message) store.event(project.id, 'progress', value.message); const update = { projectId: project.id, ...value }; if (!window.isDestroyed()) window.webContents.send('progress', update); };
  let outcome;
  try {
    let analysisTarget = target;
    if (project.kind === 'dmg') {
      progress({ message: 'Mounting the disk image' });
      dmg = await openDmg(target, { signal: controller.signal });
      analysisTarget = dmg.asar; project.family = 'js'; project.kind = 'asar';
      project.resolutionNotes = [...(project.resolutionNotes ?? []), 'Mounted the disk image and found the app inside it.'];
    }
    progress({ message: 'Connecting to local REA engine' });
    project.engine = await adapter.connect({ signal: controller.signal });
    if (controller.signal.aborted) throw new Error('Cancelled before analysis');
    if (project.family === 'js') {
      project.evidence = await adapter.analyze(analysisTarget, { signal: controller.signal, onprogress: progress });
      if (controller.signal.aborted) throw new Error('Cancelled before export');
      progress({ message: 'Saving complete evidence bundle' });
      await adapter.export(join(store.path(project.id), 'evidence.json'), { signal: controller.signal });
      progress({ message: 'Checking the files for exposed keys' });
      project.secrets = await scanWithoutAsarShim(scanTarget, analysisTarget, controller.signal).catch(error => { if (controller.signal.aborted) throw error; return { error: String(error.message ?? error) }; });
      progress({ message: 'Looking at how licensing is enforced' });
      project.licensing = await scanWithoutAsarShim(analyzeLicensing, analysisTarget, controller.signal).catch(error => { if (controller.signal.aborted) throw error; return { error: String(error.message ?? error) }; });
    } else {
      // Native / managed / android: identification only on drop (instant, safe). Deep decompilation is
      // heavy (a Ghidra JVM) and is launched explicitly later via the 'decompile' action, never on drop.
      progress({ message: `Inspecting ${KINDS[project.kind]?.label ?? 'binary'}` });
      project.native = await adapter.inspectNative(analysisTarget, { signal: controller.signal });
      project.native.engineConfigured = Boolean(engineEnv().GHIDRA_INSTALL_DIR);
      project.native.engineAvailable = Boolean(engineEnv().GHIDRA_INSTALL_DIR); // offer the on-demand button
      project.analysisTarget = analysisTarget;
    }
    outcome = controller.signal.aborted ? 'cancelled' : 'completed';
  } catch (error) { outcome = controller.signal.aborted ? 'cancelled' : 'failed'; if (outcome === 'failed') project.error = String(error.message ?? error); }
  finally {
    if (dmg) { try { await dmg.detach(); } catch {} }
    if (controller.signal.aborted) progress({ message: 'Stopping engine and confirming cleanup' });
    try { project.cleanup = await adapter.close(); } catch (error) { project.cleanup = { verified: false, reason: String(error.message ?? error) }; }
    if (!project.cleanup.verified) project.cleanupWarning = `Engine cleanup not confirmed: ${project.cleanup.reason ?? 'unknown'}. Check for leftover REA processes before retrying.`;
    // A cancellation is only reported as `cancelled` once the engine is confirmed stopped.
    project.status = outcome === 'cancelled' && !project.cleanup.verified ? 'cancelling' : outcome;
    if (outcome === 'cancelled') { project.evidence = undefined; project.secrets = undefined; project.licensing = undefined; project.native = undefined; } // never expose a partial result after cancel
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
