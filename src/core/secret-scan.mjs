// Read-only scan for likely credentials and web addresses in a target folder or .asar archive.
// Stores only masked values. Pattern matching has false positives and negatives.
import { visitTextFiles, lineOf } from './read-sources.mjs';

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

export async function scanTarget(target, options) {
  const hits = [], hosts = new Set(), seen = new Set();
  const meta = await visitTextFiles(target, (file, text) => {
    for (const [kind, severity, pattern] of PATTERNS) {
      pattern.lastIndex = 0; let m;
      while ((m = pattern.exec(text)) && hits.length < 500) {
        const value = m[1] ?? m[0];
        if (/^(?:x+|\*+|\.+|<[^>]*>|\$\{.*|your[_-].*|example.*|changeme|placeholder)$/i.test(value)) continue;
        // The generic name=value rule defers to a specific rule that recognises the same value.
        if (m[1] && PATTERNS.some(([, , p]) => !p.source.includes('password') && new RegExp(p.source).test(value))) continue;
        const line = lineOf(text, m.index); const key = `${file}:${line}:${kind}`;
        if (seen.has(key)) continue; seen.add(key);
        hits.push({ kind, severity, file, line, masked: mask(value), length: value.length });
      }
    }
    URL_PATTERN.lastIndex = 0; let u;
    while ((u = URL_PATTERN.exec(text))) hosts.add(u[1].toLowerCase());
  }, options);
  return { hits, hosts: [...hosts].sort(), ...meta };
}

// Back-compat names used elsewhere/tests.
export const scanDirectory = scanTarget;
export const scanAsar = scanTarget;
