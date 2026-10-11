import React, { useEffect, useRef, useState } from 'react';

const row = (k, v) => v != null && <div key={k} className="kv"><dt>{k}</dt><dd>{String(v)}</dd></div>;

export function NativeView({ project, platform, onOpenSettings }) {
  const isMac = platform === 'darwin';
  const [data, setData] = useState(null), [error, setError] = useState(''), [diag, setDiag] = useState(null), [fixing, setFixing] = useState(''), [fixed, setFixed] = useState(null);
  const [running, setRunning] = useState(false), [runNote, setRunNote] = useState('');
  // Whether Ghidra is configured RIGHT NOW (live), not when this file was first imported. The per-project
  // native.engineConfigured flag is a snapshot from drop time, so configuring Ghidra afterwards never
  // enabled the button. Read the live settings instead.
  const [engineLive, setEngineLive] = useState(false);
  useEffect(() => { setData(null); setError(''); setDiag(null); setFixed(null); setRunNote(''); window.studio.native(project.id).then(setData).catch(e => setError(e.message)); window.studio.settings().then(s => setEngineLive(Boolean(s?.ghidraDir))).catch(() => {}); }, [project.id]);
  const fixPerms = async () => { setFixing('working'); try { const r = await window.studio.prepareGhidra(); setFixed(r); setDiag(await window.studio.diagnoseEngine()); } catch (e) { setFixed({ ok: false, message: e.message }); } finally { setFixing('done'); } };
  const [progress, setProgress] = useState('');
  useEffect(() => window.studio.onDecompileProgress(p => setProgress(p.message)), []);
  const decompile = async () => {
    setRunning(true); setRunNote(''); setError(''); setProgress('Starting…');
    try { const r = await window.studio.decompile(project.id); if (r.skipped) setRunNote(r.skipped); else setData(r); }
    catch (e) { setError(e.message); } finally { setRunning(false); setProgress(''); }
  };
  const canDecompile = data && data.opened && !data.engineReady && (engineLive || project.native?.engineConfigured);
  // Self-driving: once we know Ghidra is configured and the file is open but not yet decompiled, start it
  // automatically — the user asked not to hunt for a button. The main process still runs the memory guard,
  // so if RAM is tight it returns a skip note instead of launching and freezing the machine. Runs once per
  // project; the Stop button stays available, and a manual "Decompile again" remains after a skip.
  const autoStarted = useRef(null);
  useEffect(() => {
    if (canDecompile && !running && autoStarted.current !== project.id) { autoStarted.current = project.id; decompile(); }
  }, [canDecompile, running, project.id]);
  if (error) return <section className="card"><p>{error}</p></section>;
  if (!data) return <section className="card"><p className="hint-text">Loading…</p></section>;
  if (data.unavailable) return <section className="card"><p>{data.unavailable}</p></section>;
  if (!data.opened) return <section className="card"><h3>Could not open this file</h3><p>{data.reason}</p></section>;
  const id = data.identity ?? {};
  const sectionKeys = Object.keys(data.sections ?? {});
  return <div className="columns"><div className="col-main">
    <section className="card">
      <h3>What this file is</h3>
      <dl className="kv-list">
        {row('Type', id.format)}{row('Kind', id.kind)}{row('Architecture', id.architecture)}{row('SHA-256', id.sha256)}
      </dl>
      <p className="hint-text">Identified by REA without running the file. This is a native/compiled target, so Lumen reads its structure rather than its source.</p>
    </section>

    {project.native && project.engineSkipped ? <section className="card engine-needed"><h3>Ghidra skipped to protect your computer</h3><p>{project.engineSkipped}</p><button className="btn" onClick={onOpenSettings}>Open Settings</button></section> : !data.engineReady ? <section className="card engine-needed">
      <h3>Deep decompilation {running ? 'is running' : canDecompile ? 'is starting automatically' : 'needs an engine'}</h3>
      {canDecompile || running ? <>
        {running
          ? <div className="running-row"><div className="spinner" /><div><strong>Ghidra is working on this file…</strong><div className="meta">{progress || 'importing and analysing — this can take a few minutes'}</div></div></div>
          : <p>Ghidra is configured, so Lumen decompiles this file for you automatically — no button needed. It turns machine code into readable functions and runs a separate Ghidra engine that can use a lot of CPU and memory for a few minutes. Lumen checks you have enough free memory first so it won’t freeze your computer.</p>}
        <div className="ask-actions">
          {running ? <button className="btn" onClick={() => window.studio.cancelDecompile()}>Stop</button>
            : <button className="btn primary" onClick={decompile}>Decompile again</button>}
        </div>
        {runNote && <p className="inline-error">{runNote}</p>}
      </> : <>
        <p>Lumen can identify this binary and read its signature and layout, but turning machine code back into readable functions needs a decompiler engine. The free, open-source one is <strong>Ghidra</strong>.</p>
        <ol className="plain">
          <li>Install Ghidra (and Java 21) on this computer — Lumen’s Settings has the exact steps.</li>
          <li>Point Lumen at the Ghidra folder in Settings.</li>
          <li>Come back here and click “Decompile with Ghidra”.</li>
        </ol>
        <button className="btn primary" onClick={onOpenSettings}>Open Settings</button>
      </>}
      {(engineLive || project.native?.engineConfigured) && (data.engineMessage || diag) && <div className="inline-error" style={{ marginTop: 10 }}>
        <p>An engine folder is set, but the decompile did not run.</p>
        {data.engineMessage && <p><strong>Engine said:</strong> {data.engineMessage}</p>}
        {diag ? <>
          <p><strong>Java in use:</strong> {diag.javaHome ?? 'NONE FOUND — install Temurin 21, or set the Java home in Settings'}</p>
          <p><strong>Ghidra folder:</strong> {diag.ghidra?.ok ? 'OK' : (diag.ghidra?.detail ?? 'not detected')}</p>
          <p><strong>Ghidra usable:</strong> {diag.available === true ? 'yes' : 'NO'}{diag.failing ? ` — ${diag.failing.code ?? ''}: ${diag.failing.detail ?? ''}${diag.failing.remediation ? ` (${diag.failing.remediation})` : ''}` : ''}</p>
          {diag.available !== true && <div style={{ marginTop: 8 }}>
            {isMac && <><p className="hint-text">On macOS, downloaded Ghidra is often blocked by quarantine or its launcher is not executable. Lumen can fix that:</p>
            <button className="btn primary" onClick={fixPerms} disabled={fixing === 'working'}>{fixing === 'working' ? 'Fixing…' : 'Fix Ghidra permissions'}</button>
            {fixed && <div className="hint-text">{fixed.steps ? fixed.steps.map((s, i) => <div key={i}>{s.ok ? '✓' : '✗'} {s.label}</div>) : fixed.message}{fixed.ok && ' — now analyse this file again.'}</div>}</>}
          </div>}
        </> : <p className="hint-text">Checking the engine…</p>}
        {data.engineLog && <details open><summary>Ghidra engine log</summary><pre className="raw">{data.engineLog}</pre></details>}
        {diag && <details><summary>Full diagnostics</summary><pre className="raw">{diag.raw}</pre></details>}
      </div>}
    </section> : <section className="card">
      <div className="card-head"><h3>Decompilation result</h3><span className="meta">{data.providerUsed ?? 'engine'} · read without running</span></div>
      <StatTiles data={data.sections} />
      {sectionKeys.map(k => <StructuredSection key={k} title={k} value={data.sections[k]} />)}
      <p className="hint-text">This is what the engine recovered from the compiled binary; it does not prove runtime behaviour.</p>
    </section>}
  </div></div>;
}

