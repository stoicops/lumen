export function localEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Use a numeric loopback HTTP endpoint such as http://127.0.0.1:1234/v1');
  return url.href.replace(/\/$/, '');
}
const MAX_RESPONSE_BYTES = 2_000_000;
// Reads a response body with a hard byte limit enforced while streaming (never buffers past it).
async function* chunks(response, limit = MAX_RESPONSE_BYTES) {
  let total = 0; const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > limit) throw new Error('Local AI response exceeds the size limit');
    yield decoder.decode(chunk, { stream: true });
  }
}
async function request(endpoint, route, options = {}) {
  const response = await fetch(`${localEndpoint(endpoint)}${route}`, { ...options, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}`);
  if (!/json/i.test(response.headers.get('content-type') ?? '')) throw new Error('Local AI returned an unexpected content type');
  let raw = ''; for await (const text of chunks(response)) raw += text;
  return JSON.parse(raw);
}
export async function discoverModels() {
  return Promise.all([{ name: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1' }, { name: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1' }].map(async p => {
    try { const body = await request(p.endpoint, '/models'); return { ...p, models: (body.data ?? []).map(m => m.id).filter(x => typeof x === 'string'), available: true }; }
    catch { return { ...p, models: [], available: false }; }
  }));
}
// Streaming chat (OpenAI-compatible SSE). Calls onDelta with text as it arrives; returns the full text.
// Falls back to a single JSON body if the server ignores stream:true. Abort via signal.
export async function streamChat({ endpoint, model, messages, signal, onDelta }) {
  if (typeof model !== 'string' || !model) throw new Error('Select a model');
  const response = await fetch(`${localEndpoint(endpoint)}/chat/completions`, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.1, stream: true, messages }) });
  if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  let answer = '';
  if (/json/i.test(type)) {
    let raw = ''; for await (const text of chunks(response)) raw += text;
    answer = JSON.parse(raw).choices?.[0]?.message?.content;
    if (typeof answer !== 'string') throw new Error('Model returned no answer');
    onDelta?.(answer); return answer;
  }
  if (!/event-stream|text\/plain/i.test(type)) throw new Error('Local AI returned an unexpected content type');
  let buffer = '';
  for await (const text of chunks(response)) {
    buffer += text; let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') return answer;
      let event; try { event = JSON.parse(data); } catch { continue; }
      if (event.error) throw new Error(`Local AI error: ${event.error.message ?? event.error}`);
      // Only the public answer text; provider reasoning fields are deliberately ignored.
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) { answer += delta; onDelta?.(delta); }
    }
  }
  return answer;
}
