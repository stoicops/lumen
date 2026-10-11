import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { localEndpoint, askEvidence } from '../src/core/local-model.mjs';
import { ProjectStore } from '../src/core/projects.mjs';
import { ReaAdapter, CancelledError } from '../src/core/rea-adapter.mjs';
import { alive, descendants, terminateTree } from '../src/core/process-cleanup.mjs';
test('local-only endpoint policy rejects cloud, aliases, credentials and unsafe schemes', () => {
  for(const url of ['https://api.example.com/v1','http://localhost:1234/v1','http://127.0.0.1.example.com/v1','file:///etc/passwd','http://user:pass@127.0.0.1/v1','http://127.0.0.1/v1?route=cloud'])assert.throws(()=>localEndpoint(url));
  assert.equal(localEndpoint('http://127.0.0.1:1234/v1/'),'http://127.0.0.1:1234/v1');
});
test('restricted adapter rejects execution tools before reaching transport',async()=>{await assert.rejects(new ReaAdapter().call('capture_process',{}),/allow-list/);});
test('project interrupted state survives restart and traversal is blocked',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lumen-test-'));const store=new ProjectStore(root);
  const p=await store.create('/tmp/owned-fixture');p.status='running';await store.save(p);
  await new ProjectStore(root).recover();assert.equal((await store.get(p.id)).status,'interrupted');
  assert.throws(()=>store.path('../../escape'));
});
test('evidence chat supplies no tools and rejects redirects',async()=>{
  let captured;
  const server=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;captured=JSON.parse(text);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Unknown from supplied evidence.'}}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const result=await askEvidence({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',question:'What is known?',evidence:{evidence_id:'fixture'}});assert.match(result.answer,/Unknown/);assert.equal(captured.tools,undefined);assert.match(captured.messages[1].content,/fixture/);}finally{await new Promise(r=>server.close(r));}
  const redirect=http.createServer((_req,res)=>{res.writeHead(302,{location:'https://example.com'});res.end();});await new Promise(r=>redirect.listen(0,'127.0.0.1',r));
  try{await assert.rejects(askEvidence({endpoint:`http://127.0.0.1:${redirect.address().port}/v1`,model:'fixture',question:'Q',evidence:{}}));}finally{await new Promise(r=>redirect.close(r));}
});
test('cancel during connect stops the engine without waiting for the handshake and verifies process-tree cleanup',async()=>{
  const fixture=new URL('./fixtures/stubborn-engine.mjs',import.meta.url).pathname;
  const adapter=new ReaAdapter({launch:{command:process.execPath,args:[fixture]}});
  const controller=new AbortController();
  const started=Date.now();setTimeout(()=>controller.abort(),400);
  await assert.rejects(adapter.connect({signal:controller.signal}),e=>e instanceof CancelledError);
  assert.ok(Date.now()-started<2000,'connect must reject promptly on cancel');
  assert.ok(adapter.pid,'owned PID recorded');
  const tree=await descendants(adapter.pid);
  const cleanup=await adapter.close();
  assert.equal(alive(adapter.pid),false);
  assert.equal(cleanup.survivors.length,0);
  if(process.platform==='linux'){assert.equal(cleanup.verified,true);assert.equal(cleanup.method,'SIGKILL');assert.ok(tree.length>=1);for(const pid of tree)assert.equal(alive(pid),false);}
});
test('connect timeout is bounded',async()=>{
  const fixture=new URL('./fixtures/stubborn-engine.mjs',import.meta.url).pathname;
  const adapter=new ReaAdapter({launch:{command:process.execPath,args:[fixture]},connectTimeoutMs:300});
  await assert.rejects(adapter.connect(),/timed out/);
  assert.equal((await adapter.close()).survivors.length,0);
});
test('ps-based descendant listing (macOS path) finds the engine child tree',async t=>{
  if(process.platform==='win32')return t.skip('no ps');
  const {spawn}=await import('node:child_process');
  const fixture=new URL('./fixtures/stubborn-engine.mjs',import.meta.url).pathname;
  const engine=spawn(process.execPath,[fixture],{stdio:['pipe','ignore','pipe']});
  const grandchild=await new Promise(r=>engine.stderr.on('data',d=>{const m=/grandchild (\d+)/.exec(String(d));if(m)r(Number(m[1]));}));
  const viaPs=await descendants(engine.pid,{method:'ps'});
  assert.ok(viaPs.includes(grandchild),'ps listing includes the grandchild');
  const cleanup=await terminateTree(engine.pid,{gracefulMs:200,snapshot:viaPs});
  assert.equal(cleanup.verified,true);assert.equal(alive(grandchild),false);
  assert.equal(await descendants(999999999,{method:'ps'}),null,'unknown engine PID is "not enumerable", never "no children"');
});
test('plain-English projection only restates fields REA reported, with provenance',async()=>{
  const {describeEvidence,friendlyError}=await import('../src/core/findings.mjs');
  const evidence=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/summary-evidence.json',import.meta.url)));
  const view=describeEvidence(evidence);
  assert.equal(view.evidenceId,evidence.evidence_id);
  assert.equal(view.parentId,evidence.normalized_result.parent_evidence_id);
  for(const f of view.facts){const path=f.field.replace('normalized_result.','').split('.');assert.equal(path.reduce((o,k)=>o[k],evidence.normalized_result),f.value,f.field);assert.equal(f.status,f.value>0?'observed':'not-observed');}
  assert.ok(view.facts.some(f=>f.label==='Browser windows created'&&f.value===1));
  assert.equal(view.coverage.families.length,evidence.normalized_result.summary.coverage.semantic.families.length);
  assert.match(view.headline.at(-1),/does not prove/);
  assert.equal(describeEvidence(undefined),null);
  assert.match(friendlyError(JSON.stringify({error:{message:'Invalid',details:{issues:[{message:'No file at path'}]}}})).message,/No file at path/);
});
test('Markdown handoff redacts the home folder and keeps provenance',async()=>{
  const {report}=await import('../src/core/projects.mjs');
  const evidence=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/summary-evidence.json',import.meta.url)));
  const md=report({name:'simple-app.asar',status:'completed',createdAt:'2026-10-11T00:00:00Z',target:'/Users/someone/Downloads/simple-app.asar',evidence},{home:'/Users/someone'});
  assert.ok(!md.includes('/Users/someone'));assert.match(md,/~\/Downloads\/simple-app\.asar/);
  assert.ok(md.includes(evidence.evidence_id));assert.match(md,/normalized_result\.summary\.electron\.browser_windows/);
  assert.match(report({name:'x',status:'failed',createdAt:'',target:'/t',error:'boom'}),/did not complete: boom/);
});
test('deleting a project removes only that project directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lumen-del-'));const store=new ProjectStore(root);
  const a=await store.create('/tmp/a'),b=await store.create('/tmp/b');
  await store.delete(a.id);
  assert.deepEqual((await store.list()).map(p=>p.id),[b.id]);
  await assert.rejects(store.delete('../../etc'));
});
test('architecture map never invents nodes or links and keeps REA provenance',async()=>{
  const {projectArchitecture,layout}=await import('../src/core/graph.mjs');
  const bundle=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/simple-app-bundle.json',import.meta.url)));
  const graph=bundle.records.find(r=>r.normalized_result?.graph).normalized_result.graph;
  const rawNodes=new Set(graph.nodes.map(n=>n.node_id)),rawEdges=new Map(graph.edges.map(e=>[e.edge_id,e]));
  const map=projectArchitecture(bundle);
  for(const n of map.nodes)assert.ok(rawNodes.has(n.id),'node exists in REA graph');
  for(const e of map.edges){
    assert.ok(e.edgeIds.length>0);
    for(const id of e.edgeIds){const raw=rawEdges.get(id);assert.ok(raw,'edge from REA');assert.equal(raw.relation,e.relation);}
    if(!e.folded)assert.ok(e.edgeIds.some(id=>rawEdges.get(id).source_node_id===e.source&&rawEdges.get(id).target_node_id===e.target));
    if(e.state==='observed')assert.ok(e.edgeIds.every(id=>rawEdges.get(id).evidence.state==='observed'),'weakest state kept');
  }
  const kinds=map.nodes.map(n=>n.kind);
  for(const k of ['electron-main','electron-preload','electron-renderer','ipc-channel','ipc-handler','browser-window'])assert.ok(kinds.includes(k),k);
  const byId=Object.fromEntries(map.nodes.map(n=>[n.id,n]));
  const flows=map.edges.filter(e=>e.flow&&!e.hidden).map(e=>`${byId[e.source].kind}>${e.relation}>${byId[e.target].kind}:${e.flow}`).sort();
  assert.deepEqual(flows,['electron-preload>exposes>context-bridge-api:forward','electron-preload>invokes>ipc-channel:forward','ipc-handler>handles>ipc-channel:reverse']);
  const l=layout(map);for(const n of map.nodes)assert.ok(l.positions[n.id]);
  assert.equal(projectArchitecture({records:[]}),null);
});
