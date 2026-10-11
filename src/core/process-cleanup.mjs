import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';

// Verified termination of an owned process and, where the OS lets us enumerate them, its descendants.
// Result distinguishes "we asked it to stop" from "we confirmed nothing we own is still running".

import { readFileSync } from 'node:fs';
export function alive(pid) {
  try { process.kill(pid, 0); } catch (error) { if (error.code !== 'EPERM') return false; }
  // An exited-but-unreaped (zombie) process runs no code; only Linux exposes this cheaply.
  if (process.platform === 'linux') { try { return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } }
  return true;
}

// Linux: /proc/<pid>/task/<tid>/children. macOS/other POSIX: the system ps process table.
// Windows returns null = "not enumerable", which keeps cleanup reported as unverified.
export async function descendants(pid, { method = process.platform === 'linux' ? 'proc' : process.platform === 'win32' ? 'win' : 'ps' } = {}) {
  if (method === 'proc') return procDescendants(pid);
  if (method === 'ps') return psDescendants(pid);
  if (method === 'win') return winDescendants(pid);
  return null;
}

// Windows: PowerShell CIM gives ProcessId,ParentProcessId for every process. Bounded; failure = null.
async function winDescendants(pid) {
  const table = await new Promise(resolve => execFile('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }'],
    { timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout)));
  if (table === null) return null;
  const children = new Map();
  for (const line of table.split(/\r?\n/)) {
    const [child, parent] = line.trim().split(',').map(Number);
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  if (![...children.values()].some(list => list.includes(pid))) return null;
  const found = []; const queue = [pid];
  while (queue.length) for (const child of children.get(queue.shift()) ?? []) if (!found.includes(child)) { found.push(child); queue.push(child); }
  return found;
}

async function procDescendants(pid) {
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

// Fixed absolute path, no shell, bounded time/output. Missing or failing ps means "not enumerable", never "none".
const PS = ['/bin/ps', '/usr/bin/ps'];
function runPs(binary) {
  return new Promise(resolve => execFile(binary, ['-A', '-o', 'pid=,ppid='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024, env: { LC_ALL: 'C' } }, (error, stdout) => resolve(error ? null : stdout)));
}
async function psDescendants(pid) {
  let table = null;
  for (const binary of PS) { table = await runPs(binary); if (table !== null) break; }
  if (table === null) return null;
  const children = new Map();
  for (const line of table.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  // The engine itself must appear, otherwise this ps output cannot be trusted for this process.
  if (![...children.values()].some(list => list.includes(pid))) return null;
  const found = []; const queue = [pid];
  while (queue.length) for (const child of children.get(queue.shift()) ?? []) if (!found.includes(child)) { found.push(child); queue.push(child); }
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
// Must be taken while the engine is still running: once it exits, orphans are reparented and unreachable.
export async function snapshotTree(pid, options) { return pid && alive(pid) ? descendants(pid, options) : null; }

export async function terminateTree(pid, { gracefulMs = 1000, termMs = 1500, killMs = 1500, known = [], snapshot } = {}) {
  if (!pid) return { pid: null, verified: false, reason: 'No owned process ID was recorded.' };
  // The engine already exited on its own (common for quick jobs): nothing to kill, and no known
  // descendants left — that is a clean, verified outcome, not an "unconfirmed" one.
  if (!alive(pid) && !known.some(alive)) return { pid, method: 'already-exited', verified: true, descendantsChecked: 0, survivors: [] };
  if (snapshot === undefined) snapshot = await snapshotTree(pid);
  const tree = [...new Set([...(snapshot ?? []), ...known])];
  const all = [pid, ...tree];
  let method = 'graceful';
  if (!(await waitGone(all, gracefulMs))) { method = 'SIGTERM'; signal(all, 'SIGTERM'); }
  if (method === 'SIGTERM' && !(await waitGone(all, termMs))) { method = 'SIGKILL'; signal(all.filter(alive), 'SIGKILL'); }
  const gone = await waitGone(all, killMs);
  const survivors = all.filter(alive);
  return {
    pid, method, verified: gone && snapshot !== null,
    descendantsChecked: snapshot !== null ? tree.length : 'not enumerable',
    survivors,
    reason: !gone ? `Processes still running: ${survivors.join(', ')}` : snapshot === null ? 'Engine process exited; its child processes could not be listed (platform unsupported, ps unavailable, or engine already gone before the check).' : undefined,
  };
}
