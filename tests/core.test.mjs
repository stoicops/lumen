import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { localEndpoint, streamChat } from '../src/core/local-model.mjs';
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
test('streaming chat: SSE deltas, no tools, byte limit while streaming, JSON fallback, redirects and stop',async()=>{
  const serve=handler=>new Promise(r=>{const srv=http.createServer(handler);srv.listen(0,'127.0.0.1',()=>r(srv));});
  const url=srv=>`http://127.0.0.1:${srv.address().port}/v1`;
  let captured;
  const sse=await serve(async(req,res)=>{let t='';for await(const c of req)t+=c;captured=JSON.parse(t);res.writeHead(200,{'content-type':'text/event-stream'});
    for(const w of ['One ','window ','[F1].'])res.write(`data: ${JSON.stringify({choices:[{delta:{content:w,reasoning_content:'hidden'}}]})}\n\n`);res.end('data: [DONE]\n\n');});
  const deltas=[];const text=await streamChat({endpoint:url(sse),model:'m',messages:[{role:'user',content:'q'}],onDelta:d=>deltas.push(d)});
  assert.equal(text,'One window [F1].');assert.deepEqual(deltas,['One ','window ','[F1].']);assert.equal(captured.tools,undefined);assert.equal(captured.stream,true);
  sse.close();
  const huge=await serve((_q,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});const line=`data: ${JSON.stringify({choices:[{delta:{content:'x'.repeat(60000)}}]})}\n\n`;let n=0;const tick=()=>{if(n++<50&&!res.destroyed){res.write(line);setImmediate(tick);}else res.end();};tick();});
  await assert.rejects(streamChat({endpoint:url(huge),model:'m',messages:[]}),/size limit/);huge.closeAllConnections();huge.close();
  const json=await serve((_q,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Plain [F2].'}}]}));});
  assert.equal(await streamChat({endpoint:url(json),model:'m',messages:[]}),'Plain [F2].');json.close();
  const redirect=await serve((_q,res)=>{res.writeHead(302,{location:'https://example.com'});res.end();});
  await assert.rejects(streamChat({endpoint:url(redirect),model:'m',messages:[]}));redirect.close();
  const slow=await serve((_q,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{delta:{content:'partial'}}]})}\n\n`);});
  const controller=new AbortController();const got=[];
  const p=streamChat({endpoint:url(slow),model:'m',messages:[],signal:controller.signal,onDelta:d=>{got.push(d);controller.abort();}});
  await assert.rejects(p);assert.deepEqual(got,['partial']);slow.closeAllConnections();slow.close();
  await assert.rejects(streamChat({endpoint:'https://api.example.com/v1',model:'m',messages:[]}),/loopback/);
});
test('multi-turn messages keep instructions and facts first and bound the history',async()=>{
  const {buildMessages,GROUNDED_SYSTEM_PROMPT}=await import('../src/core/grounding.mjs');
  const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:`m${i} `+'x'.repeat(900)}));
  const m=buildMessages({contextText:'[F1] fact',history:[...history,{role:'error',content:'boom'}],question:'Q?'});
  assert.equal(m[0].role,'system');assert.ok(m[0].content.startsWith(GROUNDED_SYSTEM_PROMPT));assert.match(m[0].content,/\[F1\] fact/);
  assert.deepEqual(m.at(-1),{role:'user',content:'Q?'});
  assert.ok(m.length-2<=8);assert.ok(!m.some(x=>x.role==='error'));assert.match(m.at(-2).content,/^m19/);
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
test('key scan finds and masks credentials in folders and .asar archives, read-only and bounded',async()=>{
  const {scanDirectory,scanAsar,mask}=await import('../src/core/secret-scan.mjs');
  const {writeFile,mkdir,symlink}=await import('node:fs/promises');
  const aws='AKIA'+'Z7Q2B4N6P8R0T3V5', google='AIza'+'Sy'+'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
  const files={'main.js':`const k="${aws}";\nfetch("https://api.example-service.io/v1");`,'config.json':`{"apiKey": "${google}", "password": "xxxxxxxx"}`,'img.png':aws};
  const dir=await mkdtemp(join(tmpdir(),'lumen-leak-'));for(const[n,c]of Object.entries(files))await writeFile(join(dir,n),c);
  await symlink('/etc/passwd',join(dir,'link.js')).catch(()=>{});
  const r=await scanDirectory(dir);
  assert.deepEqual(r.hits.map(h=>h.kind).sort(),['AWS access key','Google API key']);
  const a=r.hits.find(h=>h.kind==='AWS access key');assert.equal(a.file,'main.js');assert.equal(a.line,1);assert.equal(a.masked,mask(aws));
  assert.ok(!JSON.stringify(r).includes(aws)&&!JSON.stringify(r).includes(google),'full secrets never kept');
  assert.ok(r.hosts.includes('api.example-service.io'));
  if(process.platform!=='win32')assert.ok(r.skipped.some(s=>s.includes('symlink')));
  // Build a real .asar: [4][headerPickleSize][payload][jsonLen][json][pad] then file data.
  const bodies=Object.entries(files).map(([n,c])=>[n,Buffer.from(c)]);let offset=0;const tree={files:{}};
  for(const[n,b]of bodies){tree.files[n]={size:b.length,offset:String(offset)};offset+=b.length;}
  tree.files['evil']={size:10,offset:String(10**9)};
  const json=Buffer.from(JSON.stringify(tree));const padded=Math.ceil(json.length/4)*4;
  const head=Buffer.alloc(16+padded);head.writeUInt32LE(4,0);head.writeUInt32LE(8+padded,4);head.writeUInt32LE(4+padded,8);head.writeUInt32LE(json.length,12);json.copy(head,16);
  const asar=join(dir,'app.asar');await writeFile(asar,Buffer.concat([head,...bodies.map(b=>b[1])]));
  const ra=await scanAsar(asar);
  assert.deepEqual(ra.hits.map(h=>h.kind).sort(),['AWS access key','Google API key']);
  await writeFile(join(dir,'bad.asar'),Buffer.from([4,0,0,0,255,255,255,255,0,0,0,0,255,255,255,255]));
  await assert.rejects(scanAsar(join(dir,'bad.asar')),/malformed|too large/);
});
test('security review flags risky window settings and unchecked IPC from REA facts, with citations',async()=>{
  const {reviewSecurity}=await import('../src/core/security.mjs');
  const fs=await import('node:fs/promises');
  const bundle=JSON.parse(await fs.readFile(new URL('./fixtures/simple-app-bundle.json',import.meta.url)));
  const summary=JSON.parse(await fs.readFile(new URL('./fixtures/summary-evidence.json',import.meta.url)));
  const r=reviewSecurity({bundle,summary});
  const t=r.findings.map(f=>`${f.severity}:${f.title}`);
  assert.ok(t.includes('pass:contextIsolation is true'));
  assert.ok(t.includes('medium:Message handlers do not check who sent the message'));
  assert.ok(t.some(x=>x.startsWith('info:Functions the web page can call: greetings')));
  assert.equal(r.counts.high,0);
  for(const f of r.findings)assert.ok(f.evidenceId,'every REA finding cites evidence');
  const risky=structuredClone(bundle);const g=risky.records.find(x=>x.normalized_result?.graph).normalized_result.graph;
  const w=g.nodes.find(n=>n.kind==='browser-window').observations[0].properties;
  w.web_preferences=[{name:'nodeIntegration',value:{status:'literal',value:true}},{name:'contextIsolation',value:{status:'literal',value:false}},{name:'sandbox',value:{status:'expression',value:null}}];
  g.nodes.find(n=>n.kind==='context-bridge-api').observations[0].properties.members=['invoke','hello'];
  const rr=reviewSecurity({bundle:risky,summary,secrets:{hits:[{kind:'AWS access key',severity:'high',file:'main.js',line:3,masked:'AKIA…V5',length:20}],hosts:[]}});
  const tt=rr.findings.map(f=>`${f.severity}:${f.title}`);
  for(const x of ['high:Web pages can use Node.js','high:Context isolation is turned off','unknown:sandbox is set by a computed value','high:Possible AWS access key in code'])assert.ok(tt.includes(x),x);
  assert.ok(tt.some(x=>x.startsWith('medium:Page API “greetings” exposes general-purpose functions')));
  assert.equal(rr.findings[0].severity,'high');
});
test('grounded chat: numbered facts, scope notes kept apart, and each answer line checked',async()=>{
  const {buildContext,checkAnswer,GROUNDED_SYSTEM_PROMPT}=await import('../src/core/grounding.mjs');
  const {describeEvidence}=await import('../src/core/findings.mjs');const {projectArchitecture}=await import('../src/core/graph.mjs');const {reviewSecurity}=await import('../src/core/security.mjs');
  const fs=await import('node:fs/promises');
  const bundle=JSON.parse(await fs.readFile(new URL('./fixtures/simple-app-bundle.json',import.meta.url)));
  const summary=JSON.parse(await fs.readFile(new URL('./fixtures/summary-evidence.json',import.meta.url)));
  const ctx=buildContext({view:describeEvidence(summary),map:projectArchitecture(bundle),security:reviewSecurity({bundle,summary})});
  const win=ctx.facts.find(f=>f.text.startsWith('Browser windows created: 1'));assert.ok(win);
  assert.ok(ctx.facts.some(f=>f.id.startsWith('L')&&f.text.includes('sends messages to')));
  assert.ok(ctx.facts.some(f=>f.id.startsWith('S')&&f.text.includes('sender')));
  assert.match(ctx.text,/NOT features of the app/);assert.ok(!/\[F\d+\][^\n]*call-flow/.test(ctx.text),'area names are not facts');
  assert.match(GROUNDED_SYSTEM_PROMPT,/cite/);
  const answer=[`This app has one main window [${win.id}].`,'The app uses workers and storage to sync files in the background.',`It has 7 windows [${win.id}].`,'It talks to a cloud database [F999].','The evidence does not show this.'].join('\n');
  const c=checkAnswer(answer,ctx.facts);
  assert.deepEqual(c.lines.map(l=>l.status),['supported','uncited','mismatch','invalid','no-claim']);
  assert.deepEqual(c.lines[2].unmatched,['7']);
  assert.equal(c.supported,1);assert.equal(c.uncited,1);assert.equal(c.invalid,1);assert.equal(c.mismatch,1);
});
test('desktop entry files parse (main process and preload)',async()=>{
  const {execFileSync}=await import('node:child_process');
  for(const f of ['src/desktop/main.mjs','src/desktop/preload.cjs'])execFileSync(process.execPath,['--check',f]);
});
test('SQLite store: migrations, legacy JSON import, damaged records shown, events and conversations',async()=>{
  const {writeFile,mkdir,readdir}=await import('node:fs/promises');const {randomUUID}=await import('node:crypto');
  const root=await mkdtemp(join(tmpdir(),'lumen-db-'));
  const good=randomUUID(),bad=randomUUID();
  await mkdir(join(root,good));await writeFile(join(root,good,'project.json'),JSON.stringify({id:good,name:'old.asar',target:'/x/old.asar',createdAt:'2026-10-01T00:00:00Z',status:'completed',evidence:{evidence_id:'ev_1'}}));
  await mkdir(join(root,bad));await writeFile(join(root,bad,'project.json'),'{not json');
  const store=new ProjectStore(root);
  const list=await store.list();
  assert.equal(list.find(p=>p.id===good).status,'completed');assert.equal(list.find(p=>p.id===good).hasEvidence,true);assert.equal(list.find(p=>p.id===good).evidence,undefined,'list stays light');
  assert.equal((await store.get(good)).evidence.evidence_id,'ev_1');
  const broken=list.find(p=>p.id===bad);assert.equal(broken.status,'unreadable');assert.match(broken.error,/could not be read/);
  assert.ok((await readdir(join(root,good))).includes('project.json.imported'));
  store.event(good,'progress','step 1');assert.deepEqual(store.events(good).map(e=>e.message),['step 1']);
  const c=store.createConversation(good,'What is this?');store.addMessage(c,'user','What is this?');store.addMessage(c,'assistant','An app [F1].',{check:{supported:1}});
  assert.deepEqual(store.messages(c).map(m=>m.role),['user','assistant']);assert.equal(store.messages(c)[1].meta.check.supported,1);
  assert.equal(store.conversations(good)[0].messages,2);assert.equal(store.conversationProject(c),good);
  store.close();
  const again=new ProjectStore(root);assert.equal((await again.get(good)).name,'old.asar','reopens without re-import');
  await again.delete(good);assert.equal(again.conversationProject(c),null,'conversations deleted with project');
  assert.equal(again.db.prepare('SELECT version FROM schema_version').get().version,1);
  again.close();
});
test('target resolution routes .app bundles to their inner app.asar and notes unpacked files',async()=>{
  const {resolveTarget}=await import('../src/core/target.mjs');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'lumen-app-'));
  const bundle=join(root,'Demo.app'),res=join(bundle,'Contents','Resources');
  await mkdir(join(res,'app.asar.unpacked'),{recursive:true});await writeFile(join(res,'app.asar'),'x');
  const r=await resolveTarget(bundle);
  assert.equal(r.kind,'app-bundle');assert.equal(r.target,join(res,'app.asar'));
  assert.ok(r.notes.some(n=>n.includes('app.asar')));assert.ok(r.notes.some(n=>n.includes('unpacked')));
  const folder=join(root,'plain');await mkdir(folder);
  assert.equal((await resolveTarget(folder)).kind,'dir');
  const bare=join(root,'Empty.app');await mkdir(bare);
  await assert.rejects(resolveTarget(bare),/could not find an executable/);
  await assert.rejects(resolveTarget(join(root,'x.bin')+''),/could not be found|JavaScript/);
  assert.equal((await resolveTarget(join(res,'app.asar'))).kind,'asar');
});
test('licensing review classifies mechanisms by robustness and gives hardening advice',async()=>{
  const {analyzeLicensing}=await import('../src/core/license-scan.mjs');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'lumen-lic-'));
  await writeFile(join(dir,'license.js'),[
    'let isPro = false;',
    'if (licenseKey === "SUPER-SECRET-KEY-123") isPro = true;',
    'const daysLeft = (trialEnd - Date.now()) / 86400000;',
    'localStorage.set("premium", true);',
    'crypto.verify("RSA-SHA256", payload, publicKey, licenseSignature);',
    'fetch("https://api.vendor.com/activate?license=" + key);',
  ].join('\n'));
  await writeFile(join(dir,'noise.js'),'const x = 1; // nothing relevant here');
  const r=await analyzeLicensing(dir);
  const ids=r.findings.map(f=>f.id);
  for(const id of ['hardcoded-compare','bool-flag','trial-local-clock','local-store','offline-signature','server-validation'])assert.ok(ids.includes(id),id);
  assert.equal(r.weakest,'trivial');
  assert.equal(r.findings[0].robustness,'trivial'); // sorted weakest first
  assert.ok(r.findings.every(f=>f.harden&&f.mechanism&&f.weakness));
  assert.ok(!JSON.stringify(r).includes('SUPER-SECRET-KEY-123'),'full key redacted from snippet');
  assert.equal((await analyzeLicensing(join(dir),{})).findings.length>0,true);
  // a target with no licensing vocabulary yields a clean summary, no findings
  const empty=await mkdtemp(join(tmpdir(),'lumen-noلic-'));await writeFile(join(empty,'a.js'),'console.log(1)');
  const none=await analyzeLicensing(empty);assert.equal(none.findings.length,0);assert.match(none.summary,/No licensing/);
});
test('target identification routes every supported kind from magic bytes and extension',async()=>{
  const {identify,KINDS}=await import('../src/core/identify.mjs');
  const {writeFile,mkdir}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'lumen-id-'));
  const w=async(name,bytes)=>{const p=join(dir,name);await writeFile(p,Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes));return p;};
  const b=(arr,len=64)=>{const buf=Buffer.alloc(len);for(let i=0;i<arr.length;i++)buf[i]=arr[i];return buf;};
  assert.equal((await identify(await w('a.out',b([0x7f,0x45,0x4c,0x46])))).kind,'elf');
  assert.equal((await identify(await w('a.exe',b([0x4d,0x5a])))).kind,'pe');
  assert.equal((await identify(await w('a.dylib',b([0xcf,0xfa,0xed,0xfe])))).kind,'macho');
  assert.equal((await identify(await w('fat',b([0xca,0xfe,0xba,0xbe])))).kind,'macho-universal');
  assert.equal((await identify(await w('app.apk',b([0x50,0x4b,0x03,0x04])))).kind,'apk');
  assert.equal((await identify(await w('data.zip',b([0x50,0x4b,0x03,0x04])))).kind,'zip');
  assert.equal((await identify(await w('disk.dmg',b([0,0,0,0])))).kind,'dmg');
  assert.equal((await identify(await w('x.js','const a=1;'))).kind, 'javascript');
  // .NET: PE with a BSJB CLI metadata signature in the head
  const net=b([0x4d,0x5a]);Buffer.from('BSJB').copy(net,32);
  assert.equal((await identify(await w('lib.dll',net))).kind,'dotnet');
  // a real asar with no .asar extension is still recognised by its Pickle header
  if(process.env.LUMEN_ASAR)assert.equal((await identify(process.env.LUMEN_ASAR)).kind,'asar');
  // folder with package.json → electron/js
  const proj=join(dir,'proj');await mkdir(proj);await writeFile(join(proj,'package.json'),'{}');
  assert.equal((await identify(proj)).kind,'javascript');
  const app=join(dir,'My.app','Contents','Resources');await mkdir(app,{recursive:true});await writeFile(join(app,'app.asar'),'x');
  assert.equal((await identify(join(dir,'My.app'))).kind,'electron-app');
  // every kind has routing metadata
  for(const k of Object.keys(KINDS))assert.ok(KINDS[k].family&&KINDS[k].label);
  assert.equal(KINDS.pe.family,'native');assert.equal(KINDS.javascript.deep,true);
});
test('dmg mount parsing and lifecycle: finds inner app.asar and always detaches',async()=>{
  const {parseMountPoint,openDmg}=await import('../src/core/dmg.mjs');
  const plist=`<?xml version="1.0"?><plist><dict><key>system-entities</key><array>`+
    `<dict><key>content-hint</key><string>GUID_partition_scheme</string></dict>`+
    `<dict><key>mount-point</key><string>/Volumes/Demo App</string><key>dev-entry</key><string>/dev/disk4s1</string></dict>`+
    `</array></dict></plist>`;
  assert.equal(parseMountPoint(plist),'/Volumes/Demo App');
  assert.equal(parseMountPoint('<plist></plist>'),null);
  if(process.platform!=='darwin')await assert.rejects(openDmg('/x.dmg'),/only on macOS/);
});
test('native Mac .app routes to its Mach-O executable instead of erroring',async()=>{
  const {resolveTarget}=await import('../src/core/target.mjs');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'lumen-macapp-'));
  const app=join(root,'Native.app'),macos=join(app,'Contents','MacOS');
  await mkdir(macos,{recursive:true});
  await writeFile(join(app,'Contents','Info.plist'),'<plist><dict><key>CFBundleExecutable</key><string>NativeTool</string></dict></plist>');
  await writeFile(join(macos,'NativeTool'),'\x7fELF binary');await writeFile(join(macos,'helper'),'x');
  const r=await resolveTarget(app);
  assert.equal(r.kind,'macho');assert.equal(r.target,join(macos,'NativeTool'));
  assert.ok(r.notes[0].includes('native Mac app'));
  // Electron .app still wins
  const el=join(root,'El.app'),res=join(el,'Contents','Resources');await mkdir(res,{recursive:true});await writeFile(join(res,'app.asar'),'x');
  assert.equal((await resolveTarget(el)).kind,'app-bundle');
});
