// Resolve a chosen path to something REA can analyse today. A macOS .app (or any folder) that holds
// Contents/Resources/app.asar is routed to that archive; app.asar.unpacked beside it is noted, since
// native/unpacked files are outside this JavaScript analysis. Never executes the target.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

async function kind(path) { try { return (await stat(path)).isDirectory() ? 'dir' : 'file'; } catch { return null; } }

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
  if (input.toLowerCase().endsWith('.app')) throw new Error('This looks like a Mac app, but Lumen could not find JavaScript code (Contents/Resources/app.asar) inside it. It may not be an Electron app.');
  return { target: input, kind: 'dir', notes: [] };
}
