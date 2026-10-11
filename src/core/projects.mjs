import { mkdir, rm } from 'node:fs/promises';
import { mkdirSync, readdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describeEvidence, friendlyError } from './findings.mjs';
// Project store: SQLite (node:sqlite, built into Node/Electron) for metadata, job events and
// conversations; large evidence bundles stay as files in each project's folder. Every write is a
// transaction. Older JSON projects are imported once; unreadable records are listed, not hidden.
const MIGRATIONS = [
  `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, data TEXT NOT NULL);
   CREATE TABLE job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     at TEXT NOT NULL, kind TEXT NOT NULL, message TEXT);
   CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL, title TEXT);
   CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL, content TEXT NOT NULL, at TEXT NOT NULL, meta TEXT);
   CREATE INDEX job_events_project ON job_events(project_id, id);
   CREATE INDEX messages_conversation ON messages(conversation_id, id);`,
];
const COLUMNS = new Set(['id', 'name', 'target', 'status', 'createdAt', 'startedAt', 'finishedAt']);
const now = () => new Date().toISOString();

export class ProjectStore {
  constructor(root) {
    this.root = root; mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, 'lumen.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT version FROM schema_version').get();
    let version = row?.version ?? 0;
    if (!row) this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    for (; version < MIGRATIONS.length; version++) this.tx(() => { this.db.exec(MIGRATIONS[version]); this.db.prepare('UPDATE schema_version SET version = ?').run(version + 1); });
    this.unreadable = [];
    this.importLegacy();
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  close() { this.db.close(); }
  path(id) { if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid project ID'); return join(this.root, id); }

  // One-time import of pre-database projects (project.json per folder).
  importLegacy() {
    const known = new Set(this.db.prepare('SELECT id FROM projects').all().map(r => r.id));
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || known.has(entry.name) || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      const file = join(this.root, entry.name, 'project.json');
      if (!existsSync(file)) continue;
      try { const p = JSON.parse(readFileSync(file, 'utf8')); if (p.id !== entry.name) throw new Error('ID does not match its folder'); this.write(p); renameSync(file, `${file}.imported`); }
      catch (error) { this.unreadable.push({ id: entry.name, name: entry.name, status: 'unreadable', createdAt: '', error: `Saved project could not be read: ${error.message}` }); }
    }
  }
  write(project) {
    const data = Object.fromEntries(Object.entries(project).filter(([k]) => !COLUMNS.has(k)));
    this.tx(() => this.db.prepare(`INSERT INTO projects (id, name, target, status, created_at, started_at, finished_at, data) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, target=excluded.target, status=excluded.status, started_at=excluded.started_at, finished_at=excluded.finished_at, data=excluded.data`)
      .run(project.id, project.name, project.target, project.status, project.createdAt, project.startedAt ?? null, project.finishedAt ?? null, JSON.stringify(data)));
  }
  read(row) {
    try { return { ...JSON.parse(row.data), id: row.id, name: row.name, target: row.target, status: row.status, createdAt: row.created_at, startedAt: row.started_at ?? undefined, finishedAt: row.finished_at ?? undefined }; }
    catch (error) { return { id: row.id, name: row.name, target: row.target, status: 'unreadable', createdAt: row.created_at, error: `Saved details are damaged: ${error.message}` }; }
  }
  async save(project) { this.path(project.id); await mkdir(this.path(project.id), { recursive: true, mode: 0o700 }); this.write(project); return project; }
  async create(target) { return this.save({ schemaVersion: 2, id: randomUUID(), name: target.split(/[\\/]/).filter(Boolean).pop(), target, createdAt: now(), status: 'queued' }); }
  async get(id) { this.path(id); const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id); if (!row) throw new Error('Project not found'); return this.read(row); }
  async list() {
    const rows = this.db.prepare('SELECT id, name, target, status, created_at, started_at, finished_at, data FROM projects ORDER BY created_at DESC').all();
    // Lists stay light: drop evidence and scan payloads, which views load by ID.
    return [...rows.map(r => { const { evidence, secrets, engine, ...rest } = this.read(r); return { ...rest, hasEvidence: Boolean(evidence) }; }), ...this.unreadable];
  }
  async delete(id) {
    this.path(id);
    this.tx(() => this.db.prepare('DELETE FROM projects WHERE id = ?').run(id));
    this.unreadable = this.unreadable.filter(p => p.id !== id);
    await rm(this.path(id), { recursive: true, force: true });
  }
  async recover() {
    for (const p of await this.list()) if (['queued', 'running', 'cancelling'].includes(p.status)) {
      const full = await this.get(p.id);
      this.write({ ...full, status: 'interrupted', error: 'Lumen closed during analysis. Start a new analysis to retry.' });
      this.event(p.id, 'interrupted', 'Found unfinished on start-up');
    }
  }
  event(projectId, kind, message = null) { this.db.prepare('INSERT INTO job_events (project_id, at, kind, message) VALUES (?,?,?,?)').run(projectId, now(), kind, message === null ? null : String(message).slice(0, 2000)); }
  events(projectId) { return this.db.prepare('SELECT at, kind, message FROM job_events WHERE project_id = ? ORDER BY id').all(projectId); }

  // Conversations
  conversations(projectId) { return this.db.prepare(`SELECT c.id, c.created_at AS createdAt, c.title, COUNT(m.id) AS messages FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id WHERE c.project_id = ? GROUP BY c.id ORDER BY c.created_at DESC`).all(projectId); }
  createConversation(projectId, title) { const id = randomUUID(); this.db.prepare('INSERT INTO conversations (id, project_id, created_at, title) VALUES (?,?,?,?)').run(id, projectId, now(), String(title).slice(0, 120)); return id; }
  conversationProject(id) { return this.db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(id)?.project_id ?? null; }
  messages(conversationId) { return this.db.prepare('SELECT id, role, content, at, meta FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId).map(m => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })); }
  addMessage(conversationId, role, content, meta = null) { return Number(this.db.prepare('INSERT INTO messages (conversation_id, role, content, at, meta) VALUES (?,?,?,?,?)').run(conversationId, role, content, now(), meta ? JSON.stringify(meta) : null).lastInsertRowid); }
  deleteConversation(id) { this.tx(() => this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)); }
}
// Markdown handoff designed to paste into Claude or another assistant. Built from the same projection
// as the UI so it never states more than the evidence; home-folder paths are shortened to ~.
export function report(project, { home, security } = {}) {
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
    ...(security ? ['', '## Security checks', '', 'From REA facts and Lumen\'s read-only key scan. Things to review, not proof of a vulnerability. Keys are masked.', '',
      ...security.findings.filter(f => f.severity !== 'pass').map(f => `- **${f.severity}** ${f.title}: ${f.detail}${f.location?.path ? ` (${f.location.path}${f.location.line ? ':' + f.location.line : ''})` : ''}`)] : []),
    '', '## Note for an AI assistant reading this', '', 'Answer only from the facts above and cite the field paths. Say "unknown" when the evidence does not cover something. Do not treat the coverage area names as features of the app.', '');
  return redact(out.join('\n'));
}
