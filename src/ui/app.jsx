import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describeEvidence, friendlyError } from '../core/findings.mjs';
import { Markdown } from './markdown.jsx';
import { ArchitectureMap } from './map.jsx';
import { SecurityView } from './security.jsx';
import './style.css';

const STATUS = {
  completed: ['Complete', 'ok'], running: ['Analysing…', 'busy'], queued: ['Queued', 'busy'], cancelling: ['Stopping…', 'warn'],
  cancelled: ['Cancelled', 'muted'], failed: ['Failed', 'bad'], interrupted: ['Interrupted', 'warn'],
};
const LABEL = { observed: 'Seen in code', 'not-observed': 'Not seen' };
const when = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function StatusBadge({ status }) { const [text, tone] = STATUS[status] ?? [status, 'muted']; return <span className={`badge ${tone}`}>{text}</span>; }

function AiStatus({ providers, selection, onRefresh }) {
  const [endpoint, model] = selection ? JSON.parse(selection) : [];
  const provider = providers.find(p => p.endpoint === endpoint);
  const anyUp = providers.some(p => p.available);
  const text = provider && model ? `${provider.name} · ${model}` : anyUp ? `${providers.filter(p => p.available).map(p => p.name).join(', ')} · no model` : 'No local AI running';
  return <button className="ai-status" onClick={onRefresh} title="Local AI connection. Click to check again.">
    <span className={`dot ${provider && model ? 'on' : anyUp ? 'warn' : 'off'}`} aria-hidden />{text}
  </button>;
}

function Sidebar({ projects, current, busy, onSelect, onNew, onDelete }) {
  return <aside className="sidebar">
    <div className="titlebar-space" />
    <button className="new" onClick={onNew} disabled={busy}><span aria-hidden>＋</span> New Analysis</button>
    <div className="section-label">Analyses</div>
    <nav aria-label="Previous analyses">
      {projects.length === 0 && <p className="empty-side">Nothing yet.</p>}
      {projects.map(p => <div key={p.id} className={`row ${current?.id === p.id ? 'selected' : ''}`}>
        <button className="row-main" onClick={() => onSelect(p)}>
          <span className="row-title">{p.name}</span>
          <span className="row-sub"><StatusBadge status={p.status} /> {when(p.createdAt)}</span>
        </button>
        <button className="row-delete" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => onDelete(p)}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M6 2h4M3 4h10M5 4l.6 9h4.8L11 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>)}
    </nav>
    <footer>Analysis by REA · Lumen is independent<br />Development build</footer>
  </aside>;
}

