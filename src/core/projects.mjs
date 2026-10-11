import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  async recover() { for (const p of await this.list()) if (['queued','running','cancelling'].includes(p.status)) await this.save({ ...p, status: 'interrupted', error: 'Application closed during analysis. Start a new analysis to retry.' }); }
}
export function report(project) {
  return `# ${project.name}\n\nStatic analysis with REA. This does not prove runtime behaviour.\n\nStatus: ${project.status}\nCreated: ${project.createdAt}\n\n## Evidence summary\n\n\`\`\`json\n${JSON.stringify(project.evidence ?? {}, null, 2)}\n\`\`\`\n\n## Limitations\n\nRetain evidence.json with this report. AI explanations are not engine evidence.\n`;
}
