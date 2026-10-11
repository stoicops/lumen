import React, { useEffect, useState } from 'react';

const SEVERITY = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Check by hand', info: 'Good to know', pass: 'Looks good' };
const loc = l => l ? `${l.path ?? ''}${l.line ? `:${l.line}` : ''}` : null;

export function SecurityView({ projectId }) {
  const [review, setReview] = useState(null), [error, setError] = useState(''), [showAll, setShowAll] = useState(false);
  useEffect(() => { setReview(null); setError(''); window.studio.security(projectId).then(setReview).catch(e => setError(e.message)); }, [projectId]);
  if (error) return <section className="card"><p>{error}</p></section>;
  if (!review) return <section className="card"><p className="hint-text">Checking…</p></section>;
  const important = review.findings.filter(f => ['high', 'medium', 'low', 'unknown'].includes(f.severity));
  const rest = review.findings.filter(f => !important.includes(f));
  const c = review.counts;
  return <>
    <section className="card">
      <h3>Security checks</h3>
      <div className="sev-summary">
        {['high', 'medium', 'low', 'unknown'].map(k => <div key={k} className={`sev-tile ${k}`}><strong>{c[k]}</strong><span>{SEVERITY[k]}</span></div>)}
      </div>
      <p className="hint-text">These come from REA’s reading of the code plus Lumen’s own scan of the files for keys. They are things to look at, not proof the app can be attacked. Severity follows common Electron security advice.</p>
      {!review.scanned && <p className="hint-text">This analysis was made before key scanning existed. Analyse the app again to scan it for exposed keys.</p>}
      {review.scanError && <p className="inline-error">The key scan could not finish: {review.scanError}</p>}
    </section>
    <section className="card">
      {important.length === 0 ? <p>No warnings. REA and the key scan found nothing that needs attention in the code they could read.</p>
        : <ul className="sec-list">{important.map((f, i) => <Finding key={i} f={f} />)}</ul>}
      {rest.length > 0 && <button className="link more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide' : 'Show'} {rest.length} other notes</button>}
      {showAll && <ul className="sec-list">{rest.map((f, i) => <Finding key={i} f={f} />)}</ul>}
    </section>
    {review.scan && <section className="card"><details><summary>What the key scan covered</summary>
      <p className="hint-text">{review.scan.filesScanned} text files, {(review.scan.bytesScanned / 1024).toFixed(0)} KB read without running anything. Limits: {review.scan.limits.maxFileBytes / 1048576} MB per file, {review.scan.limits.maxTotalBytes / 1048576} MB in total.</p>
      {review.scan.skipped.length > 0 && <ul className="plain">{review.scan.skipped.map((s, i) => <li key={i}>Skipped {s}</li>)}</ul>}
      <p className="hint-text">Pattern matching can miss keys and can flag things that are not real keys.</p>
    </details></section>}
  </>;
}

function Finding({ f }) {
  return <li className={`sec ${f.severity}`}>
    <span className={`sev ${f.severity}`}>{SEVERITY[f.severity]}</span>
    <div className="sec-body">
      <strong>{f.title}</strong>
      <p>{f.detail}</p>
      <span className="meta">{f.source === 'lumen-scan' ? 'Lumen key scan' : 'REA'}{loc(f.location) ? ` · ${loc(f.location)}` : ''}{f.evidenceId ? ` · ${f.evidenceId.slice(0, 15)}…` : ''}</span>
    </div>
  </li>;
}
