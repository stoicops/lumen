import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describeEvidence, friendlyError } from './findings.mjs';
export class ProjectStore {
  constructor(root) { this.root = root; }
  path(id) { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid project ID'); return join(this.root, id); }
  async save(project) {
    const directory = this.path(project.id); await mkdir(directory, { recursive: true, mode: 0o700 });
    const tmp = join(directory, `project-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(project, null, 2), { mode: 0o600 });
    await rename(tmp, join(directory, 'project.json'));
    return project;
  }
  async create(target) { return this.save({ schemaVersion: 1, id: randomUUID(), name: target.split(/[\\/]/).filter(Boolean).pop(), target, createdAt: new Date().toISOString(), status: 'queued', events: [] }); }
  async get(id) { return JSON.parse(await readFile(join(this.path(id), 'project.json'), 'utf8')); }
  async list() {
    await mkdir(this.root, { recursive: true });
    const projects = [];
    for (const entry of await readdir(this.root)) { try { projects.push(await this.get(entry)); } catch {} }
    return projects.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  // Removes the project's directory (metadata, evidence bundle). Path is validated by path().
  async delete(id) { await rm(this.path(id), { recursive: true, force: true }); }
  async recover() { for (const p of await this.list()) if (['queued','running','cancelling'].includes(p.status)) await this.save({ ...p, status: 'interrupted', error: 'Application closed during analysis. Start a new analysis to retry.' }); }
}
// Markdown handoff designed to paste into Claude or another assistant. Built from the same projection
// as the UI so it never states more than the evidence; home-folder paths are shortened to ~.
export function report(project, { home } = {}) {
  const redact = text => (home && typeof text === 'string' ? text.split(home).join('~') : text);
  const view = describeEvidence(project.evidence);
  const out = [
    `# Lumen analysis: ${project.name}`, '',
    '> Static analysis by REA (https://github.com/morluto/rea), produced with Lumen. The code was read, not run, so nothing here proves runtime behaviour. Treat counts as "seen in code".', '',
    `- Status: ${project.status}`, `- Analysed: ${project.createdAt}`, `- Target: ${redact(project.target)}`,
  ];
  if (!view) {
    out.push('', '## Result', '', project.error ? `Analysis did not complete: ${friendlyError(project.error).message}` : 'No evidence was produced.');
    return redact(out.join('\n')) + '\n';
  }
  out.push(`- Format: ${view.target.format}`, `- Target SHA-256: ${view.target.sha256}`, `- Evidence ID: ${view.evidenceId}`, `- Derived from evidence: ${view.parentId}`, `- Confidence (REA): ${view.confidence}; authority: ${view.authority}`,
    '', '## In plain English', '', ...view.headline.map(l => `- ${l}`),
    '', '## What REA found (seen in code)', '', '| Finding | Count | Field |', '|---|---|---|',
    ...view.facts.filter(f => f.status === 'observed').map(f => `| ${f.label} | ${f.value} | \`${f.field}\` |`),
    '', '## Not seen in code', '', 'Not seen means no sign of it in the code REA could read, not proof of absence.', '',
    ...view.facts.filter(f => f.status !== 'observed').map(f => `- ${f.label} (\`${f.field}\`)`),
    '', '## Coverage', '', `- Files: ${view.coverage.application}; behaviour analysis: ${view.coverage.semantic}${view.coverage.truncated ? ' (truncated)' : ''}`, `- Open unknowns: ${view.coverage.unknownCount}`, '',
    '| Area | Status | Links found | Unknowns |', '|---|---|---|---|', ...view.coverage.families.map(f => `| ${f.name} | ${f.status} | ${f.relations} | ${f.unknowns} |`),
    '', '## Limitations', '', ...view.limitations.map(l => `- ${l}`),
    '', '## Unknowns', '', ...view.unknowns.map(l => `- ${l}`),
    '', '## Note for an AI assistant reading this', '', 'Answer only from the facts above and cite the field paths. Say "unknown" when the evidence does not cover something. Do not treat the coverage area names as features of the app.', '');
  return redact(out.join('\n'));
}
