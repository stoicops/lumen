import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { terminateTree, snapshotTree } from './process-cleanup.mjs';
const require = createRequire(import.meta.url);
// JavaScript/Electron deep-analysis contract (always required).
const JS_TOOLS = ['binary_session', 'analyze_javascript_application', 'inspect_analysis_view', 'get_evidence_bundle', 'export_evidence_bundle'];
// Read-only native/managed/android inspection. No execution, capture, runtime, install or mutation tools.
const NATIVE_READ = ['open_binary', 'close_binary', 'binary_overview', 'inspect_binary_layout', 'inspect_signature', 'inspect_macho',
  'inspect_pe_resources', 'inspect_plist', 'inspect_artifact', 'inspect_managed_artifact', 'inspect_managed_members',
  'inspect_android_package', 'search_android_classes', 'inspect_android_class', 'inspect_android_method', 'decode_android_resources',
  'list_strings', 'search_strings', 'list_procedures', 'search_procedures', 'procedure_pseudo_code', 'read_function_instructions',
  'list_segments', 'list_names', 'binary_session'];
const ALLOWED = new Set([...JS_TOOLS, ...NATIVE_READ]);
export const CONNECT_TIMEOUT_MS = 60000;
// Guard against an engine section so large it would blank the renderer when sent over IPC.
const MAX_SECTION_BYTES = 512 * 1024;
function cap(data) {
  try { const json = JSON.stringify(data); if (json.length <= MAX_SECTION_BYTES) return data; return { truncated: true, bytes: json.length, preview: json.slice(0, 4000) }; }
  catch { return { truncated: true, note: 'section could not be serialized' }; }
}
export class CancelledError extends Error { constructor(message = 'Cancelled') { super(message); this.name = 'CancelledError'; } }

// Rejects as soon as the signal aborts or the timeout passes, without waiting for `work`.
function bounded(work, { signal, timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError(`Cancelled during ${label}`));
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    const onAbort = () => reject(new CancelledError(`Cancelled during ${label}`));
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); });
  });
}

