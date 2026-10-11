// Architecture map projection from REA's JavaScriptApplicationGraph (full evidence bundle).
// Rules: never invent nodes or links. File-level nodes are folded into the architectural node REA
// itself maps them to (via its maps_to / contains edges); every displayed link lists the REA edge
// IDs it came from and keeps the weakest epistemic state/confidence of those edges.

export const LANES = [
  { id: 'package', title: 'Package' },
  { id: 'main', title: 'Main process' },
  { id: 'messages', title: 'Messages' },
  { id: 'bridge', title: 'Preload bridge' },
  { id: 'page', title: 'Web pages' },
  { id: 'other', title: 'Other' },
];
const LANE_OF = {
  package: 'package',
  'electron-main': 'main', 'browser-window': 'main', 'ipc-handler': 'main', 'utility-process': 'main', 'native-addon': 'main',
  'ipc-channel': 'messages',
  'electron-preload': 'bridge', 'context-bridge-api': 'bridge',
  'electron-renderer': 'page',
};
const FRIENDLY = {
  package: 'App package', 'electron-main': 'Main process', 'browser-window': 'Window', 'ipc-handler': 'Message handler',
  'ipc-channel': 'Message channel', 'electron-preload': 'Preload script', 'context-bridge-api': 'API exposed to page',
  'electron-renderer': 'Web page', 'utility-process': 'Utility process', 'native-addon': 'Native add-on',
};
// File-level plumbing: folded into architecture nodes, never drawn on their own.
const PLUMBING = new Set(['artifact', 'asar-entry', 'javascript-asset', 'javascript-module']);
// Relations that describe data moving at runtime (direction = data direction), vs. structure.
const FLOW = { invokes: 'forward', sends: 'forward', emits: 'forward', exposes: 'forward', handles: 'reverse', listens: 'reverse' };
const STATE_RANK = { observed: 0, inferred: 1, unknown: 2, unavailable: 3 };
const CONF_RANK = { exact: 0, high: 1, medium: 2, low: 3, unknown: 4 };
const weakest = (values, rank) => values.reduce((a, b) => ((rank[b] ?? 9) > (rank[a] ?? 9) ? b : a));

export function findApplicationGraph(bundle) {
  for (const record of bundle?.records ?? []) {
    const graph = record?.normalized_result?.graph;
    if (graph?.schema === 'JavaScriptApplicationGraph' && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) return { graph, evidenceId: record.evidence_id };
  }
  return null;
}

function label(node) {
  const o = node.observations?.[0];
  const props = o?.properties ?? {};
  if (node.kind === 'browser-window') return 'Window';
  return String(o?.label ?? props.channel ?? props.path ?? node.identity?.key ?? node.kind);
}

