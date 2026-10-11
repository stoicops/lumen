# Verification record

Date: 11 October 2026. Environment: hosted Linux container, Node v24.19.0, npm 11.9.0.

| Check | Outcome |
|---|---|
| npm install --ignore-scripts | Passed; exact lockfile produced. Electron binary install script intentionally not run in this container. |
| npm run build | Passed; React JS/CSS and HTML produced in dist. |
| npm test | 4 passed, 0 failed. |
| Real REA MCP launch/initialize | Passed; installed rea-agents 6.4.0. |
| Real tools/list and binary_session | Passed; adapter-required tools found. |
| Real owned-fixture analysis | BLOCKED by capability_unavailable: Linux process ownership inspection requires procps-compatible ps; ps did not report REA’s current process. |
| Real complete bundle export | Not reached because analysis failed. |
| Electron GUI / drag-drop | Not tested; requires desktop runtime and installed Electron binary. |
| Real LM Studio / Ollama | Not available; request shape tested against owned fake server. |
| Cancellation / process cleanup | Not verified end-to-end. |
| macOS / Windows packaging | Not tested. |

Core tests cover local-only endpoint rejection, disallowed execution tools, persistent interrupted-job recovery/path traversal and evidence chat without tools plus redirect rejection. They do not prove production security, model grounding or cross-platform compatibility.

The integration script exists at scripts/verify-rea.mjs and intentionally fails if analysis or export cannot complete. Run it on a normal supported desktop; do not remove REA ownership checks to make the test pass. Its finally block closes the client on failure.

## Update — 11 October 2026 (second session)

Environment: hosted Linux container, Node v24.11.1, npm ci --ignore-scripts from the committed lockfile.

| Check | Outcome |
|---|---|
| npm test | 6 passed, 0 failed (adds connect-cancel and connect-timeout lifecycle tests). |
| npm run build | Passed. |
| npm run verify:rea | **Passed end to end**: initialize, owned-fixture analysis, canonical summary, complete bundle export. The ownership block seen previously did not reproduce here; this is environment-dependent, not a code change. |
| Engine cleanup after verify:rea | Verified: REA exited on stdin EOF (graceful), no descendants, no survivors. |
| Cancel during connect (fake stubborn engine that ignores EOF/SIGTERM and owns a grandchild) | Connect rejects promptly; escalation to SIGKILL; parent and grandchild confirmed gone (Linux /proc). |
| Electron GUI, cancel/quit wiring in main.mjs | Syntax-checked only; not exercised in a running Electron app. |

Limits: descendant enumeration uses /proc and is Linux-only. On macOS/Windows the cleanup record reports `verified: false` with the reason "descendants not enumerable" even when the engine itself exited. Descendants that detach into a new session after the snapshot are not tracked.

## Update — user's Mac (MacBook Pro), 11 October 2026

| Check | Outcome |
|---|---|
| npm run verify:rea | **Real analysis + bundle export PASSED on macOS.** Cleanup reported unverified: REA exited gracefully with no survivors, but descendants were not enumerable on macOS. |

Fix: descendant listing on macOS/other POSIX now uses the system process table (`/bin/ps -A -o pid=,ppid=`, fixed path, no shell, bounded), and the snapshot is taken before asking the engine to close. The ps path is unit-tested on Linux (7/7 pass); awaiting a macOS rerun. Windows remains "not enumerable" → unverified.

| macOS rerun after ps fix (commit b8dfe9d) | **PASSED**: analysis + export, cleanup `{"method":"graceful","verified":true,"descendantsChecked":0,"survivors":[]}`. |

## Desktop startup hang (user's Mac: Electron icon bounced, no window)

Cause: top-level `await app.whenReady()` in the ESM main module deadlocks — Electron emits 'ready' only after the module finishes evaluating. Fix: start() is called from app.whenReady().then(...); startup errors show a dialog and exit.
Reproduced in container with Electron 40.0.0 under Xvfb + remote debugging: original main → no page after 12 s; fixed main → page "Lumen Local Studio" loaded from dist/index.html. Awaiting confirmation on the user's Mac.

## .asar targets failed in the desktop app (user's Mac: ENOENT for an existing .asar)

User confirmed: window opens on macOS after the startup fix; Ollama model discovery listed gemma2:2b.
Cause: REA runs under Electron's binary (ELECTRON_RUN_AS_NODE); Electron's fs presents .asar files as virtual folders, so REA saw ENOENT. Plain-Node verify only covered a folder target.
Fix: spawn REA with ELECTRON_NO_ASAR=1. Added fixtures/simple-app.asar; `npm run verify:rea` now checks folder + asar, and `npm run verify:rea:electron` runs the asar case under Electron. Container: reproduced ENOENT under Electron, then PASS with cleanup verified after the fix. Awaiting Mac rerun.

## End-to-end on the user's Mac (after commit fixing .asar)

PASSED: npm start → window; user's own Lumen-Test-App.asar analysed to completion with evidence displayed; Ollama gemma2:2b answered a question from the summary (shown labelled "AI EXPLANATION · UNVERIFIED").
Observed problems: (a) answer shows raw markdown (`**`) because output is rendered as plain escaped text (safe, but unreadable); (b) several model bullets ("uses workers", "uses endpoints", "uses storage") look like REA coverage/limitation family names restated as facts — ungrounded claims with no citations. Confirms item 4 (citation validation) matters. Cancel and Cmd+Q mid-analysis not yet reported.
