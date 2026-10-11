import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ALLOWED = new Set(['binary_session', 'analyze_javascript_application', 'inspect_analysis_view', 'get_evidence_bundle', 'export_evidence_bundle']);
export class ReaAdapter {
  async connect() {
    // Electron launches this with ELECTRON_RUN_AS_NODE; no shell, npx or downloads.
    const script = join(dirname(require.resolve('rea-agents/package.json')), 'scripts/rea.mjs');
    this.client = new Client({ name: 'lumen-local-studio', version: '0.1.0' });
    this.transport = new StdioClientTransport({ command: process.execPath, args: [script, 'mcp'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' });
    // Consume stderr without persisting potentially sensitive target paths.
    this.transport.stderr?.on('data', () => {});
    await this.client.connect(this.transport);
    const catalog = await this.client.listTools();
    for (const name of ALLOWED) if (!catalog.tools.some(t => t.name === name)) throw new Error(`REA contract missing: ${name}`);
    return this.call('binary_session', {});
  }
  async call(name, args, { signal, onprogress } = {}) {
    if (!ALLOWED.has(name)) throw new Error('Tool is outside the static-analysis allow-list');
    const result = await this.client.callTool({ name, arguments: args }, { signal, onprogress, timeout: 300000 });
    if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'REA failed');
    return result.structuredContent ?? { text: result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') };
  }
  analyze(input_path, options) { return this.call('analyze_javascript_application', { input_path, detail: 'summary', integrity_policy: 'fail' }, options); }
  export(path, options) { return this.call('export_evidence_bundle', { path, overwrite: false }, options); }
  async close() { await this.client?.close(); }
}
