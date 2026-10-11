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

## Plain-English results, Mac-style UI, delete, AI status, Markdown handoff

- src/core/findings.mjs projects only REA-reported summary fields; every row keeps evidence_id + exact field path; zero = "Not seen" (not "absent"). Tested against a real REA summary fixture (tests/fixtures/summary-evidence.json, home path anonymised).
- Delete: native confirm dialog in main; refuses the running job; removes only the validated project dir (tested).
- AI status pill (provider · model, refreshed every 15 s). Safe Markdown renderer builds React elements only.
- "Copy as Markdown" / "Save…": AI-ready Markdown with provenance; home folder replaced by ~ (tested). Save also writes the full evidence bundle.
- npm test: 10 passed. Real Electron under Xvfb: analysed fixtures/simple-app.asar via the app bridge, rendered summary/dark/evidence sheet (docs/screenshots). macOS vibrancy/inset title bar not verifiable here.
| macOS screenshot (user) | New UI renders on the Mac; summary, findings, coverage and AI pill "Ollama · dolphin-phi:latest" (green) confirmed. Delete, Copy as Markdown and cancel/quit not yet reported. |

## Architecture map (container, Electron 40 under Xvfb)

- src/core/graph.mjs projects REA's JavaScriptApplicationGraph from the saved bundle: only REA nodes; file-level nodes (artifact/asar-entry/asset/module) folded into the architecture node REA maps them to; every link lists its REA edge IDs and weakest state/confidence. Test asserts no invented nodes/links against a real bundle fixture.
- simple-app.asar: 8 parts, 9 links (17 file-level nodes folded, 33 raw edges); 3 animated data links: preload→channel, handler←channel, preload→exposed API. Pulse disabled under prefers-reduced-motion; Pause button.
- npm test: 11 passed. Screenshots docs/screenshots/5,6.

## Security checks and key scan

- src/core/security.mjs: Electron window settings (literal/computed/absent with Electron default noted), exposed page APIs (general-purpose members flagged), IPC handlers with no sender checks, dynamic channels, native add-ons — all from REA facts, each citing evidence/node/location.
- src/core/secret-scan.mjs: Lumen's own read-only pattern scan (folders + raw .asar parsing; no symlinks, bounded files/bytes/header, out-of-archive offsets rejected, masked values only). Runs after export during analysis; inside Electron it reads with process.noAsar.
- Tests: 13 passed (keys built at runtime, never committed; malformed .asar rejected).
- Real Electron (Xvfb): planted AWS-format key in an .asar found at main.js:6, displayed masked; unchecked IPC handler flagged. docs/screenshots/7-security.png.

## Evidence-grounded AI answers (item 4, partial)

- src/core/grounding.mjs: model gets a numbered fact list ([F] findings, [L] map links, [S] security), bounded to 24k chars with omitted count; REA coverage area names are passed as labelled scope notes, not facts. Each answer line is checked: supported / no source / invalid citation / number mismatch.
- Real Electron + fake OpenAI-compatible server on 127.0.0.1:11434: planted answer scored "4 of 7 claims cite real evidence. 1 has no source. 1 cites a fact that doesn't exist. 1 has a number that doesn't match." docs/screenshots/8-checked-answer.png. Not yet run against a real model on the Mac.
- npm test: 15 passed (adds syntax check of main/preload after a slip broke the main file during this change; caught by the Electron run before commit).
- Limits: checking is mechanical; a cited claim can still misread its fact. Still single-turn, non-streaming, conversations not saved.

## User confirmation on macOS (11 October 2026)

User reported "all works" after pulling the map, security and checked-answer changes: Map, Security tab and grounded AI answers working on the Mac with a local Ollama model. Cancel/Cmd+Q mid-analysis not separately reported.

## SQLite store, saved conversations, streaming chat

- Store moved to node:sqlite (WAL, migrations, transactions); evidence bundles stay as files. Legacy project.json folders imported once; unreadable ones listed as "unreadable". Job events persisted.
- Chat streams over SSE with a byte limit enforced while reading; Stop keeps the partial answer marked "stopped early"; conversations saved per project with follow-ups (bounded history).
- npm test: 17 passed. Electron + fake streaming server: mid-stream text shown, follow-up received earlier messages, Stop recorded, conversation restored after reload.

## Licensing review, .app resolution, shared source reader

- analyzeLicensing classifies mechanisms by robustness with how-it-works/weakness/harden, redacts keys. Electron run on a demo .asar: 6 findings (2 trivial, 4 weak). docs/screenshots/10-licensing.png.
- visitTextFiles shared by secret + licensing scans (read-only, bounded, .asar-aware). npm test: 19 passed.

## Universal target identification + native inspection + decompiler-engine wiring

- src/core/identify.mjs: magic-byte + extension triage → ELF/PE/Mach-O(+universal)/.NET/APK/ZIP/DMG/ASAR/Electron/JS. Tested against crafted headers and the real demo .asar (20th test).
- Adapter: NATIVE_READ allow-list (read-only; no execution/capture/mutation), extraEnv passthrough (GHIDRA_INSTALL_DIR), inspectNative() orchestrator with soft tryCall. Real ELF under REA: opened + identified (elf/x86_64/executable/sha256), binary_overview → provider_unavailable → engineReady:false (honest), cleanup verified.
- main.mjs routes family: js → deep analysis + scans; native/managed/android → inspectNative. Settings store (userData/settings.json) → GHIDRA_INSTALL_DIR. IPC: native/settings/saveSettings/pickFolder.
- UI: NativeView (identity + signature/layout sections + "engine needed" panel with steps) and Settings modal (Ghidra folder picker + in-app install guide, Java 21 / Ghidra 12.1.4). Electron run on a real ELF: native view + engine panel + Settings all render (docs/screenshots/11,12).
- Ghidra discovery confirmed from rea-agents: env GHIDRA_INSTALL_DIR (absolute), verified build 12.1.4, Java 21, `rea doctor`. Deep decompile NOT verified here (Ghidra not installed); verify on the user's Mac after install. Hopper/JEB supported-if-present, never bundled (project rule).
