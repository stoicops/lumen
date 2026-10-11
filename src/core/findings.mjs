// Plain-English projection of an REA summary view. Pure and deterministic: every row carries the
// evidence_id and exact field path it came from. Nothing here adds facts REA did not report.
// Counts are "observed in static syntax", never runtime behaviour; zero means "not observed", not "absent".

const FACTS = [
  ['statistics.parsed_javascript_files', 'JavaScript files parsed', 'files'],
  ['statistics.relevant_files', 'Relevant files inventoried', 'files'],
  ['statistics.modules', 'Modules recovered', 'structure'],
  ['statistics.nested_asar_containers', 'Nested .asar archives', 'files'],
  ['electron.browser_windows', 'Browser windows created', 'electron'],
  ['electron.preload_entrypoints', 'Preload scripts', 'electron'],
  ['electron.context_bridge_apis', 'APIs exposed to web pages (contextBridge)', 'electron'],
  ['electron.exposed_api_members', 'Exposed API members', 'electron'],
  ['electron.ipc.operations', 'IPC messaging operations', 'ipc'],
  ['electron.ipc.literal_channels', 'Named IPC channels', 'ipc'],
  ['electron.ipc.main_handlers', 'Main-process IPC handlers', 'ipc'],
  ['electron.ipc.dynamic_channel_operations', 'IPC calls with computed channel names', 'ipc'],
  ['electron.ipc.unpaired_literal_renderer_transmissions', 'Page messages with no matching handler', 'ipc'],
  ['electron.sender_validation_observations', 'IPC sender checks', 'security'],
  ['electron.utility_processes', 'Utility processes', 'electron'],
  ['electron.native_addon_bindings', 'Native add-on bindings', 'native'],
  ['statistics.parse_failures', 'Files that failed to parse', 'quality'],
  ['statistics.invalid_utf8_files', 'Files with invalid text encoding', 'quality'],
];

const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function describeEvidence(evidence) {
  const view = evidence?.normalized_result;
  const summary = view?.summary;
  if (!summary) return null;
  const evidenceId = evidence.evidence_id ?? null;
  const parentId = view.parent_evidence_id ?? evidence.parameters?.parent_evidence_id ?? null;

  const facts = FACTS.map(([path, label, group]) => {
    const value = get(summary, path);
    if (typeof value !== 'number') return null;
    return { label, group, value, status: value > 0 ? 'observed' : 'not-observed', field: `normalized_result.summary.${path}`, evidenceId };
  }).filter(Boolean);

  const value = path => facts.find(f => f.field.endsWith(path))?.value ?? 0;
  const isElectron = value('electron.browser_windows') > 0 || value('electron.preload_entrypoints') > 0;
  const headline = [
    `${summary.format === 'asar' ? 'An .asar archive' : 'A folder'} with ${plural(value('statistics.parsed_javascript_files'), 'JavaScript file')} REA could read.`,
    isElectron
      ? `It looks like an Electron desktop app: ${plural(value('electron.browser_windows'), 'window')}, ${plural(value('electron.preload_entrypoints'), 'preload script')} and ${plural(value('electron.ipc.literal_channels'), 'named message channel')} between its parts were seen in the code.`
      : 'No Electron windows or preload scripts were seen in the code.',
    'This is what the code says, read without running it. It does not prove what the app does when it runs.',
  ];

  const coverage = summary.coverage ?? {};
  const families = (coverage.semantic?.families ?? []).map(f => ({
    name: f.family, status: f.status, relations: f.retained_relations ?? 0, unknowns: f.unknown_count ?? 0,
    field: 'normalized_result.summary.coverage.semantic.families', evidenceId,
  }));

  return {
    evidenceId, parentId,
    target: { name: evidence.subject?.name, format: summary.format, sha256: summary.root_artifact_sha256 },
    confidence: evidence.confidence ?? 'unknown', authority: evidence.authority ?? 'unknown',
    headline, facts,
    coverage: {
      application: coverage.application?.status ?? 'unknown',
      semantic: coverage.semantic?.status ?? 'unknown',
      unknownCount: (coverage.application_unknowns ?? 0) + (coverage.semantic_unknowns ?? 0),
      truncated: Boolean(coverage.application?.truncated || coverage.semantic?.truncated),
      families,
    },
    limitations: Array.isArray(view.limitations) ? view.limitations.filter(x => typeof x === 'string') : [],
    unknowns: Array.isArray(view.unknowns) ? view.unknowns.filter(x => typeof x === 'string') : [],
  };
}

// REA tool errors arrive as JSON text; turn them into a sentence a non-specialist can act on.
export function friendlyError(text) {
  if (typeof text !== 'string') return { message: 'Something went wrong.', detail: '' };
  try {
    const { error } = JSON.parse(text);
    if (!error) throw new Error();
    const issues = (error.details?.issues ?? []).map(i => i.message).filter(Boolean);
    return { message: issues[0] ?? error.message ?? 'REA could not complete the analysis.', detail: text };
  } catch { return { message: text.split('\n')[0].slice(0, 300), detail: text }; }
}
