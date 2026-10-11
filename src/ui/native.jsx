import React, { useEffect, useState } from 'react';

const row = (k, v) => v != null && <div key={k} className="kv"><dt>{k}</dt><dd>{String(v)}</dd></div>;

export function NativeView({ project, onOpenSettings }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { setData(null); setError(''); window.studio.native(project.id).then(setData).catch(e => setError(e.message)); }, [project.id]);
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

    {!data.engineReady ? <section className="card engine-needed">
      <h3>Deep decompilation needs an engine</h3>
      <p>Lumen can identify this binary and read its signature and layout, but turning machine code back into readable functions needs a decompiler engine. The free, open-source one is <strong>Ghidra</strong>.</p>
      <ol className="plain">
        <li>Install Ghidra (and Java 21) on this Mac — Lumen’s Settings has the exact steps.</li>
        <li>Point Lumen at the Ghidra folder in Settings.</li>
        <li>Analyse this file again — you’ll get functions, strings and pseudocode.</li>
      </ol>
      <button className="btn primary" onClick={onOpenSettings}>Open Settings</button>
      {project.native?.engineConfigured && <p className="inline-error">An engine folder is set, but REA could not use it: {data.engineMessage}. Check the folder and version in Settings (run “rea doctor” if you have the CLI).</p>}
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
