// Mount a macOS .dmg read-only, find an Electron app.asar inside, and always detach afterwards.
// macOS only (uses /usr/bin/hdiutil). Read-only, -nobrowse, no autoopen; never runs anything from it.
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const run = (bin, args, { timeout = 60000 } = {}) => new Promise((resolve, reject) =>
  execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { LC_ALL: 'C' } }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).slice(0, 300))) : resolve(stdout)));

// hdiutil attach -plist lists system-entities; a mounted filesystem entry has a <key>mount-point</key>
// followed by its <string>. Return the first absolute mount-point string.
export function parseMountPoint(plist) {
  const m = plist.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  return m && m[1].startsWith('/') ? m[1] : null;
}

async function findAppAsar(root, depth = 0) {
  if (depth > 4) return null;
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch { return null; }
  // Prefer a top-level .app bundle's app.asar.
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(root, e.name);
    if (e.isDirectory() && e.name.endsWith('.app')) {
      const asar = join(p, 'Contents', 'Resources', 'app.asar');
      try { if ((await stat(asar)).isFile()) return asar; } catch {}
    }
  }
  for (const e of entries) { if (e.isDirectory() && !e.isSymbolicLink() && !e.name.endsWith('.app')) { const found = await findAppAsar(join(root, e.name), depth + 1); if (found) return found; } }
  return null;
}

// Mounts, returns { asar, detach }. Caller must call detach() when done (even on error downstream).
export async function openDmg(file, { signal } = {}) {
  if (process.platform !== 'darwin') throw new Error('Disk images (.dmg) can be opened automatically only on macOS. Double-click the .dmg and point Lumen at the app inside.');
  const plist = await run('/usr/bin/hdiutil', ['attach', '-plist', '-readonly', '-nobrowse', '-noautoopen', '-noverify', file]);
  const mount = parseMountPoint(plist);
  const detach = async () => { if (mount) { try { await run('/usr/bin/hdiutil', ['detach', '-force', mount]); } catch {} } };
  try {
    if (!mount) throw new Error('The disk image mounted but Lumen could not locate its volume.');
    signal?.throwIfAborted();
    const asar = await findAppAsar(mount);
    if (!asar) { await detach(); throw new Error('Mounted the disk image but found no Electron app (Contents/Resources/app.asar) inside.'); }
    return { asar, mount, detach };
  } catch (error) { await detach(); throw error; }
}
