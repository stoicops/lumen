// Read-only scan for likely credentials and web addresses in a target folder or .asar archive.
// Never executes or imports target code; bounded by file count, per-file and total bytes; does not
// follow symlinks; stores only masked values. Pattern matching has false positives and negatives.

import { open, readdir, lstat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const LIMITS = { maxFiles: 20000, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxHeaderBytes: 32 * 1024 * 1024, maxDepth: 40 };
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.html', '.htm', '.env', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.txt', '.map', '.xml', '.plist', '.properties', '']);

const PATTERNS = [
  ['AWS access key', 'high', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['Google API key', 'high', /\bAIza[0-9A-Za-z_\-]{35}\b/g],
  ['GitHub token', 'high', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b|\bgithub_pat_[0-9A-Za-z_]{40,}\b/g],
  ['Slack token', 'high', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g],
  ['Stripe secret key', 'high', /\b[sr]k_live_[0-9A-Za-z]{20,}\b/g],
  ['Anthropic API key', 'high', /\bsk-ant-[0-9A-Za-z_\-]{20,}\b/g],
  ['OpenAI API key', 'high', /\bsk-(?:proj-)?[0-9A-Za-z_\-]{32,}\b/g],
  ['private key', 'high', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['JSON Web Token', 'medium', /\beyJ[0-9A-Za-z_\-]{10,}\.eyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}\b/g],
  ['Stripe test key', 'low', /\b[sr]k_test_[0-9A-Za-z]{20,}\b/g],
  ['hard-coded password or secret', 'medium', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi],
];
const URL_PATTERN = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::\d+)?/gi;

export function mask(value) { return value.length <= 8 ? '•'.repeat(value.length) : `${value.slice(0, 4)}…${value.slice(-2)}`; }

function scanText(text, file, out) {
  for (const [kind, severity, pattern] of PATTERNS) {
    pattern.lastIndex = 0; let m;
    while ((m = pattern.exec(text)) && out.hits.length < 500) {
      const value = m[1] ?? m[0];
      if (/^(?:x+|\*+|\.+|<[^>]*>|\$\{.*|your[_-].*|example.*|changeme|placeholder)$/i.test(value)) continue;
      // The generic name=value rule defers to a specific rule that recognises the same value.
      if (m[1] && PATTERNS.some(([, , p]) => !p.source.includes('password') && new RegExp(p.source).test(value))) continue;
      const line = text.slice(0, m.index).split('\n').length;
      const key = `${file}:${line}:${kind}`;
      if (out.seen.has(key)) continue; out.seen.add(key);
      out.hits.push({ kind, severity, file, line, masked: mask(value), length: value.length });
    }
  }
  URL_PATTERN.lastIndex = 0; let u;
  while ((u = URL_PATTERN.exec(text))) out.hosts.add(u[1].toLowerCase());
}

function state() { return { hits: [], hosts: new Set(), seen: new Set(), filesScanned: 0, bytesScanned: 0, skipped: [] }; }
function finish(out) { return { hits: out.hits, hosts: [...out.hosts].sort(), filesScanned: out.filesScanned, bytesScanned: out.bytesScanned, skipped: out.skipped.slice(0, 50), limits: LIMITS }; }
const wanted = name => TEXT_EXT.has(extname(name).toLowerCase()) || /^\.env/.test(name);
function budget(out, size, name) {
  if (out.filesScanned >= LIMITS.maxFiles) { out.skipped.push(`${name}: file limit reached`); return false; }
  if (size > LIMITS.maxFileBytes) { out.skipped.push(`${name}: larger than ${LIMITS.maxFileBytes / 1048576} MB`); return false; }
  if (out.bytesScanned + size > LIMITS.maxTotalBytes) { out.skipped.push(`${name}: total scan budget reached`); return false; }
  return true;
}

export async function scanDirectory(root, { signal } = {}) {
  const out = state();
  async function walk(dir, rel, depth) {
    if (depth > LIMITS.maxDepth) { out.skipped.push(`${rel}: too deep`); return; }
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const path = join(dir, entry.name), name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { out.skipped.push(`${name}: symlink not followed`); continue; }
      if (entry.isDirectory()) { if (entry.name !== '.git') await walk(path, name, depth + 1); continue; }
      if (!entry.isFile() || !wanted(entry.name)) continue;
      const { size } = await lstat(path);
      if (!budget(out, size, name)) continue;
      const handle = await open(path, 'r');
      try { const buf = Buffer.alloc(size); await handle.read(buf, 0, size, 0); scanText(buf.toString('utf8'), name, out); } finally { await handle.close(); }
      out.filesScanned++; out.bytesScanned += size;
    }
  }
  await walk(root, '', 0);
  return finish(out);
}

// ASAR: [u32 4][u32 headerPickleSize][u32 payload][u32 jsonLength][json…]; file data starts at 8 + headerPickleSize.
export async function scanAsar(file, { signal } = {}) {
  const out = state();
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(16); await handle.read(head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4), jsonLength = head.readUInt32LE(12);
    if (jsonLength > LIMITS.maxHeaderBytes || jsonLength + 16 > headerSize + 8) throw new Error('ASAR header is malformed or too large');
    const json = Buffer.alloc(jsonLength); await handle.read(json, 0, jsonLength, 16);
    const header = JSON.parse(json.toString('utf8'));
    const base = 8 + headerSize; const { size: archiveSize } = await handle.stat();
    async function walk(node, rel, depth) {
      if (depth > LIMITS.maxDepth) { out.skipped.push(`${rel}: too deep`); return; }
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        signal?.throwIfAborted();
        const path = rel ? `${rel}/${name}` : name;
        if (/[\\/]|^\.\.?$/.test(name)) { out.skipped.push(`${path}: unsafe entry name`); continue; }
        if (entry.files) { await walk(entry, path, depth + 1); continue; }
        if (entry.link) { out.skipped.push(`${path}: link not followed`); continue; }
        if (entry.unpacked) { out.skipped.push(`${path}: stored outside the archive (unpacked)`); continue; }
        if (!wanted(name)) continue;
        const size = Number(entry.size), offset = Number(entry.offset);
        if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size < 0 || offset < 0 || base + offset + size > archiveSize) { out.skipped.push(`${path}: entry points outside the archive`); continue; }
        if (!budget(out, size, path)) continue;
        const buf = Buffer.alloc(size); await handle.read(buf, 0, size, base + offset);
        scanText(buf.toString('utf8'), path, out); out.filesScanned++; out.bytesScanned += size;
      }
    }
    await walk(header, '', 0);
  } finally { await handle.close(); }
  return finish(out);
}

// Dispatch on the name, not stat(): inside Electron, fs reports .asar archives as directories.
export async function scanTarget(target, options) {
  return target.toLowerCase().endsWith('.asar') ? scanAsar(target, options) : scanDirectory(target, options);
}
