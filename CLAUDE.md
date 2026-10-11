# Claude Code handoff

Read docs/REQUIREMENTS.md, docs/UPSTREAM-NOTES.md and README.md first. User: Surinder Lall. Goal: everyday-user desktop companion for REA with excellent LM Studio/Ollama support. Working brand Lumen; user has not approved a final name.

## Start here

1. Use Node 24.11+ (tested Node 24.19.0). Run npm ci, npm test, npm run build, npm run verify:rea.
2. For Electron development, normal npm ci runs its install script. If installed using --ignore-scripts, run node node_modules/electron/install.js before npm start.
3. Validate desktop startup on the user's Mac. This environment verified build/core plus the real REA handshake, discovery and binary_session call. Real analysis has since PASSED both in a later container and on the user's Mac (see VERIFIED.md). Desktop window, .asar analysis and real Ollama chat now PASS on the user's Mac (see VERIFIED.md). Do not bypass the ownership guard; rerun on the user’s Mac.
4. Fix lifecycle/security issues before expanding targets; then build the evidence-driven map and beginner summary. Work through M1 acceptance criteria; never claim the starter is production-ready.

## Implemented

- Electron main/preload boundary, React UI, choose/drop, progress text and cancel action.
- Separate pinned REA MCP process, fixed launch vector, static tool allow-list, live discovery and binary_session capture.
- Real JS/ASAR summary analysis and complete bundle export before connection close.
- Local JSON project persistence, atomic project metadata writes and restart recovery to interrupted.
- LM Studio/Ollama model discovery using OpenAI-compatible endpoints.
- Loopback-only AI requests, redirect rejection, summary-grounded explanations without tool execution.
- Markdown report and full evidence sidecar export.
- Owned Electron fixture, four automated tests and a live REA integration verifier (analysis blocked here; see VERIFIED.md).

## Material limitations / next actions in order

1. DONE (core, see VERIFIED.md): bounded/abortable connect, owned PID tracking, verified process-tree cleanup (src/core/process-cleanup.mjs), `cancelling` persisted until cleanup confirmed, quit waits up to 15 s. macOS descendant listing via /bin/ps VERIFIED on the user's Mac. REMAINING: Windows enumeration; exercise cancel/quit in a running Electron app on the user's Mac.
2. DONE: SQLite store with migrations/transactions/WAL (src/core/projects.mjs), persisted job events, legacy JSON import, unreadable records shown not skipped. Conversations/messages persisted. REMAINING: multi-job queue (still serial, one target per job).
3. PARTLY DONE: plain-English summary + findings list with evidence links (src/core/findings.mjs). Architecture map DONE (src/core/graph.mjs, src/ui/map.jsx). Security checks + key scan DONE (src/core/security.mjs, secret-scan.mjs). REMAINING: exact file locations on summary rows; endpoints when REA reports them. Build projections from actual bundle schema with fixtures. Preserve parent_evidence_id, provenance and limitations. Never fabricate graph nodes or evidence confidence.
4. DONE: numbered-fact context, per-line citation checking, SSE streaming with Stop, saved multi-turn conversations (src/core/grounding.mjs, local-model.mjs, src/ui/answer.jsx). Label model references as unverified until resolved against retained facts. AI prompt instructions alone do not guarantee grounding.
5. Model response limit currently checks size after response.text() buffers the body. Use a streaming byte limit and validate response schema/content types. Apply a bounded limit to all IPC payloads and report export/import.
6. Imported target directory can contain irrelevant or huge material. Add explicit admission/resource policies, parser isolation and source mutation handling. No claim of fully offline operation until network-denied tests cover REA subprocesses.
7. PARTLY DONE: .app/.asar auto-resolution to Contents/Resources/app.asar with unpacked-files note (src/core/target.mjs). REMAINING: URL input, .NET/native/APK workflows.
8. Report export writes directly after save dialog and may leave a report without sidecar if copy fails. Make a versioned atomic portable export with clear per-file results and an import path. Chat is not saved yet; report privacy/redaction controls remain to build.
9. Introduce shared runtime schemas and TypeScript in small steps. Main-process actions are named but input validation needs stronger schemas and regression tests. Restrict localEndpoint paths to expected provider API routes if adding user-configured endpoints.
10. Add packaged desktop integration tests, accessibility review and real provider/OS verification. Electron binary installation, signed packaging, auto-update policy and licence/SBOM review remain undone.

No cloud fallback, arbitrary shell, model-triggered process execution, runtime capture or generated-code execution without implementing their explicit scope/consent/sandbox requirements. Do not join Discord, contact maintainers or publish anything without a user request.

## Working conventions

Preserve existing user work; no destructive target changes. Run relevant tests after meaningful edits. Keep upstream behind adapter and do not deep-import its modules. Maintain a VERIFIED.md with commands, environment and outcomes. Finish one usable vertical slice before reconstruction. Do not exhaust context on cosmetic rewrites; checkpoint this file with exact unfinished work.
