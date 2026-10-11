# Lumen Local Studio: implementation requirements

Owner: Surinder Lall. Prepared 11 October 2026. Working name only; trademark/domain clearance remains open.

## 1. Product and scope

Build an approachable local desktop application that helps everyday users inspect software they are authorised to examine, understand evidence-supported architecture and behaviour, and eventually implement their own capabilities. Use an independent brand and accurately describe REA as the analysis engine. Do not imply upstream endorsement.

Core loop: select target → static evidence → understandable map and explanation → selected feature specification → independent implementation → behavioural verification.

MVP promise: “Drop a JavaScript app. Understand what the evidence shows. Ask your local AI.” Do not claim “any app”, verified runtime behaviour or complete recreation in MVP.

Primary persona: an interested non-specialist with LM Studio installed who does not know MCP, ASAR or decompilation. Secondary persona: a technical analyst who needs raw evidence and exact provenance.

MVP supports local extracted JavaScript application directories and ASAR files. It must work without a model for analysis and export. Electron .app/.exe auto-routing, .NET, websites, APKs and native binaries are subsequent milestones. URL intake must have a separate network consent and bounded download design before release. Entering a URL must never silently launch a browser, execute an app or send target content to a cloud model.

## 2. Verified upstream baseline

Source: https://github.com/morluto/rea
Inspected revision: 069308bbe6d73b1d87038b43c9121658325042a9.
Inspected package metadata: rea-agents 6.4.0, MIT; Node ^22.19.0 || ^24.11.0 || >=26.0.0. Starter pins Node 24.11+ and package 6.4.0.

Read these upstream documents before changing the adapter: docs/mcp-contracts.md, docs/roadmap.md, docs/architecture.mermaid, docs/javascript-application-graph.md, docs/javascript-application-workflows.md, docs/migration-6.2.md and docs/testing.md. See UPSTREAM-NOTES.md for integration details.

Important corrections to the earlier feedback:

- Progress and cancellation already exist. Treat reported operation markers honestly; they may not measure percentage completion.
- REA already supplies epistemic states and confidence on graph facts. Preserve them rather than generating confidence percentages.
- Updating a dependency is not automatic compatibility: pin versions and run contract tests before upgrades.
- “Static” does not mean risk-free parsing. Keep resource bounds and hostile-input tests.
- A checkbox, disclaimer or generated-code watermark does not establish a legally clean-room implementation. Provenance separation and human review are separate requirements.
- The inspected roadmap lists engine verification and workflow priorities; it does not list a desktop GUI. This does not establish that maintainers have no private GUI plans. No maintainer contact has been made.

## 3. Architecture

Electron main process owns trusted filesystem, dialogs, project persistence, REA lifecycle and local model requests. The sandboxed renderer owns presentation only. Use a minimal context-isolated preload bridge with named actions; never expose generic invoke, shell, exec, arbitrary filesystem access or an unrestricted MCP client.

REA runs as a separate owned stdio process using the installed pinned package and a fixed command vector. Do not run npx at analysis time or import REA internals. The adapter is the only consumer of MCP. Discover tools and live identity on connection; refuse incompatible contracts with an actionable error. One independent REA session per analysis job initially; serial concurrency by default.

Future production structure: TypeScript monorepo with desktop, rea-adapter, model-providers, project-store, shared-contracts and UI. The supplied starter uses ES modules/React JSX to provide a runnable slice. Migrate incrementally after preserving the verified fixture lane; do not rewrite solely to match directory names.

Keep native engines optional. Do not bundle commercial tools. Inventory transitive licences, notices and redistribution conditions before distributing REA or other components. MIT on the top-level project does not replace this review.

## 4. Functional requirements and acceptance

