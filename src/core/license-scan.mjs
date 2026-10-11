// Read-only analysis of how an app's licensing/trial mechanism works, so the app's OWN author can
// harden it. For each detected mechanism it reports how it works, how robust it is against tampering,
// the general weakness class, and the concrete hardening step. It describes weakness *categories*
// (well documented in software-protection literature), not a working exploit or a patched binary.
// Pattern matching over source text: it finds common shapes, misses obfuscated ones, and can misread.
import { visitTextFiles, lineOf } from './read-sources.mjs';

// robustness: trivial < weak < moderate < strong. Each rule: how it works, the weakness class, the fix.
const RULES = [
  {
    id: 'hardcoded-compare', robustness: 'trivial',
    pattern: /(license|licence|serial|activation|product)[_-]?key\s*(===?|==)\s*["'][^"']{4,}["']/gi,
    mechanism: 'The license key is compared against a fixed value written in the code.',
    weakness: 'The correct key is sitting in the code, and the comparison runs on the user’s machine.',
    harden: 'Never ship the valid key. Check the key server-side, or verify a signature made with a private key you never ship.',
  },
  {
    id: 'bool-flag', robustness: 'trivial',
    pattern: /\b(isLicensed|isActivated|isPro|isPaid|isPremium|isRegistered|isTrial|hasLicense|licenseValid|premiumEnabled)\b\s*(=|:)\s*(true|false)/gi,
    mechanism: 'A plain true/false flag in the code decides whether the app is licensed.',
    weakness: 'Anyone editing the code can flip the flag to true; nothing cryptographic protects it.',
    harden: 'Gate real functionality on a verified token, not a boolean. Derive features from a signed license you validate, so flipping a flag yields nothing usable.',
  },
  {
    id: 'local-key-format', robustness: 'weak',
    pattern: /\b(validate|check|verify)[A-Za-z]*(license|licence|serial|key|activation)\b|\b(license|licence|serial)[A-Za-z]*\.(test|match|exec)\s*\(/gi,
    mechanism: 'A license/serial is validated on the user’s machine (format check, checksum or regex).',
    weakness: 'All logic to accept a key is on the client, so a valid key can be derived or the check removed.',
    harden: 'Move the decision to a server you control, or require a signature over the user’s identity that only your private key could produce. A client-side checksum is not protection.',
  },
  {
    id: 'trial-local-clock', robustness: 'weak',
    pattern: /\b(trial|expir|expiry|expires|daysLeft|daysRemaining|trialEnd|installDate|firstRun)\b[^\n]{0,60}\b(Date\.now|new Date|getTime|Date\.parse)\b/gi,
    mechanism: 'A trial period is measured using the computer’s own clock and a stored start date.',
    weakness: 'The user controls both the clock and the stored date, so the trial can be reset or frozen.',
    harden: 'Get trusted time from your server and record trial use server-side against an account or device id, not in a local file.',
  },
  {
    id: 'local-store', robustness: 'weak',
    pattern: /\b(localStorage|electron-store|new Store\(|conf\.|\.set\(\s*["'](license|licence|activated|pro|premium|trial))/gi,
    mechanism: 'License or activation state is kept in local storage (localStorage, electron-store, a config file).',
    weakness: 'These stores are plain text the user can read and edit to grant themselves a license.',
    harden: 'Treat local state as a cache only. Re-verify against a signed token or your server on launch; never trust a stored “activated” flag by itself.',
  },
  {
    id: 'offline-signature', robustness: 'strong',
    pattern: /\b(createVerify|verifyLicense|ed25519|RSA-SHA256|crypto\.verify|publicKey)\b|\b(verify|validate)[A-Za-z]*(signature|license|licence)|(licen[sc]e|signature)[A-Za-z]*\.(verify|check)\b/gi,
    mechanism: 'The license is a signed token checked offline with a public key.',
    weakness: 'Sound in principle. The remaining risk is that the whole check (or the public key) can be replaced, since the code ships to the user.',
    harden: 'Keep this approach. Make the signed payload bind to the user/device, add tamper checks on the app bundle, and avoid a single boolean that a patch can short-circuit after a valid verify.',
  },
  {
    id: 'server-validation', robustness: 'moderate',
    pattern: /\b(fetch|axios|https?\.request|XMLHttpRequest)\b[^\n]{0,80}\b(licen[sc]e|activat|validate|entitlement|subscription)\b/gi,
    mechanism: 'The app contacts a server to validate the license or subscription.',
    weakness: 'Stronger than a local check, but the network call can be blocked or faked (hosts file, local proxy) unless the response is verified.',
    harden: 'Sign the server’s response and verify the signature in the app, include a nonce to stop replay, and fail closed (deny) when the server cannot be reached rather than defaulting to licensed.',
  },
];
const CONTEXT = /\b(licen[sc]e|licence|serial|activat|trial|premium|\bpro\b|subscription|entitlement|registration|product[_-]?key)\b/i;
const ROBUST_RANK = { trivial: 0, weak: 1, moderate: 2, strong: 3 };

export async function analyzeLicensing(target, options) {
  const found = new Map(); // id|file|line -> finding
  const meta = await visitTextFiles(target, (file, text) => {
    if (!CONTEXT.test(text)) return; // skip files with no licensing vocabulary at all
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0; let m;
      while ((m = rule.pattern.exec(text))) {
        const line = lineOf(text, m.index);
        const key = `${rule.id}|${file}|${line}`;
        if (found.has(key)) continue;
        // One short, redacted snippet of the matching line for orientation; no full keys.
        const lineText = text.split('\n')[line - 1]?.trim().slice(0, 120).replace(/(["'])[^"']{6,}\1/g, '$1…$1') ?? '';
        found.set(key, { id: rule.id, robustness: rule.robustness, file, line, snippet: lineText, mechanism: rule.mechanism, weakness: rule.weakness, harden: rule.harden });
      }
    }
  }, options);

  const findings = [...found.values()].sort((a, b) => ROBUST_RANK[a.robustness] - ROBUST_RANK[b.robustness]);
  const mechanisms = [...new Set(findings.map(f => f.id))];
  const weakest = findings[0]?.robustness ?? null;
  const summary = findings.length === 0
    ? 'No licensing or trial mechanism was recognised in the code Lumen could read. It may have none, or use a shape Lumen does not detect (including obfuscated or native code).'
    : `Detected ${mechanisms.length} kind(s) of licensing logic across ${findings.length} place(s). The weakest is rated “${weakest}”. Everything runs on the user’s machine, so treat client-side checks as a deterrent, not a guarantee.`;
  return { findings, mechanisms, weakest, summary, ...meta };
}