export function projectArchitecture(bundle, { maxNodes = 300 } = {}) {
  const found = findApplicationGraph(bundle);
  if (!found) return null;
  const { graph, evidenceId } = found;
  const byId = new Map(graph.nodes.map(n => [n.node_id, n]));

  // owner(plumbing node) -> architecture nodes REA maps to it (asset <- maps_to <- electron-main, etc.).
  const owners = new Map();
  const addOwner = (plumbing, arch) => { if (!owners.has(plumbing)) owners.set(plumbing, new Set()); owners.get(plumbing).add(arch); };
  for (const e of graph.edges) {
    const s = byId.get(e.source_node_id), t = byId.get(e.target_node_id);
    if (e.relation === 'maps_to' && s && t && !PLUMBING.has(s.kind) && PLUMBING.has(t.kind)) addOwner(t.node_id, s.node_id);
  }
  // A module inherits the owners of the asset that contains it.
  for (const e of graph.edges) {
    const s = byId.get(e.source_node_id), t = byId.get(e.target_node_id);
    if (e.relation === 'contains' && s?.kind === 'javascript-asset' && t?.kind === 'javascript-module') for (const o of owners.get(s.node_id) ?? []) addOwner(t.node_id, o);
  }
  const resolve = id => { const n = byId.get(id); if (!n) return []; return PLUMBING.has(n.kind) ? [...(owners.get(id) ?? [])] : [id]; };

  const architecture = graph.nodes.filter(n => !PLUMBING.has(n.kind));
  const nodes = architecture.map(n => {
    const o = n.observations?.[0] ?? {};
    return {
      id: n.node_id, kind: n.kind, friendly: FRIENDLY[n.kind] ?? n.kind, label: label(n), lane: LANE_OF[n.kind] ?? 'other',
      state: o.evidence?.state ?? 'unknown', confidence: o.evidence?.confidence ?? 'unknown', authority: o.evidence?.authority ?? null,
      location: o.evidence?.location?.available ? o.evidence.location.value : null,
      extractor: o.evidence?.extractor?.operation ?? null, observationId: o.observation_id ?? null,
      limitations: o.evidence?.limitations ?? [],
    };
  });

  const links = new Map();
  for (const e of graph.edges) {
    if (e.relation === 'maps_to') continue;
    for (const source of resolve(e.source_node_id)) for (const target of resolve(e.target_node_id)) {
      if (source === target) continue;
      const key = `${source}|${e.relation}|${target}`;
      const link = links.get(key) ?? { id: key, source, target, relation: e.relation, edgeIds: [], states: [], confidences: [], locations: [], properties: [], folded: false };
      link.folded ||= e.source_node_id !== source || e.target_node_id !== target;
      link.edgeIds.push(e.edge_id); link.states.push(e.evidence?.state ?? 'unknown'); link.confidences.push(e.evidence?.confidence ?? 'unknown');
      if (e.evidence?.location?.available) link.locations.push(e.evidence.location.value);
      link.properties.push(e.properties ?? {}); links.set(key, link);
    }
  }
  let edges = [...links.values()].map(l => {
    const state = weakest(l.states, STATE_RANK), confidence = weakest(l.confidences, CONF_RANK);
    const dynamic = l.properties.some(p => p.channel_expression || p.resolution === 'dynamic' || p.resolution === 'unresolved');
    const direction = FLOW[l.relation] ?? null;
    return {
      id: l.id, source: l.source, target: l.target, relation: l.relation, edgeIds: l.edgeIds, locations: l.locations, properties: l.properties,
      state, confidence, flow: direction, folded: l.folded,
      // "clear" = drawn solid (and animated if it is a data flow); anything weaker is dashed and still.
      clear: !dynamic && (state === 'observed' || state === 'inferred') && (confidence === 'exact' || confidence === 'high'),
    };
  });
  // A sender->handler shortcut duplicates sender->channel->handler; keep the evidence, hide the line.
  const viaChannel = new Set(edges.filter(e => e.relation === 'handles').map(e => e.source));
  edges = edges.map(e => ({ ...e, hidden: e.relation === 'invokes' && viaChannel.has(e.target) && byId.get(e.target)?.kind === 'ipc-handler' }));

  const total = nodes.length;
  const shown = nodes.slice(0, maxNodes);
  const shownIds = new Set(shown.map(n => n.id));
  return {
    evidenceId, graphId: graph.graph_id ?? null,
    coverage: graph.coverage ?? null, limitations: graph.limitations ?? [],
    nodes: shown, edges: edges.filter(e => shownIds.has(e.source) && shownIds.has(e.target)),
    totals: { nodes: total, shown: shown.length, folded: graph.nodes.length - architecture.length, rawEdges: graph.edges.length },
  };
}

// Deterministic lane layout (no physics): columns by lane; rows ordered by a few barycentre passes
// so connected parts sit level with each other. Same input always gives the same picture.
export function layout(map, { colWidth = 220, rowHeight = 74, top = 56, left = 30 } = {}) {
  const lanes = LANES.filter(l => map.nodes.some(n => n.lane === l.id));
  const columns = lanes.map(l => map.nodes.filter(n => n.lane === l.id).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)));
  const neighbours = new Map(map.nodes.map(n => [n.id, []]));
  for (const e of map.edges) if (!e.hidden && neighbours.has(e.source) && neighbours.has(e.target)) { neighbours.get(e.source).push(e.target); neighbours.get(e.target).push(e.source); }
  const row = new Map(); columns.forEach(c => c.forEach((n, i) => row.set(n.id, i)));
  for (let pass = 0; pass < 4; pass++) for (const column of columns) {
    const score = n => { const ns = neighbours.get(n.id).filter(id => row.has(id)); return ns.length ? ns.reduce((t, id) => t + row.get(id), 0) / ns.length : row.get(n.id); };
    const scored = column.map(n => [n, score(n)]);
    scored.sort((a, b) => a[1] - b[1] || a[0].label.localeCompare(b[0].label));
    column.splice(0, column.length, ...scored.map(x => x[0])); column.forEach((n, i) => row.set(n.id, i));
  }
  const positions = {};
  columns.forEach((column, c) => column.forEach((n, r) => { positions[n.id] = { x: left + c * colWidth, y: top + r * rowHeight }; }));
  const rows = Math.max(1, ...columns.map(c => c.length));
  return { lanes: lanes.map((l, i) => ({ ...l, x: left + i * colWidth })), positions, width: left * 2 + lanes.length * colWidth - 40, height: top + rows * rowHeight + 20 };
}