// Humanise a snake/camel key for display.
const pretty = k => String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

// Pull the numeric and count-like fields across the result into headline stat tiles.
function StatTiles({ data }) {
  const tiles = [];
  const visit = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 2 || tiles.length > 12) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) tiles.push([pretty(k), v]);
      else if (Array.isArray(v) && v.length) tiles.push([pretty(k), v.length]);
      else if (v && typeof v === 'object') visit(v, depth + 1);
    }
  };
  visit(data, 0);
  const seen = new Set(); const unique = tiles.filter(([l]) => !seen.has(l) && seen.add(l)).slice(0, 8);
  if (!unique.length) return null;
  return <div className="sev-summary" style={{ gridTemplateColumns: `repeat(${Math.min(4, unique.length)}, 1fr)` }}>
    {unique.map(([label, value]) => <div key={label} className="sev-tile"><strong>{value}</strong><span>{label}</span></div>)}
  </div>;
}

// Render one result section readably: arrays become searchable, bounded lists; scalars become rows;
// nested objects recurse one level. Real engine data only — nothing invented.
function StructuredSection({ title, value, depth = 0 }) {
  const [query, setQuery] = useState('');
  if (value == null) return null;
  if (Array.isArray(value)) {
    const rows = value.map(v => (v && typeof v === 'object') ? (v.name ?? v.label ?? v.symbol ?? v.string ?? v.value ?? JSON.stringify(v)) : String(v));
    const filtered = query ? rows.filter(r => r.toLowerCase().includes(query.toLowerCase())) : rows;
    return <details className="struct" open={depth === 0 && rows.length <= 40}>
      <summary>{pretty(title)} <span className="meta">({rows.length})</span></summary>
      {rows.length > 12 && <input className="search" placeholder={`Search ${pretty(title).toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)} />}
      <ul className="plain mono-list">{filtered.slice(0, 500).map((r, i) => <li key={i}>{r}</li>)}</ul>
      {filtered.length > 500 && <p className="hint-text">Showing first 500 of {filtered.length}.</p>}
    </details>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v != null && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0));
    return <details className="struct" open={depth === 0}>
      <summary>{pretty(title)}</summary>
      <dl className="kv-list">{entries.filter(([, v]) => typeof v !== 'object').map(([k, v]) => <div key={k} className="kv"><dt>{pretty(k)}</dt><dd>{String(v)}</dd></div>)}</dl>
      {entries.filter(([, v]) => typeof v === 'object').map(([k, v]) => <StructuredSection key={k} title={k} value={v} depth={depth + 1} />)}
    </details>;
  }
  return <div className="kv"><dt>{pretty(title)}</dt><dd>{String(value)}</dd></div>;
}