| ID | Requirement | Acceptance |
|---|---|---|
| ONB-01 | Readiness page | Displays app/REA versions, platform, detected local providers, missing dependencies and recovery steps without a terminal. |
| ONB-02 | No-model workflow | Analysis, map browsing, save/reopen and report export succeed without AI. |
| IN-01 | Folder/ASAR selection | Native chooser and drop zone resolve the same target type. Unsupported types explain the supported alternatives. |
| IN-02 | Stable target identity | Record root artifact digest from REA and source identity; detect changed source before follow-ups that reread it. Reopening evidence must not require original files. |
| IN-03 | No target execution | Static milestone never evaluates imported target JavaScript, launches its executables or installs target dependencies. |
| JOB-01 | Visible progress | Show truthful phase/message, elapsed time and resource warnings. Indeterminate progress if no measured total. |
| JOB-02 | Durable jobs | Persist queued/running/cancelling/cancelled/completed/failed/interrupted state, timestamps, errors and cleanup status. Recover unfinished jobs on restart. |
| JOB-03 | Cancellation | Cancel during connection, parsing, export and inference. Distinguish requested cancellation from confirmed stopped work. Verify owned process cleanup. |
| JOB-04 | Admission/resource limits | Serial jobs initially; configurable wall-time, memory/disk and input-size policies. Bounds must exist outside the renderer. |
| EV-01 | Canonical retention | Save complete engine Evidence bundle with exact IDs, raw provider result, normalized result, profile and provenance. UI summaries are derived views. |
| EV-02 | Honest labels | Observed / Inferred / Unknown / Unavailable labels retain engine epistemic state and coverage. “Observed static syntax” must not imply runtime verification. |
| EV-03 | Evidence links | Clicking a claim reveals originating Evidence, exact location or unavailable reason, extractor, authority and limits. |
| EV-04 | Large results | Use summary + paged inspect_analysis_view. Transport admission errors offer smaller pages/export, never silent truncation. |
| MAP-01 | Structural map | Render packages, modules, main/preload/renderer, IPC and endpoints only where supplied; uncertain links visibly differentiated. |
| MAP-02 | Useful navigation | Pan/zoom, fit view, search, kind filters, keyboard list alternative, selected-node inspector and evidence link. |
| MAP-03 | Bounded rendering | Virtualize large maps/lists, preserve all evidence on disk; show displayed subset count and filter reason. |
| AI-01 | Provider discovery | Probe LM Studio 127.0.0.1:1234/v1 and Ollama 127.0.0.1:11434/v1; distinguish unavailable server, no loaded model, timeout and incompatible response. |
| AI-02 | Local-only enforcement | Only approved numeric loopback URLs; reject credentials, redirects, alternate schemes and nonlocal endpoints in the trusted request layer. Renderer has no network. |
| AI-03 | Evidence-grounded chat | Supply selected bounded evidence, instruction/data separation and references. Unknowns remain unknown; AI answers visibly distinct from canonical findings. |
| AI-04 | Capability probe | Small owned benchmark measures structured output, citation adherence and context handling. Report measured results with date; do not assert coding competence from model name. |
| AI-05 | Streaming | Stream answer text and tool/job status with cancel. Do not require or attempt to extract hidden chain-of-thought. Handle provider reasoning fields only if explicitly intended as public summaries. |
| AI-06 | Context management | Estimate token budget, select relevant views, disclose omitted evidence and never silently claim full coverage. |
| PROJ-01 | Save/reopen | Stable project IDs; atomic writes; schema migrations; reopen without model or original target. Future SQLite with transactions/WAL. |
| PROJ-02 | Portable export/import | Versioned manifest, full Evidence, report, optional conversations and source hashes; validation, size bounds and path safety on import. |
| PROJ-03 | Deletion | User can delete/export their project and chat, understands retention, and can omit sensitive paths from shared reports. |
| UX-01 | Beginner/expert views | Beginner sees plain-English phases and summaries; Expert adds provider schemas, graph facts and diagnostics. |
| UX-02 | Accessible states | Keyboard navigation, visible focus, labels, readable contrast, reduced motion, empty/loading/error/interrupted states and responsive layout. |

## 5. Data model and jobs

Production tables: projects, targets, jobs, job_events, evidence_records, evidence_blobs, findings, model_profiles, conversations and messages. Findings reference canonical evidence_id plus field/location; never overwrite engine facts with AI output. Store model/provider/version and context selection for each answer. Keep secrets out of logs and evidence summaries intended for sharing.

State transitions: queued → running → completed or failed; running → cancelling → cancelled after confirmed cleanup; queued/running/cancelling discovered on launch → interrupted. A cancellation request can fail or leave cleanup pending. Publication is atomic: cancellation before commit must not expose a successful report. Retry creates a new job and retains prior evidence.

