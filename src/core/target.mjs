// Resolve a chosen path to something REA can analyse today. A macOS .app (or any folder) that holds
// Contents/Resources/app.asar is routed to that archive; app.asar.unpacked beside it is noted, since
// native/unpacked files are outside this JavaScript analysis. Never executes the target.
import { stat, readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

async function kind(path) { try { return (await stat(path)).isDirectory() ? 'dir' : 'file'; } catch { return null; } }

// A native (non-Electron) .app: find its main Mach-O executable in Contents/MacOS, preferring the
// name in Info.plist's CFBundleExecutable, so Lumen inspects the real binary instead of erroring.
async function macAppExecutable(input) {
  const macos = join(input, 'Contents', 'MacOS');
  if (await kind(macos) !== 'dir') return null;
  let wanted;
  try { const plist = await readFile(join(input, 'Contents', 'Info.plist'), 'utf8'); wanted = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1]; } catch {}
  const entries = (await readdir(macos).catch(() => [])).filter(n => !n.startsWith('.'));
  const name = (wanted && entries.includes(wanted)) ? wanted : entries[0];
  return name ? join(macos, name) : null;
}

export async function resolveTarget(input) {
  if (typeof input !== 'string' || !input) throw new Error('Choose a local app folder or .asar file');
  const top = await kind(input);
  if (top === null) throw new Error('That path could not be found.');
  if (top === 'file') {
    if (input.toLowerCase().endsWith('.asar')) return { target: input, kind: 'asar', notes: [] };
    throw new Error('Lumen reads JavaScript app folders and .asar files. For a single file, choose a .asar archive.');
  }
  // A folder: prefer a bundled Electron app.asar if present (covers .app bundles and unpacked apps).
  const asar = join(input, 'Contents', 'Resources', 'app.asar');
  if (await kind(asar) === 'file') {
    const notes = [`Found the app’s code at ${join('Contents', 'Resources', 'app.asar')} inside this bundle.`];
    if (await kind(asar + '.unpacked') === 'dir') notes.push('This app also has unpacked files (often native modules) that this JavaScript analysis does not cover.');
    return { target: asar, kind: 'app-bundle', notes };
  }
  const plainAsar = join(input, 'resources', 'app.asar');
  if (await kind(plainAsar) === 'file') return { target: plainAsar, kind: 'app-bundle', notes: [`Found the app’s code at ${join('resources', 'app.asar')}.`] };
  // A native Mac app: route to its Mach-O executable for native inspection instead of erroring.
  if (input.toLowerCase().endsWith('.app')) {
    const exe = await macAppExecutable(input);
    if (exe) return { target: exe, kind: 'macho', notes: [`This is a native Mac app (not Electron). Inspecting its executable, ${basename(exe)}.`] };
    throw new Error('This looks like a Mac app, but Lumen could not find an executable inside it to inspect.');
  }
  return { target: input, kind: 'dir', notes: [] };
}