function DropZone({ busy, status, onPath, onChoose, onCancel }) {
  const [over, setOver] = useState(false);
  return <section className={`drop ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
    onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onPath(window.studio.droppedPath(f)); }}>
    {busy ? <div className="spinner" aria-hidden /> : <div className="drop-icon" aria-hidden>⬇︎</div>}
    <div className="drop-text">
      <strong>{busy ? 'Reading your app…' : 'Drop an app folder or .asar file'}</strong>
      <span role="status">{busy ? status : 'Lumen reads the files without running them.'}</span>
    </div>
    {busy ? <button className="btn" onClick={onCancel}>Cancel</button> : <button className="btn" onClick={onChoose}>Choose…</button>}
  </section>;
}

function Fact({ fact, onShow }) {
  return <li className={`fact ${fact.status}`}>
    <span className="fact-value">{fact.value}</span>
    <span className="fact-label">{fact.label}</span>
    <span className={`tag ${fact.status}`}>{LABEL[fact.status]}</span>
    <button className="link" onClick={() => onShow(fact)}>Evidence</button>
  </li>;
}

function Summary({ view, onShow }) {
  const [showZero, setShowZero] = useState(false);
  const seen = view.facts.filter(f => f.status === 'observed');
  const unseen = view.facts.filter(f => f.status !== 'observed');
  return <>
    <section className="card">
      <h3>In plain English</h3>
      {view.headline.map((line, i) => <p key={i} className={i === view.headline.length - 1 ? 'caveat' : ''}>{line}</p>)}
    </section>
    <section className="card">
      <div className="card-head"><h3>What REA found</h3><span className="meta">Static reading · confidence “{view.confidence}”</span></div>
      <ul className="facts">{seen.map(f => <Fact key={f.field} fact={f} onShow={onShow} />)}</ul>
      {unseen.length > 0 && <button className="link more" onClick={() => setShowZero(!showZero)}>{showZero ? 'Hide' : 'Show'} {unseen.length} things not seen</button>}
      {showZero && <ul className="facts">{unseen.map(f => <Fact key={f.field} fact={f} onShow={onShow} />)}</ul>}
      {showZero && <p className="hint-text">“Not seen” means REA found no sign of it in the code it could read. It does not prove the app never does it.</p>}
    </section>
    <section className="card">
      <div className="card-head"><h3>How complete is this?</h3><span className="meta">{view.coverage.unknownCount} open questions</span></div>
      <p>Files covered: <strong>{view.coverage.application}</strong>. Behaviour analysis: <strong>{view.coverage.semantic}</strong>{view.coverage.truncated ? ' (results were cut short)' : ''}.</p>
      <details><summary>Areas checked ({view.coverage.families.length})</summary>
        <table className="table"><thead><tr><th>Area</th><th>Status</th><th>Links found</th><th>Unknowns</th></tr></thead>
          <tbody>{view.coverage.families.map(f => <tr key={f.name}><td>{f.name}</td><td>{f.status}</td><td>{f.relations}</td><td>{f.unknowns}</td></tr>)}</tbody></table>
      </details>
      <details><summary>Limits of this analysis ({view.limitations.length})</summary><ul className="plain">{view.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
      <details><summary>Unknowns ({view.unknowns.length})</summary><ul className="plain">{view.unknowns.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
    </section>
  </>;
}

function EvidenceSheet({ fact, view, onClose }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  return <div className="sheet-backdrop" onClick={onClose}><div className="sheet" role="dialog" aria-modal="true" aria-label="Evidence" onClick={e => e.stopPropagation()}>
    <h3>{fact.label}</h3>
    <dl>
      <dt>Value</dt><dd>{fact.value} · {LABEL[fact.status]} (static syntax, not runtime)</dd>
      <dt>Field</dt><dd><code>{fact.field}</code></dd>
      <dt>Evidence</dt><dd><code>{fact.evidenceId}</code></dd>
      <dt>Derived from</dt><dd><code>{view.parentId}</code></dd>
      <dt>Authority</dt><dd>{view.authority} · confidence “{view.confidence}”</dd>
      <dt>Target SHA-256</dt><dd><code>{view.target.sha256}</code></dd>
    </dl>
    <p className="hint-text">Exact file locations are in the full evidence bundle saved with this analysis.</p>
    <button className="btn primary" onClick={onClose} autoFocus>Done</button>
  </div></div>;
}

function AskPanel({ project, providers, selection, setSelection }) {
  const [question, setQuestion] = useState(''), [answer, setAnswer] = useState(null), [asking, setAsking] = useState(false), [error, setError] = useState('');
  useEffect(() => { setAnswer(null); setError(''); }, [project.id]);
  const options = providers.flatMap(p => p.models.map(m => ({ key: JSON.stringify([p.endpoint, m]), label: `${p.name} · ${m}` })));
  async function ask() {
    setAsking(true); setError('');
    try { const [endpoint, model] = JSON.parse(selection); const r = await window.studio.ask({ projectId: project.id, endpoint, model, question }); setAnswer({ text: r.answer, model: r.model }); }
    catch (e) { setError(e.message); } finally { setAsking(false); }
  }
  return <section className="card ask">
    <h3>Ask your local AI</h3>
    {options.length === 0 ? <p className="hint-text">Open LM Studio or Ollama, start its local server and load a model. The dot at the top turns green when Lumen can see it.</p>
      : <select aria-label="Model" value={selection} onChange={e => setSelection(e.target.value)}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>}
    <textarea aria-label="Your question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={8000}
      placeholder="e.g. How do the parts of this app talk to each other?"
      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && selection && question.trim()) ask(); }} />
    <button className="btn primary" disabled={asking || !selection || !question.trim() || !project.evidence} onClick={ask}>{asking ? 'Thinking…' : 'Ask'}</button>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {answer && <div className="answer">
      <div className="answer-head"><span className="tag ai">AI answer · not verified</span><span className="meta">{answer.model}</span></div>
      <Markdown text={answer.text} />
      <p className="hint-text">AI can be wrong or overstate things. Check claims against “What REA found”.</p>
    </div>}
  </section>;
}

function App() {
  const [projects, setProjects] = useState([]), [project, setProject] = useState(null), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState(null), [providers, setProviders] = useState([]), [selection, setSelection] = useState('');
  const [tab, setTab] = useState('summary'), [sheet, setSheet] = useState(null), [platform, setPlatform] = useState(''), [copied, setCopied] = useState(false);
  const refresh = async () => setProjects(await window.studio.projects());
  const loadModels = async () => {
    const list = await window.studio.models(); setProviders(list);
    const keys = list.flatMap(p => p.models.map(m => JSON.stringify([p.endpoint, m])));
    setSelection(current => keys.includes(current) ? current : keys[0] ?? '');
  };
  useEffect(() => {
    refresh().catch(e => setError({ message: e.message })); loadModels().catch(() => {});
    window.studio.platform().then(setPlatform).catch(() => {});
    const timer = setInterval(() => loadModels().catch(() => {}), 15000);
    const off = window.studio.onProgress(p => setStatus(p.message || 'Working…'));
    return () => { clearInterval(timer); off(); };
  }, []);
  const view = useMemo(() => project?.evidence ? describeEvidence(project.evidence) : null, [project]);
  async function analyze(path) {
    if (!path || busy) return; setBusy(true); setError(null); setStatus('Starting…');
    try { const p = await window.studio.analyze(path); setProject(p); setTab('summary'); await refresh(); if (p.error) setError(friendlyError(p.error)); }
    catch (e) { setError(friendlyError(e.message)); } finally { setBusy(false); }
  }
  const choose = async () => { try { await analyze(await window.studio.choose()); } catch (e) { setError({ message: e.message }); } };
  async function remove(p) {
    try { if (await window.studio.remove(p.id)) { if (project?.id === p.id) setProject(null); await refresh(); } } catch (e) { setError({ message: e.message }); }
  }
  return <div className={`shell ${platform === 'darwin' ? 'mac' : ''}`}>
    <Sidebar projects={projects} current={project} busy={busy} onSelect={p => { setProject(p); setError(p.error ? friendlyError(p.error) : null); }} onNew={choose} onDelete={remove} />
    <main>
      <header className="toolbar">
        <div className="toolbar-title">{project ? project.name : 'Lumen'}</div>
        <AiStatus providers={providers} selection={selection} onRefresh={() => loadModels().catch(() => {})} />
      </header>
      <div className="content">
        <DropZone busy={busy} status={status} onPath={analyze} onChoose={choose} onCancel={() => window.studio.cancel().catch(e => setError({ message: e.message }))} />
        {error && <div className="alert" role="alert"><strong>{error.message}</strong>{error.detail && error.detail !== error.message && <details><summary>Technical details</summary><pre>{error.detail}</pre></details>}</div>}
        {!project && !busy && <div className="welcome"><h1>See how an app fits together.</h1><p>Drop a JavaScript or Electron app above. Lumen reads it on this Mac, explains what the code shows, and lets you ask your own local AI about it. Nothing leaves your computer.</p></div>}
        {project && <>
          <div className="project-head">
            <div><h1>{project.name}</h1><span className="meta"><StatusBadge status={project.status} /> {when(project.createdAt)}</span></div>
            <div className="actions">
              <div className="segmented" role="tablist">
                <button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Summary</button>
                <button role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>Map</button>
                <button role="tab" aria-selected={tab === 'security'} className={tab === 'security' ? 'on' : ''} onClick={() => setTab('security')}>Security</button>
                <button role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'on' : ''} onClick={() => setTab('raw')}>Raw evidence</button>
              </div>
              <button className="btn" onClick={() => window.studio.copyMarkdown(project.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(e => setError({ message: e.message }))}>{copied ? 'Copied ✓' : 'Copy as Markdown'}</button>
              <button className="btn" title="Save a Markdown file plus the full evidence bundle" onClick={() => window.studio.exportReport(project.id).catch(e => setError({ message: e.message }))}>Save…</button>
            </div>
          </div>
          {project.cleanupWarning && <div className="alert warn">{project.cleanupWarning}</div>}
          {tab === 'map' && project.status === 'completed' && <ArchitectureMap projectId={project.id} />}
          {tab === 'map' && project.status !== 'completed' && <section className="card"><p>The map needs a completed analysis.</p></section>}
          <div className="columns" hidden={tab === 'map'}>
            <div className="col-main">
              {tab === 'summary' && (view ? <Summary view={view} onShow={setSheet} /> : <section className="card"><p>No evidence to show for this analysis{project.status === 'failed' ? ' because it failed' : ''}.</p></section>)}
              {tab === 'security' && (project.status === 'completed' ? <SecurityView projectId={project.id} /> : <section className="card"><p>Security checks need a completed analysis.</p></section>)}
              {tab === 'raw' && <section className="card"><pre className="raw">{JSON.stringify(project.evidence ?? { status: project.status }, null, 2)}</pre></section>}
            </div>
            <div className="col-side"><AskPanel project={project} providers={providers} selection={selection} setSelection={setSelection} /></div>
          </div>
        </>}
      </div>
    </main>
    {sheet && view && <EvidenceSheet fact={sheet} view={view} onClose={() => setSheet(null)} />}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
