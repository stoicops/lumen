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
