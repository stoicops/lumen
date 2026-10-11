import React from 'react';
// Minimal, safe Markdown for model output: builds React elements only (never HTML strings), so
// model or target text cannot inject markup. Supports headings, bullet/numbered lists, **bold**, `code`.

function inline(text, keyBase) {
  const parts = []; const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g; let last = 0, match, i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    parts.push(token.startsWith('**') ? <strong key={`${keyBase}-${i++}`}>{token.slice(2, -2)}</strong> : <code key={`${keyBase}-${i++}`}>{token.slice(1, -1)}</code>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }) {
  const blocks = []; let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  text.split('\n').forEach((raw, n) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[*-]\s+(.*)$/.exec(line), numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line), heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) { flush(); list = { type, items: [] }; }
      list.items.push((bullet ?? numbered)[1]); return;
    }
    flush();
    if (!line.trim()) return;
    if (heading) blocks.push({ type: 'h', text: heading[1] });
    else if (/^\*\*[^*]+\*\*:?$/.test(line.trim())) blocks.push({ type: 'h', text: line.trim().replace(/^\*\*|\*\*:?$/g, '') });
    else blocks.push({ type: 'p', text: line, n });
  });
  flush();
  return <div className="md">{blocks.map((b, i) => b.type === 'h' ? <h4 key={i}>{inline(b.text, i)}</h4>
    : b.type === 'p' ? <p key={i}>{inline(b.text, i)}</p>
    : React.createElement(b.type, { key: i }, b.items.map((item, j) => <li key={j}>{inline(item, `${i}-${j}`)}</li>)))}</div>;
}
