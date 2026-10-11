import React, { useEffect, useState } from 'react';

const ROBUST = { trivial: ['Trivial to bypass', 'bad'], weak: ['Weak', 'warn'], moderate: ['Moderate', 'low'], strong: ['Fairly strong', 'ok'] };

export function LicensingView({ projectId }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { setData(null); setError(''); window.studio.licensing(projectId).then(setData).catch(e => setError(e.message)); }, [projectId]);
  if (error) return <section className="card"><p>{error}</p></section>;
  if (!data) return <section className="card"><p className="hint-text">Reviewing…</p></section>;
  if (data.unavailable) return <section className="card"><p>{data.unavailable}</p></section>;
  if (data.error) return <section className="card"><p>Licensing review could not finish: {data.error}</p></section>;
  return <>
    <section className="card">
      <h3>How licensing is enforced</h3>
      <p>{data.summary}</p>
      <p className="hint-text">This is to help you harden your own app. A static reading finds common shapes and can miss obfuscated or native checks. It describes where a check is weak and how to strengthen it — not a ready-made bypass.</p>
    </section>
    {data.findings.length > 0 && <section className="card">
      <ul className="lic-list">{data.findings.map((f, i) => {
        const [label, tone] = ROBUST[f.robustness] ?? [f.robustness, 'muted'];
        return <li key={i} className={`lic ${tone}`}>
          <div className="lic-head"><span className={`sev ${tone}`}>{label}</span><span className="meta">{f.file}:{f.line}</span></div>
          <p><strong>How it works:</strong> {f.mechanism}</p>
          {f.snippet && <pre className="lic-snippet">{f.snippet}</pre>}
          <p><strong>Where it’s weak:</strong> {f.weakness}</p>
          <p className="lic-harden"><strong>How to strengthen it:</strong> {f.harden}</p>
        </li>;
      })}</ul>
    </section>}
    <section className="card"><details><summary>Principles for robust licensing</summary>
      <ul className="plain">
        <li>Anything shipped to the user can be read and edited — treat client-side checks as a deterrent, not a lock.</li>
        <li>Prefer a signed license (signature made with a private key you never ship) or server-side validation with a signed, nonce’d response.</li>
        <li>Don’t gate on a single boolean a patch can flip after a successful check; derive features from the verified payload.</li>
        <li>Measure trials with trusted server time against an account/device, not the local clock.</li>
        <li>Fail closed when your server is unreachable, and sign responses so a local proxy can’t fake “valid”.</li>
      </ul>
    </details></section>
  </>;
}
