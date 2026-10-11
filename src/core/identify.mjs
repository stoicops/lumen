// Identify what a dropped target is, from magic bytes first and extension second, so Lumen can route
// it to the right analysis and say honestly what deeper work needs. Reads only the first bytes of a
// file; never executes anything. REA's open_binary is the authoritative identifier for natives — this
// is the fast local triage that decides routing and what to tell the user.
import { open, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// family: how Lumen handles it. 'js' = deep static analysis today. 'native'/'managed'/'android' =
// identification now, deep decompilation only with an installed engine. 'container' = unwrap first.
export const KINDS = {
  'electron-app':   { family: 'js', label: 'Electron application', deep: true },
  'asar':           { family: 'js', label: 'Electron ASAR archive', deep: true },
  'javascript':     { family: 'js', label: 'JavaScript source', deep: true },
  'dmg':            { family: 'container', label: 'macOS disk image (.dmg)', deep: false, unwrap: 'Mount it (or Lumen does, on macOS) and point at the .app inside.' },
  'macho':          { family: 'native', label: 'macOS native executable (Mach-O)', deep: false, engine: 'Ghidra or Hopper' },
  'macho-universal':{ family: 'native', label: 'macOS universal binary (Mach-O)', deep: false, engine: 'Ghidra or Hopper' },
  'pe':             { family: 'native', label: 'Windows executable (.exe/.dll)', deep: false, engine: 'Ghidra' },
  'elf':            { family: 'native', label: 'Linux executable (ELF)', deep: false, engine: 'Ghidra' },
  'dotnet':         { family: 'managed', label: '.NET assembly', deep: false, engine: 'REA managed inspector' },
  'apk':            { family: 'android', label: 'Android app (APK)', deep: false, engine: 'JADX/JEB' },
  'zip':            { family: 'container', label: 'ZIP archive', deep: false, unwrap: 'Unzip it and point at the app inside.' },
  'unknown':        { family: 'unknown', label: 'Unrecognised file', deep: false },
};

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

function classifyBytes(buf, size) {
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';                              // \x7fELF
  if (startsWith(buf, [0x4d, 0x5a])) {                                                       // MZ (PE / .NET both start MZ)
    return 'pe';
  }
  if (startsWith(buf, [0xca, 0xfe, 0xba, 0xbe]) || startsWith(buf, [0xbe, 0xba, 0xfe, 0xca])) return 'macho-universal'; // fat
  for (const m of [[0xcf, 0xfa, 0xed, 0xfe], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xfe, 0xed, 0xfa, 0xce]]) if (startsWith(buf, m)) return 'macho';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) return 'zip-like'; // PK.. (zip/apk/jar)
  // ASAR has no magic; it is a Pickle: uint32=4, then a uint32 header size, then JSON starting with {"files".
  if (size > 16 && buf.readUInt32LE(0) === 4) { const jsonLen = buf.readUInt32LE(12); if (jsonLen > 0 && jsonLen < size && buf.slice(16, 16 + 8).toString('latin1').includes('{')) return 'asar-like'; }
  // UDIF (.dmg) stores its 'koly' trailer at EOF, not the head; extension handles the common case.
  return null;
}

async function readHead(path, n = 64) { const fd = await open(path, 'r'); try { const buf = Buffer.alloc(n); const { bytesRead } = await fd.read(buf, 0, n, 0); return buf.subarray(0, bytesRead); } finally { await fd.close(); } }

async function looksLikeApk(path) {
  // A ZIP that contains AndroidManifest.xml / classes.dex is an APK; checked by central-directory names is heavy,
  // so trust the extension for .apk and leave other zips as 'zip'.
  return path.toLowerCase().endsWith('.apk');
}

// Directory: an Electron app if it has an app.asar or a package.json; otherwise a JS source folder.
async function classifyDir(path) {
  const names = new Set(await readdir(path).catch(() => []));
  if (names.has('Contents')) { try { if ((await stat(join(path, 'Contents', 'Resources', 'app.asar'))).isFile()) return 'electron-app'; } catch {} }
  if (names.has('resources')) { try { if ((await stat(join(path, 'resources', 'app.asar'))).isFile()) return 'electron-app'; } catch {} }
  if (names.has('app.asar')) return 'electron-app';
  if (names.has('package.json') || [...names].some(n => /\.(js|mjs|cjs|jsx|ts|tsx|html)$/i.test(n))) return 'javascript';
  return 'javascript'; // default: let REA try the folder as a JS app
}

export async function identify(path) {
  let info; try { info = await stat(path); } catch { return { kind: 'unknown', ...KINDS.unknown, reason: 'That path could not be found.' }; }
  let kind;
  if (info.isDirectory()) kind = await classifyDir(path);
  else {
    const lower = path.toLowerCase();
    const head = await readHead(path);
    const magic = classifyBytes(head, info.size);
    if (lower.endsWith('.asar') || magic === 'asar-like') kind = 'asar';
    else if (lower.endsWith('.dmg')) kind = 'dmg';
    else if (magic === 'elf') kind = 'elf';
    else if (magic === 'macho') kind = 'macho';
    else if (magic === 'macho-universal') kind = 'macho-universal';
    else if (magic === 'pe') kind = (lower.endsWith('.dll') || lower.endsWith('.exe')) ? 'pe' : 'pe';
    else if (magic === 'zip-like') kind = (await looksLikeApk(path)) ? 'apk' : lower.endsWith('.jar') ? 'zip' : 'zip';
    else if (/\.(js|mjs|cjs|jsx|ts|tsx|html?)$/i.test(lower)) kind = 'javascript';
    else if (/\.(dll|exe)$/i.test(lower)) kind = 'pe';
    else kind = 'unknown';
    // A PE that is really a .NET assembly needs the CLI header; REA's managed inspector confirms it.
    if (kind === 'pe' && head.includes(Buffer.from('BSJB'))) kind = 'dotnet';
  }
  return { kind, ...KINDS[kind], path };
}
