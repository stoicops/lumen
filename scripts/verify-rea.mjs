import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { ReaAdapter } from '../src/core/rea-adapter.mjs';
const adapter = new ReaAdapter();
try {
  await adapter.connect();
  const result = await adapter.analyze(resolve('fixtures/simple-app'));
  assert(result.evidence_id, 'Canonical evidence identity missing');
  assert(result.normalized_result, 'Normalized result missing');
  const directory = await mkdtemp(join(tmpdir(), 'lumen-evidence-'));
  await adapter.export(join(directory, 'evidence.json'));
  const bundle = JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8'));
  assert(bundle, 'Export missing');
  console.log('PASS: real REA initialize, static analysis, canonical summary, complete bundle export');
  console.log(JSON.stringify(result.normalized_result).slice(0, 1200));
} finally { await adapter.close(); }