A project can contain multiple targets and jobs eventually. Initial product uses one target per job. Source-derived graphs and model conversations live separately. Runtime captures need consent records naming target, requested interaction, filesystem/network effects and cleanup scope.

## 6. Security and trust boundaries

Target packages, recovered strings, source maps, graph labels and AI responses are untrusted. Render as escaped text; no unsafe HTML or markdown scripts. Model responses cannot invoke tools. Future tool use needs server-enforced allow-list, schema validation, scope validation and approval policy; annotations alone are not access control.

Desktop: contextIsolation true, sandbox true, nodeIntegration false, CSP, deny navigation/new windows, verify IPC sender/frame, validate every input in main process, deny renderer network and permission requests. File dialogs grant specific paths; do not expose generic read/write primitives.

Local-only promise has limits: this app can enforce its own destinations, but it cannot prove that an independently configured local model server does not relay to the internet. Explain this in Settings, not as repeated blocking prompts. Full offline verification needs a separate network-denied integration lane including REA and its descendants.

Hostile-input tests include symlinks, archive path traversal, symlink loops, oversized source maps, malformed ASAR, integrity contradictions, hanging providers, prompt injection and output HTML. Use parser isolation/resource limits even in static mode. Runtime targets require stronger disposable isolation and explicit consent before launch. Never promise Electron context isolation is a sandbox for target binaries.

## 7. Reconstruction requirements (later)

User selects one capability and requested differences. Produce a behaviour specification with input/output examples, unknowns and required tests. Require approval of this spec before code generation if choices materially affect results. Generate into a new owned project; never modify original target.

Independent implementation mode uses a sanitised behaviour specification and permitted observations, not recovered implementation code or proprietary assets. Preserve source provenance, permission basis and dependencies. If the same model/session has seen decompiled implementation, do not market the outcome as strict clean-room work. Formal separation can require separate people and review depending on the engagement.

Preview generated code only in an isolated runner with filesystem/network limits. Never execute generated install scripts automatically. Side-by-side tests compare defined scenarios, tolerances, screenshots where appropriate and data contracts. Mark untested behaviours and external dependencies clearly. No “clone complete” claim from visual similarity.

## 8. Milestones

M0 — Contract baseline: pinned dependency, live MCP discovery, owned fixture analysis, export, cancellation tests and licence inventory.

M1 — Drop → understand: onboarding, folders/ASAR, durable jobs, summary/findings, structural map, evidence inspector, save/reopen, report/evidence export and local explanation chat. No reconstruction or runtime capture required for this milestone.

M1.1 — Reliability: SQLite/migrations, streaming/cancel chat, bounded context retrieval, model probe, portable import, hostile fixtures and desktop end-to-end coverage.

M2 — Expanded inspection: .NET readiness, .app target resolution, Ghidra/JADX readiness and platform-specific validation. URL/web capture in a distinct consented workflow.

M3 — Feature specification and independent generation, isolated preview and behavioural comparison.

M4 — Signed/notarised macOS build, Windows/Linux packaging, update policy, headless mode and measured hardware guidance.

Do not quietly claim all platforms because Electron starts on them. Maintain a matrix of actual verified lanes, native prerequisites and exclusions.

## 9. Release gates

Unit tests: endpoint restrictions, context admission, state machine, project traversal, redaction and graph projection.
Contract tests: real pinned REA startup, tool inventory/schema compatibility, JS fixture with module/IPC facts, unknowns/limitations, large-result pagination and evidence round-trip.
Lifecycle tests: cancellation at each phase, crash recovery, renderer reload, engine failure, disk full and confirmed child cleanup.
Model tests: fake OpenAI-compatible server + optional real LM Studio/Ollama lanes, no tools, redirects blocked, invalid/large JSON, no model loaded, timeout/cancel and injection resistance.
Desktop tests: packaged preload/CSP, choose/drop, progress, map click → evidence, save/reopen/export and keyboard workflow. At least one owned real Electron fixture on each claimed OS.
Distribution: exact lockfile, reproducible build, licences/notices/SBOM, no bundled commercial decompiler, signed artefacts, upgrade rollback and privacy statement.
Performance: record target sizes, hardware and measured latencies before setting public budgets. The development target is responsive input during analysis and no renderer blocking over 100 ms; measure it rather than assuming it.