export class ReaAdapter {
  // `launch` exists for owned test fixtures only; the app always uses the pinned REA vector.
  // extraEnv carries optional decompiler-engine locations (e.g. GHIDRA_INSTALL_DIR) into the REA process.
  constructor({ launch, connectTimeoutMs = CONNECT_TIMEOUT_MS, extraEnv = {} } = {}) { this.launch = launch; this.connectTimeoutMs = connectTimeoutMs; this.extraEnv = extraEnv; this.pid = null; }
  defaultLaunch() {
    // Electron launches this with ELECTRON_RUN_AS_NODE; no shell, npx or downloads.
    // ELECTRON_NO_ASAR (set at spawn) stops Electron's fs from presenting .asar targets as
    // virtual folders, which made REA report ENOENT for real .asar files.
    let script = join(dirname(require.resolve('rea-agents/package.json')), 'scripts/rea.mjs');
    // In a packaged app the engine is unpacked beside the asar; run it from there, not from inside app.asar
    // (we spawn with ELECTRON_NO_ASAR=1, so a path inside app.asar would not be readable as a real file).
    script = script.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
    return { command: process.execPath, args: [script, 'mcp'] };
  }
  async connect({ signal } = {}) {
    const { command, args } = this.launch ?? this.defaultLaunch();
    this.client = new Client({ name: 'lumen-local-studio', version: '0.1.0' });
    this.transport = new StdioClientTransport({ command, args, env: { ...process.env, ...this.extraEnv, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1' }, stderr: 'pipe' });
    // Consume stderr without persisting potentially sensitive target paths.
    this.transport.stderr?.on('data', () => {});
    const handshake = (async () => {
      await this.client.connect(this.transport);
      const catalog = await this.client.listTools();
      this.tools = new Set(catalog.tools.map(t => t.name));
      // Only the JS contract is mandatory; native tools are present but may lack an engine provider.
      for (const name of JS_TOOLS) if (!this.tools.has(name)) throw new Error(`REA contract missing: ${name}`);
      return this.call('binary_session', {}, { signal });
    })();
    // Record the PID as soon as the process spawns so a cancelled connect can still be cleaned up.
    const spawnWatch = setInterval(() => { if (this.transport?.pid) { this.pid ??= this.transport.pid; clearInterval(spawnWatch); } }, 5);
    try { return await bounded(handshake, { signal, timeoutMs: this.connectTimeoutMs, label: 'engine connection' }); }
    finally { clearInterval(spawnWatch); this.pid ??= this.transport?.pid ?? null; handshake.catch(() => {}); }
  }
  async call(name, args, { signal, onprogress, timeout = 300000 } = {}) {
    if (!ALLOWED.has(name)) throw new Error('Tool is outside the static-analysis allow-list');
    const result = await this.client.callTool({ name, arguments: args }, { signal, onprogress, timeout });
    if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'REA failed');
    return result.structuredContent ?? { text: result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') };
  }
  analyze(input_path, options) { return this.call('analyze_javascript_application', { input_path, detail: 'summary', integrity_policy: 'fail' }, options); }

  // Soft call: returns {ok, data} or {ok:false, code, message} instead of throwing, so one unavailable
  // native tool (e.g. no decompiler engine) does not abort the whole inspection.
  async tryCall(name, args, options) {
    if (!this.tools?.has(name)) return { ok: false, code: 'not_present', message: `${name} is not offered by this engine build.` };
    try { return { ok: true, data: await this.call(name, args, options) }; }
    catch (error) { const text = String(error.message ?? error); const code = /provider_unavailable|capability_unavailable|unsupported/i.test(text) ? 'engine_required' : 'error'; return { ok: false, code, message: text.slice(0, 400) }; }
  }

  // Identify and inspect a native / managed / android target. Pass providerId (e.g. 'ghidra') to engage
  // a decompiler — open_binary only loads one when a provider is named. Ghidra's import is slow, hence the
  // long timeout. Without a provider we still return format, architecture, signature and layout.
  async inspectNative(path, { signal, providerId, onprogress } = {}) {
    // Ghidra import/analysis can take minutes; allow up to 20 so it is not cut off.
    let opened = providerId ? await this.tryCall('open_binary', { path, provider_id: providerId }, { signal, onprogress, timeout: 1200000 }) : { ok: false };
    let engineOpenError = null;
    if (providerId && !opened.ok) { engineOpenError = opened.message; opened = { ok: false }; } // fall back to identification
    if (!opened.ok) opened = await this.tryCall('open_binary', { path }, { signal, timeout: 120000 });
    if (!opened.ok) return { opened: false, reason: opened.message, providerId: providerId ?? null };
    const identity = opened.data?.result ?? opened.data;
    const overview = engineOpenError ? { ok: false, message: engineOpenError } : await this.tryCall('binary_overview', {}, { signal, timeout: 1200000 });
    const engineReady = overview.ok;
    const sections = {};
    for (const [key, name, args] of [
      ['signature', 'inspect_signature', {}],
      ['layout', 'inspect_binary_layout', { path }],
      ['macho', 'inspect_macho', { path }],
      ['pe_resources', 'inspect_pe_resources', { path }],
      ['plist', 'inspect_plist', { path }],
      ['android', 'inspect_android_package', { path }],
      ['managed', 'inspect_managed_artifact', { path }],
    ]) { const r = await this.tryCall(name, args, { signal }); if (r.ok) sections[key] = cap(r.data); }
    // Deep sections only when an engine is present. Keep ONLY the bounded overview — pulling full
    // list_strings / list_procedures can be tens of MB, which over IPC can blank the renderer. Detailed
    // listings are fetched on demand later, not bundled into the project record.
    if (engineReady) sections.overview = cap(overview.data);
    return { opened: true, identity, engineReady, engineMessage: engineReady ? null : overview.message, sections };
  }
  export(path, options) { return this.call('export_evidence_bundle', { path, overwrite: false }, options); }
  // Returns a cleanup record; `verified` is true only when the owned process and every enumerated descendant are gone.
  async close() {
    const pid = this.pid ?? this.transport?.pid ?? null;
    const snapshot = await snapshotTree(pid);
    // Start the SDK close (stdin EOF) but never trust it alone: it does not await exit after SIGKILL.
    const sdkClose = this.client?.close().catch(() => {});
    const cleanup = await terminateTree(pid, { gracefulMs: 2000, snapshot });
    await Promise.race([sdkClose, new Promise(r => setTimeout(r, 500).unref())]);
    return cleanup;
  }
}
