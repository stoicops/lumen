import React, { useState } from 'react';
import { Markdown } from './markdown.jsx';

const STATUS = {
  supported: ['✓', 'Cites evidence', 'ok'],
  uncited: ['!', 'No source given', 'warn'],
  invalid: ['✕', 'Cites a fact that does not exist', 'bad'],
  mismatch: ['#', 'A number does not match the cited fact', 'warn'],
  'no-claim': ['', '', 'none'],
};

export function CheckedAnswer({ answer }) {
  const [open, setOpen] = useState(null), [plain, setPlain] = useState(false);
  if (!answer.check) return <div className="answer"><Markdown text={answer.answer} /></div>;
  const facts = Object.fromEntries((answer.facts ?? []).map(f => [f.id, f.text]));
  const c = answer.check, claims = c.supported + c.uncited + c.invalid + c.mismatch;
  return <div className="answer">
    <div className="answer-head"><span className="tag ai">AI answer · checked by Lumen</span><span className="meta">{answer.model}</span></div>
    <p className={`check-bar ${c.supported === claims && claims ? 'ok' : 'warn'}`}>
      {claims ? `${c.supported} of ${claims} claims cite real evidence.` : 'The answer makes no checkable claims.'}
      {c.uncited ? ` ${c.uncited} ${c.uncited === 1 ? 'has' : 'have'} no source.` : ''}{c.invalid ? ` ${c.invalid} ${c.invalid === 1 ? 'cites a fact that doesn’t' : 'cite facts that don’t'} exist.` : ''}{c.mismatch ? ` ${c.mismatch} ${c.mismatch === 1 ? 'has a number that doesn’t' : 'have numbers that don’t'} match.` : ''}
    </p>
    {plain ? <Markdown text={answer.answer} /> : <ul className="claims">{c.lines.map((line, i) => {
      const [mark, title, tone] = STATUS[line.status];
      return <li key={i} className={`claim ${tone}`}>
        <span className="claim-mark" title={title} aria-label={title}>{mark}</span>
        <div><Markdown text={line.text.replace(/\[((?:[FLS]\d+)(?:\s*,\s*[FLS]\d+)*)\]/g, '').replace(/^\s*[*-]\s+/, '').replace(/\s+([.,;:!?])/g, '$1')} />
          <span className="chips-inline">{line.cites.map(id => <button key={id} className={`cite ${facts[id] ? '' : 'missing'}`} onClick={() => setOpen(open === `${i}:${id}` ? null : `${i}:${id}`)}>{id}</button>)}
            {tone !== 'none' && tone !== 'ok' && <span className="claim-why">{title}{line.unmatched?.length ? `: ${line.unmatched.join(', ')}` : ''}</span>}</span>
          {line.cites.filter(id => open === `${i}:${id}`).map(id => <p key={id} className="cite-text">{facts[id] ?? 'No such fact in the evidence given to the model.'}</p>)}
        </div>
      </li>;
    })}</ul>}
    <button className="link more" onClick={() => setPlain(!plain)}>{plain ? 'Show checked view' : 'Show plain answer'}</button>
    <p className="hint-text">A citation shows the AI pointed at real evidence. It doesn’t prove the AI read it correctly, so tap a citation to compare.{answer.omitted ? ` ${answer.omitted} facts were left out to fit the model’s limit.` : ''}</p>
  </div>;
}
