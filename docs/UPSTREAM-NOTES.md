# REA integration notes

Verified from the source checkout at 069308bbe6d73b1d87038b43c9121658325042a9 on 11 October 2026.

## Adapter surface

| Surface | Contract and use |
|---|---|
| MCP launch | Installed package scripts/rea.mjs mcp over stdio; fixed Node executable and argument vector. |
| tools/list | Full catalog including unavailable tools; catalog presence does not prove target/provider readiness. |
| binary_session | Live package/server/SDK/protocol and availability information; retain with each job. |
| analyze_javascript_application | input_path local directory or ASAR; detail summary retains full Evidence and returns summary view. integrity_policy fail by default. No open_binary required. |
| inspect_analysis_view | source {kind: retained-evidence, evidence_id}; view summary/item/page. Use source schemas for actual collection/selector options. |
| get_evidence_bundle | detail summary discovers retained IDs without large payloads; inspect exact IDs later. |
| export_evidence_bundle | Absolute path and overwrite false; atomically publishes canonical JSON and streams serialization. |
| trace_application_feature | Later feature tracing: application retained-evidence reference plus literal seed kind/value/match. Does not launch runtime/native providers implicitly. |
| trace_javascript_semantics | Later semantic tracing uses companion graph and evidence_contexts; do not assume authority is repeated on every fact. |

Evidence-producing responses: structuredContent.evidence_id, normalized_result, raw_result and analysis_profile. Retain complete canonical records; raw_result may be null. Lifecycle exports are not necessarily evidence-producing records. Tool errors can be text-only: handle isError before interpreting structuredContent.

A summary view has its own Evidence ID. normalized_result.parent_evidence_id identifies retained full application Evidence. Do not use a summary view ID where a workflow requires the application graph.

Session references are connection-local. Export before closing; fresh sessions cannot resolve old IDs. Opening another target preserves records, close_binary clears them. Reopening saved projects in the starter reads their locally persisted summary and bundle; it does not restore them into a new REA ledger. Implement portable bundle import before retained-reference workflows on reopened projects.

SDK pinned upstream: @modelcontextprotocol/client 2.3.1. callTool request options are the second argument. Pass onprogress and AbortSignal there. A rejected promise is not proof the server stopped. Operations yield at supported boundaries; synchronous parsing can delay cancellation. Preserve provisional/committed distinction.

Default MCP transport budget is 10 MiB. Use summary, inspect_analysis_view pages and exports; do not blindly raise memory budgets. Progress may be operation-start/completion markers rather than granular parsing percentage.

Observed/inferred/unknown/unavailable are epistemic states, separate from exact/high/medium/low/unknown confidence and complete/partial/unknown/unavailable coverage. In particular, static relationships can be inferred even when their source syntax is observed exactly.

Upgrades: do not track floating latest. Update pinned dependency and lockfile only after running owned fixture and lifecycle tests. Maintain a schema/version migration note and downstream projection compatibility tests.
