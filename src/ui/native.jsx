import React, { useEffect, useState } from 'react';

const row = (k, v) => v != null && <div key={k} className="kv"><dt>{k}</dt><dd>{String(v)}</dd></div>;

export function NativeView({ project, onOpenSettings }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [diag, setDiag] = useState(null), [fixing, setFixing] = useState(''), [fixed, setFixed] = useState(null);
  const [running, setRunning] = useState(false), [runNote, setRunNote] = useState('');
  useEffect(() => { setData(null); setError(''); setDiag(null); setFixed(null); setRunNote(''); window.studio.native(project.id).then(setData).catch(e => setError(e.message)); }, [project.id]);
  const fixPerms = async () => { setFixing('working'); try { const r = await window.studio.prepareGhidra(); setFixed(r); setDiag(await window.studio.diagnoseEngine()); } catch (e) { setFixed({ ok: false, message: e.message }); } finally { setFixing('done'); } };
  const decompile = async () => {
    setRunning(true); setRunNote(''); setError('');
    try { const r = await window.studio.decompile(project.id); if (r.skipped) setRunNote(r.skipped); else setData(r); }
    catch (e) { setError(e.message); } finally { setRunning(false); }
  };
  const canDecompile = data && data.opened && !data.engineReady && project.native?.engineConfigured;
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

    {project.native && project.engineSkipped ? <section className="card engine-needed"><h3>Ghidra skipped to protect your Mac</h3><p>{project.engineSkipped}</p><button className="btn" onClick={onOpenSettings}>Open Settings</button></section> : !data.engineReady ? <section className="card engine-needed">
      <h3>Deep decompilation {canDecompile ? 'is ready to run' : 'needs an engine'}</h3>
      {canDecompile ? <>
        <p>Ghidra is configured. Decompiling turns machine code into readable functions, but it is <strong>heavy</strong>: it runs a separate Ghidra engine that can use a lot of CPU and memory for several minutes. Close other big apps first. Lumen runs it only when you click below, never automatically.</p>
        <div className="ask-actions">
          {running ? <button className="btn" onClick={() => window.studio.cancelDecompile()}>Stop</button>
            : <button className="btn primary" onClick={decompile}>Decompile with Ghidra</button>}
          <span className="meta">{running ? 'Ghidra is working — this can take a few minutes…' : 'heavy: runs the Ghidra engine'}</span>
        </div>
        {runNote && <p className="inline-error">{runNote}</p>}
      </> : <>
        <p>Lumen can identify this binary and read its signature and layout, but turning machine code back into readable functions needs a decompiler engine. The free, open-source one is <strong>Ghidra</strong>.</p>
        <ol className="plain">
          <li>Install Ghidra (and Java 21) on this Mac — Lumen’s Settings has the exact steps.</li>
          <li>Point Lumen at the Ghidra folder in Settings.</li>
          <li>Come back here and click “Decompile with Ghidra”.</li>
        </ol>
        <button className="btn primary" onClick={onOpenSettings}>Open Settings</button>
      </>}
      {project.native?.engineConfigured && (data.engineMessage || diag) && <div className="inline-error" style={{ marginTop: 10 }}>
        <p>An engine folder is set, but the decompile did not run.</p>
        {data.engineMessage && <p><strong>Engine said:</strong> {data.engineMessage}</p>}
        {diag ? <>
          <p><strong>Java in use:</strong> {diag.javaHome ?? 'NONE FOUND — install Temurin 21, or set the Java home in Settings'}</p>
          <p><strong>Ghidra folder:</strong> {diag.ghidra?.ok ? 'OK' : (diag.ghidra?.detail ?? 'not detected')}</p>
          <p><strong>Ghidra usable:</strong> {diag.available === true ? 'yes' : 'NO'}{diag.failing ? ` — ${diag.failing.code ?? ''}: ${diag.failing.detail ?? ''}${diag.failing.remediation ? ` (${diag.failing.remediation})` : ''}` : ''}</p>
          {diag.available !== true && <div style={{ marginTop: 8 }}>
            <p className="hint-text">On macOS, downloaded Ghidra is often blocked by quarantine or its launcher is not executable. Lumen can fix that:</p>
            <button className="btn primary" onClick={fixPerms} disabled={fixing === 'working'}>{fixing === 'working' ? 'Fixing…' : 'Fix Ghidra permissions'}</button>
            {fixed && <div className="hint-text">{fixed.steps ? fixed.steps.map((s, i) => <div key={i}>{s.ok ? '✓' : '✗'} {s.label}</div>) : fixed.message}{fixed.ok && ' — now analyse this file again.'}</div>}
          </div>}
        </> : <p className="hint-text">Checking the engine…</p>}
        {data.engineLog && <details open><summary>Ghidra engine log</summary><pre className="raw">{data.engineLog}</pre></details>}
        {diag && <details><summary>Full diagnostics</summary><pre className="raw">{diag.raw}</pre></details>}
      </div>}
    </section> : <section className="card">
      <h3>Decompilation</h3>
      <p>Engine ready. Lumen read {sectionKeys.length} section(s): {sectionKeys.join(', ') || 'identification only'}.</p>
      {data.sections.strings && <p className="meta">Strings and procedures were recovered; open Raw to inspect.</p>}
    </section>}

    {sectionKeys.filter(k => k !== 'strings' && k !== 'procedures' && k !== 'overview').map(k => <section className="card" key={k}>
      <details><summary>{k} details</summary><pre className="raw">{JSON.stringify(data.sections[k], null, 2).slice(0, 4000)}</pre></details>
    </section>)}
  </div></div>;
}
