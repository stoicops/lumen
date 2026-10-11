import { readFile, readdir } from 'node:fs/promises';

// Verified termination of an owned process and, where the OS lets us enumerate them, its descendants.
// Result distinguishes "we asked it to stop" from "we confirmed nothing we own is still running".

import { readFileSync } from 'node:fs';
export function alive(pid) {
  try { process.kill(pid, 0); } catch (error) { if (error.code !== 'EPERM') return false; }
  // An exited-but-unreaped (zombie) process runs no code; only Linux exposes this cheaply.
  if (process.platform === 'linux') { try { return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } }
  return true;
}

// Linux only: /proc/<pid>/task/<tid>/children. Other platforms return null = "not enumerable".
export async function descendants(pid) {
  if (process.platform !== 'linux') return null;
  const found = []; const queue = [pid];
  while (queue.length) {
    const current = queue.shift();
    let tasks; try { tasks = await readdir(`/proc/${current}/task`); } catch { continue; }
    for (const tid of tasks) {
      let text; try { text = await readFile(`/proc/${current}/task/${tid}/children`, 'utf8'); } catch { continue; }
      for (const child of text.split(/\s+/).filter(Boolean).map(Number)) if (!found.includes(child)) { found.push(child); queue.push(child); }
    }
  }
  return found;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitGone(pids, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!pids.some(alive)) return true; await sleep(25); }
  return !pids.some(alive);
}
function signal(pids, name) { for (const pid of pids) { try { process.kill(pid, name); } catch {} } }

// gracefulMs: time already allowed for a cooperative shutdown (stdin EOF) before signals.
export async function terminateTree(pid, { gracefulMs = 1000, termMs = 1500, killMs = 1500, known = [] } = {}) {
  if (!pid) return { pid: null, verified: false, reason: 'No owned process ID was recorded.' };
  // Snapshot before the parent exits: orphans get reparented and become unreachable by ancestry.
  const snapshot = await descendants(pid);
  const tree = [...new Set([...(snapshot ?? []), ...known])];
  const all = [pid, ...tree];
  let method = 'graceful';
  if (!(await waitGone(all, gracefulMs))) { method = 'SIGTERM'; signal(all, 'SIGTERM'); }
  if (method === 'SIGTERM' && !(await waitGone(all, termMs))) { method = 'SIGKILL'; signal(all.filter(alive), 'SIGKILL'); }
  const gone = await waitGone(all, killMs);
  const survivors = all.filter(alive);
  return {
    pid, method, verified: gone && snapshot !== null,
    descendantsChecked: snapshot !== null ? tree.length : 'not enumerable on this platform',
    survivors,
    reason: !gone ? `Processes still running: ${survivors.join(', ')}` : snapshot === null ? 'Engine process exited; descendant processes could not be enumerated on this platform.' : undefined,
  };
}
