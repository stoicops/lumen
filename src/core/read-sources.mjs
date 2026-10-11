// Read-only traversal of a target folder or .asar archive, calling `visit(relativePath, text)` for
// each text file. Never executes or imports target code; bounded by file count, per-file and total
// bytes; does not follow symlinks; rejects archive entries pointing outside the archive.
import { open, readdir, lstat } from 'node:fs/promises';
import { join, extname } from 'node:path';

export const LIMITS = { maxFiles: 20000, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxHeaderBytes: 32 * 1024 * 1024, maxDepth: 40 };
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.html', '.htm', '.env', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.txt', '.map', '.xml', '.plist', '.properties', '']);
const wanted = name => TEXT_EXT.has(extname(name).toLowerCase()) || /^\.env/.test(name);

export async function visitTextFiles(target, visit, { signal } = {}) {
  const meta = { filesScanned: 0, bytesScanned: 0, skipped: [] };
  const budget = (size, name) => {
    if (meta.filesScanned >= LIMITS.maxFiles) { meta.skipped.push(`${name}: file limit reached`); return false; }
    if (size > LIMITS.maxFileBytes) { meta.skipped.push(`${name}: larger than ${LIMITS.maxFileBytes / 1048576} MB`); return false; }
    if (meta.bytesScanned + size > LIMITS.maxTotalBytes) { meta.skipped.push(`${name}: total scan budget reached`); return false; }
    return true;
  };
  const feed = (text, name) => { meta.filesScanned++; meta.bytesScanned += text.length; visit(name, text); };

  if (target.toLowerCase().endsWith('.asar')) {
    const handle = await open(target, 'r');
    try {
      const head = Buffer.alloc(16); await handle.read(head, 0, 16, 0);
      const headerSize = head.readUInt32LE(4), jsonLength = head.readUInt32LE(12);
      if (jsonLength > LIMITS.maxHeaderBytes || jsonLength + 16 > headerSize + 8) throw new Error('ASAR header is malformed or too large');
      const json = Buffer.alloc(jsonLength); await handle.read(json, 0, jsonLength, 16);
      const header = JSON.parse(json.toString('utf8'));
      const base = 8 + headerSize; const { size: archiveSize } = await handle.stat();
      const walk = async (node, rel, depth) => {
        if (depth > LIMITS.maxDepth) { meta.skipped.push(`${rel}: too deep`); return; }
        for (const [name, entry] of Object.entries(node.files ?? {})) {
          signal?.throwIfAborted();
          const path = rel ? `${rel}/${name}` : name;
          if (/[\\/]|^\.\.?$/.test(name)) { meta.skipped.push(`${path}: unsafe entry name`); continue; }
          if (entry.files) { await walk(entry, path, depth + 1); continue; }
          if (entry.link) { meta.skipped.push(`${path}: link not followed`); continue; }
          if (entry.unpacked) { meta.skipped.push(`${path}: stored outside the archive (unpacked)`); continue; }
          if (!wanted(name)) continue;
          const size = Number(entry.size), offset = Number(entry.offset);
          if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size < 0 || offset < 0 || base + offset + size > archiveSize) { meta.skipped.push(`${path}: entry points outside the archive`); continue; }
          if (!budget(size, path)) continue;
          const buf = Buffer.alloc(size); await handle.read(buf, 0, size, base + offset);
          feed(buf.toString('utf8'), path);
        }
      };
      await walk(header, '', 0);
    } finally { await handle.close(); }
  } else {
    const walk = async (dir, rel, depth) => {
      if (depth > LIMITS.maxDepth) { meta.skipped.push(`${rel}: too deep`); return; }
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        signal?.throwIfAborted();
        const path = join(dir, entry.name), name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) { meta.skipped.push(`${name}: symlink not followed`); continue; }
        if (entry.isDirectory()) { if (entry.name !== '.git') await walk(path, name, depth + 1); continue; }
        if (!entry.isFile() || !wanted(entry.name)) continue;
        const { size } = await lstat(path);
        if (!budget(size, name)) continue;
        const handle = await open(path, 'r');
        try { const buf = Buffer.alloc(size); await handle.read(buf, 0, size, 0); feed(buf.toString('utf8'), name); } finally { await handle.close(); }
      }
    };
    await walk(target, '', 0);
  }
  return { ...meta, skipped: meta.skipped.slice(0, 50), limits: LIMITS };
}

export const lineOf = (text, index) => text.slice(0, index).split('\n').length;
