import React, { useEffect, useMemo, useRef, useState } from 'react';
import { layout } from '../core/graph.mjs';

const NODE_W = 170, NODE_H = 46;
const RELATION = { invokes: 'sends a message to', handles: 'handles', exposes: 'exposes', loads: 'loads', contains: 'contains', imports: 'imports' };
const STATE_TEXT = { observed: 'Seen directly in code', inferred: 'Worked out from code', unknown: 'Unknown', unavailable: 'Unavailable' };

function edgePath(a, b) {
  const sx = a.x + NODE_W, sy = a.y + NODE_H / 2, tx = b.x, ty = b.y + NODE_H / 2;
  if (b.x > a.x) { const mx = (sx + tx) / 2; return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`; }
  if (b.x < a.x) { const s2 = a.x, t2 = b.x + NODE_W, mx = (s2 + t2) / 2; return `M${s2},${sy} C${mx},${sy} ${mx},${ty} ${t2},${ty}`; }
  // Same column: loop out to the right.
  const x = a.x + NODE_W, bulge = x + 40; return `M${x},${sy} C${bulge},${sy} ${bulge},${ty} ${x},${ty}`;
}

export function ArchitectureMap({ projectId }) {
  const [map, setMap] = useState(null), [error, setError] = useState('');
  const [selected, setSelected] = useState(null), [query, setQuery] = useState(''), [hiddenKinds, setHiddenKinds] = useState(new Set());
  const [playing, setPlaying] = useState(true), [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svg = useRef(null), drag = useRef(null);

  useEffect(() => { setMap(null); setSelected(null); setError(''); window.studio.architecture(projectId).then(setMap).catch(e => setError(e.message)); }, [projectId]);
  const geometry = useMemo(() => map?.nodes ? layout(map) : null, [map]);
  const byId = useMemo(() => Object.fromEntries((map?.nodes ?? []).map(n => [n.id, n])), [map]);
  const kinds = useMemo(() => [...new Set((map?.nodes ?? []).map(n => n.friendly))], [map]);
  const visible = n => !hiddenKinds.has(n.friendly);
  const matches = n => query && `${n.label} ${n.friendly}`.toLowerCase().includes(query.toLowerCase());

  const fit = () => setView({ x: 0, y: 0, k: 1 });
  const onWheel = e => { e.preventDefault(); const k = Math.min(3, Math.max(.4, view.k * (e.deltaY < 0 ? 1.1 : .9))); setView({ ...view, k }); };
  useEffect(() => { const el = svg.current; if (!el) return; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); });

  if (error) return <section className="card"><p>{error}</p></section>;
  if (!map) return <section className="card"><p className="hint-text">Loading map…</p></section>;
  if (map.unavailable) return <section className="card"><p>{map.unavailable}</p></section>;

  const edges = map.edges.filter(e => !e.hidden && visible(byId[e.source]) && visible(byId[e.target]));
  const nodes = map.nodes.filter(visible);
  const pick = item => setSelected(item);

  return <>
    <section className="card map-card">
      <div className="map-tools">
        <input className="search" type="search" placeholder="Search parts" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search the map" />
        <div className="chips">{kinds.map(k => <button key={k} className={`chip ${hiddenKinds.has(k) ? '' : 'on'}`} aria-pressed={!hiddenKinds.has(k)}
          onClick={() => { const s = new Set(hiddenKinds); s.has(k) ? s.delete(k) : s.add(k); setHiddenKinds(s); }}>{k}</button>)}</div>
        <div className="map-buttons">
          <button className="btn" onClick={() => setPlaying(!playing)} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
          <button className="btn" onClick={fit}>Fit</button>
        </div>
      </div>
      <svg ref={svg} className={`map ${playing ? 'playing' : ''}`} viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label="Architecture map; use the list below for keyboard access"
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
        onPointerMove={e => { if (drag.current) setView({ ...view, x: drag.current.vx + (e.clientX - drag.current.x) / view.k, y: drag.current.vy + (e.clientY - drag.current.y) / view.k }); }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead" /></marker></defs>
        <g transform={`scale(${view.k}) translate(${view.x},${view.y})`}>
          {geometry.lanes.map(l => <g key={l.id}><rect className="lane" x={l.x - 12} y={8} width={NODE_W + 24} height={geometry.height - 16} rx="12" /><text className="lane-title" x={l.x} y={32}>{l.title}</text></g>)}
          {edges.map(e => {
            const d = edgePath(geometry.positions[e.source], geometry.positions[e.target]);
            const reverse = e.flow === 'reverse';
            const on = selected?.id === e.id;
            return <g key={e.id} className={`edge ${e.clear ? 'clear' : 'weak'} ${e.flow ? 'flow' : 'structure'} ${on ? 'on' : ''}`} onClick={() => pick(e)}>
              <path d={d} className="edge-hit" />
              <path d={d} className="edge-line" markerEnd={!reverse ? 'url(#arrow)' : undefined} markerStart={reverse ? 'url(#arrow)' : undefined} />
              {e.flow && e.clear && <path d={d} className={`edge-pulse ${reverse ? 'reverse' : ''}`} />}
              <title>{`${byId[e.source].label} ${RELATION[e.relation] ?? e.relation} ${byId[e.target].label}`}</title>
            </g>;
          })}
          {nodes.map(n => { const p = geometry.positions[n.id]; return <g key={n.id} className={`node lane-${n.lane} ${selected?.id === n.id ? 'on' : ''} ${matches(n) ? 'match' : ''} ${query && !matches(n) ? 'dim' : ''}`} transform={`translate(${p.x},${p.y})`} onClick={() => pick(n)}>
            <rect width={NODE_W} height={NODE_H} rx="10" />
            <text x="12" y="19" className="node-kind">{n.friendly}</text>
            <text x="12" y="35" className="node-label">{n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}</text>
          </g>; })}
        </g>
      </svg>
      <div className="legend">
        <span><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" className="lg clear" /></svg> Clear link in code</span>
        <span><svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" className="lg weak" /></svg> Partial or uncertain</span>
        <span className="legend-note">Moving dots show which way data is written to travel in the code, not live traffic.</span>
      </div>
      <p className="hint-text">Showing {map.totals.shown} of {map.totals.nodes} parts. {map.totals.folded} file-level entries are folded into the part REA linked them to. Drag to move, scroll to zoom.</p>
    </section>
    {selected && <Inspector item={selected} byId={byId} evidenceId={map.evidenceId} onClose={() => setSelected(null)} />}
    <section className="card">
      <details><summary>All parts and links as a list ({map.nodes.length} parts, {map.edges.length} links)</summary>
        <ul className="plain keyboard-list">
          {map.nodes.map(n => <li key={n.id}><button className="link" onClick={() => pick(n)}>{n.friendly}: {n.label}</button></li>)}
          {map.edges.map(e => <li key={e.id}><button className="link" onClick={() => pick(e)}>{byId[e.source].label} {RELATION[e.relation] ?? e.relation} {byId[e.target].label}</button></li>)}
        </ul>
      </details>
    </section>
  </>;
}

function Inspector({ item, byId, evidenceId, onClose }) {
  const isEdge = 'source' in item;
  const loc = l => l ? `${l.path ?? ''}${l.line ? `:${l.line}` : ''}` : null;
  return <section className="card inspector" aria-live="polite">
    <div className="card-head"><h3>{isEdge ? `${byId[item.source].label} → ${byId[item.target].label}` : `${item.friendly}: ${item.label}`}</h3><button className="link" onClick={onClose}>Close</button></div>
    <dl className="facts-dl">
      {isEdge && <><dt>Link</dt><dd>{byId[item.source].friendly} {RELATION[item.relation] ?? item.relation} {byId[item.target].friendly}{item.flow ? ' (data link)' : ' (structure)'}</dd></>}
      <dt>How sure</dt><dd>{STATE_TEXT[item.state] ?? item.state} · confidence “{item.confidence}”{isEdge && !item.clear ? ' · shown dashed' : ''}</dd>
      {isEdge ? <><dt>Where</dt><dd>{item.locations.map(loc).filter(Boolean).join(', ') || 'Location not recorded'}</dd>
        <dt>REA edge IDs</dt><dd>{item.edgeIds.map(id => <code key={id}>{id}</code>)}</dd>
        {item.folded && <><dt>Note</dt><dd>Drawn between the parts REA linked these files to.</dd></>}</>
        : <><dt>Where</dt><dd>{loc(item.location) ?? 'Location not recorded'}</dd><dt>Found by</dt><dd>{item.extractor ?? 'unknown'} · {item.authority ?? 'unknown'}</dd><dt>REA node ID</dt><dd><code>{item.id}</code></dd></>}
      <dt>Evidence</dt><dd><code>{evidenceId}</code></dd>
    </dl>
    <p className="hint-text">Static reading of the code. It shows what the code is written to do, not what happened when it ran.</p>
  </section>;
}
