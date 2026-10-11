import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { localEndpoint, askEvidence } from '../src/core/local-model.mjs';
import { ProjectStore } from '../src/core/projects.mjs';
import { ReaAdapter } from '../src/core/rea-adapter.mjs';
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
