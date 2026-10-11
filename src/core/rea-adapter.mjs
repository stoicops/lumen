import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { terminateTree, snapshotTree } from './process-cleanup.mjs';
const require = createRequire(import.meta.url);
const ALLOWED = new Set(['binary_session', 'analyze_javascript_application', 'inspect_analysis_view', 'get_evidence_bundle', 'export_evidence_bundle']);
export const CONNECT_TIMEOUT_MS = 60000;
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
  constructor({ launch, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) { this.launch = launch; this.connectTimeoutMs = connectTimeoutMs; this.pid = null; }
  defaultLaunch() {
    // Electron launches this with ELECTRON_RUN_AS_NODE; no shell, npx or downloads.
    // ELECTRON_NO_ASAR (set at spawn) stops Electron's fs from presenting .asar targets as
    // virtual folders, which made REA report ENOENT for real .asar files.
    const script = join(dirname(require.resolve('rea-agents/package.json')), 'scripts/rea.mjs');
    return { command: process.execPath, args: [script, 'mcp'] };
  }
  async connect({ signal } = {}) {
    const { command, args } = this.launch ?? this.defaultLaunch();
    this.client = new Client({ name: 'lumen-local-studio', version: '0.1.0' });
    this.transport = new StdioClientTransport({ command, args, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1' }, stderr: 'pipe' });
    // Consume stderr without persisting potentially sensitive target paths.
    this.transport.stderr?.on('data', () => {});
    const handshake = (async () => {
      await this.client.connect(this.transport);
      const catalog = await this.client.listTools();
      for (const name of ALLOWED) if (!catalog.tools.some(t => t.name === name)) throw new Error(`REA contract missing: ${name}`);
      return this.call('binary_session', {}, { signal });
    })();
    // Record the PID as soon as the process spawns so a cancelled connect can still be cleaned up.
    const spawnWatch = setInterval(() => { if (this.transport?.pid) { this.pid ??= this.transport.pid; clearInterval(spawnWatch); } }, 5);
    try { return await bounded(handshake, { signal, timeoutMs: this.connectTimeoutMs, label: 'engine connection' }); }
    finally { clearInterval(spawnWatch); this.pid ??= this.transport?.pid ?? null; handshake.catch(() => {}); }
  }
  async call(name, args, { signal, onprogress } = {}) {
    if (!ALLOWED.has(name)) throw new Error('Tool is outside the static-analysis allow-list');
    const result = await this.client.callTool({ name, arguments: args }, { signal, onprogress, timeout: 300000 });
    if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'REA failed');
    return result.structuredContent ?? { text: result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') };
  }
  analyze(input_path, options) { return this.call('analyze_javascript_application', { input_path, detail: 'summary', integrity_policy: 'fail' }, options); }
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
