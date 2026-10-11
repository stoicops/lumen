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
