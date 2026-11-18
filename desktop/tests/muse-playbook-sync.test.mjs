import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {normalizePlaybooks, resolvePlaybook} from '../src/lib/aiPlaybooks.ts';

const src=fileURLToPath(new URL('../src',import.meta.url));
const mocks={
  './museWeb':'export const museWebAccounts=async()=>globalThis.pbMuseAccounts;export const museWebStatus=async()=>globalThis.pbSyncStatus;export const readyMuseAutoReplyAccounts=async(ids)=>ids||[];export const generateMuseWeb=(...args)=>globalThis.pbSyncRequest(...args);',
  '@/store/appStore':'export const useAppStore={getState:()=>globalThis.pbSyncState};',
  './aiUsage':'export const trackAiRequest=async(_meta,work)=>work();',
  '@/store/restoreGuard':'export const getDataRestoreGeneration=()=>globalThis.pbSyncEpoch;export const isDataRestoreActive=()=>globalThis.pbSyncRestoring;',
};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/lib/musePlaybookSync.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':src},plugins:[{name:'muse-sync-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});

const {parsePlaybookManifest,mergeMusePlaybooks,shareMusePlaybooks,trainMuseAccountPlaybooks,syncMusePlaybooks,shouldAutoSyncPlaybooks}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const local={id:'local',name:'Local',sourceName:'local.md',content:'Local source',summary:'Local rules'};
const {syncSelectedMusePlaybookCopies}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const manifest=paths=>({root:'/workspace',paths});
function fixture(output){
 globalThis.pbSyncStatus={ready:true};globalThis.pbSyncEpoch=0;globalThis.pbSyncRestoring=false;
 globalThis.pbMuseAccounts={accounts:[],selectedId:'',primaryId:'main'};
 const calls=[];globalThis.pbSyncState={settings:{aiPlaybooks:[{...local}],aiPlaybookMuseRoot:'',aiPlaybookMuseFolder:'playbooks',aiPlaybookMuseSyncedAt:42},updateSettings(patch){this.settings={...this.settings,...patch};}};
 globalThis.pbSyncRequest=async(...args)=>{calls.push(args);return typeof output==='function'?output():JSON.stringify(output);};return calls;
}
test('Muse preserves exact Markdown bytes through Base64',async()=>{
 const path='/workspace/playbooks/03-主动联系接待.md';
 const content='# 03 接待\n\n```text\nUse `tu`, **keep** _wording_ and <profile> literally.\n路径: C:\\notes\\03.md 🙏\n```\n';
 const json=JSON.stringify({files:[{path,contentBase64:Buffer.from(content).toString('base64'),sha256:createHash('sha256').update(content).digest('hex')}]});
 for(const output of [json,'```json\n'+json+'\n```']){
  const calls=fixture(()=>output);
  pbSyncState.settings.aiPlaybooks=[{id:'remote',name:'03',sourceName:'03-主动联系接待.md',content:'',summary:'',musePath:path}];
  await shareMusePlaybooks([path]);
  assert.equal(pbSyncState.settings.aiPlaybooks[0].content,content);
  assert.equal(calls[0][6],'main');assert.match(calls[0][0],/base64 -w 0/);assert.match(calls[0][0],/contentBase64/);
 }
});
test('副号 Playbook 只有回读内容与来源完全一致才登记为已训练',async()=>{
 const path='/workspace/WAP Plus CRM - Playbook/stage.md';
 const material={id:'stage',name:'Stage',content:'Actual source',revision:'revision-1'};
 const managed='<!-- managed by WAP Plus CRM: stage -->\n# Stage\n\nActual source';
 const setup=output=>{
  const calls=fixture(output);
  pbMuseAccounts={accounts:[{id:'sub'}],selectedId:'sub',primaryId:'main'};
  pbSyncState.settings.aiPlaybooks=[{id:'stage',name:'Stage',sourceName:'stage.md',content:material.content,summary:'',museShareRevision:material.revision}];
  return calls;
 };
 const calls=setup({root:'/workspace',files:[{id:'stage',path,content:managed}]});
 await trainMuseAccountPlaybooks('sub',[material]);
 assert.equal(calls[0][6],'sub');assert.match(calls[0][0],/read each exact target file back/);
 assert.equal(pbSyncState.settings.aiPlaybooks[0].museAccountCopies.sub.path,path);
 const failed=setup({root:'/workspace',files:[{id:'stage',path,content:managed+' altered'}]});
 await assert.rejects(trainMuseAccountPlaybooks('sub',[material]),/副本内容校验失败/);
 assert.equal(failed[0][6],'sub');assert.equal(pbSyncState.settings.aiPlaybooks[0].museAccountCopies,undefined);
});
test('background sync copies an edited 25,017-character Playbook only to the selected secondary',async()=>{
 const path='/workspace/playbooks/long.md';
 const old='a'.repeat(25017), updated=old.slice(0,-1)+'b';
 fixture({});
 pbMuseAccounts={primaryId:'main',selectedId:'main',accounts:[{id:'main',primary:true},{id:'sub'},{id:'other'}]};
 Object.assign(pbSyncState.settings,{aiProvider:'muse',aiPlaybookMuseAccountId:'main',museAutoReplyAccountIds:['sub'],
  aiPlaybooks:[{...local,id:'long',musePath:path,content:old,museShareRevision:'old'}]});
 const written=[];
 pbSyncRequest=async(prompt,_signal,_key,_ctx,_priority,_start,account)=>{
  if(account==='main'){
   return JSON.stringify({files:[{path,contentBase64:Buffer.from(updated).toString('base64'),sha256:createHash('sha256').update(updated).digest('hex')}]});
  }
  assert.equal(account,'sub');
  const [entry]=JSON.parse(prompt.split('Entries: ').at(-1));
  assert.equal(pbSyncState.settings.aiPlaybooks[0].museAccountCopies?.sub,undefined);
  written.push(entry.content.split('\n\n')[1]);
  return JSON.stringify({root:'/workspace',files:[{...entry,path:'/workspace/WAP Plus CRM - Playbook/'+entry.id+'.md'}]});
 };
 await syncSelectedMusePlaybookCopies();
 const [book]=pbSyncState.settings.aiPlaybooks;
 assert.equal(written.join(''),updated);
 assert.equal(book.museAccountCopies.sub.parts,9);
 assert.equal(book.museAccountCopies.sub.revision,book.museShareRevision);
 assert.equal(book.museAccountCopies.other,undefined);
 const profile=resolvePlaybook({...pbSyncState.settings,aiPlaybookBindings:{'["wa","chat"]':'long'}},'wa','chat','sub');
 assert.equal(profile.musePaths?.length,9);
});
test('Muse Base64 copy preserves source line endings and final newline exactly',async()=>{
 const path='/workspace/playbooks/stage.md',source='Line one\r\nLine two\r\n';
 fixture({files:[{path,contentBase64:Buffer.from(source).toString('base64'),sha256:createHash('sha256').update(source).digest('hex')}]});
 pbSyncState.settings.aiPlaybooks=[{id:'remote',name:'Stage',sourceName:'stage.md',content:'',summary:'',musePath:path}];
 await shareMusePlaybooks([path]);
 assert.equal(pbSyncState.settings.aiPlaybooks[0].content,source);
});
test('large Muse Playbooks split reads before Muse conversation handoff',async()=>{
 const path='/workspace/playbooks/02.md',source='你'.repeat(68018)+'ab',bytes=Buffer.from(source),encoded=bytes.toString('base64'),sha256=createHash('sha256').update(bytes).digest('hex');
 const calls=fixture({});pbSyncState.settings.aiPlaybooks=[{id:'remote',name:'02',sourceName:'02.md',content:'',summary:'',musePath:path}];
 globalThis.pbSyncRequest=async(...args)=>{
  calls.push(args);const prompt=args[0];
  if(!prompt.includes('chunkIndex='))return JSON.stringify({files:[{path,sizeBytes:bytes.length,sha256}]});
  const range=/\| cut -c (\d+)-(\d+)/.exec(prompt),indices=/chunkIndex=(\d+), chunkCount=(\d+)/.exec(prompt);
  assert.ok(range&&indices);
  const start=Number(range[1]),end=Number(range[2]);
  return JSON.stringify({files:[{path,sizeBytes:bytes.length,sha256,chunkIndex:Number(indices[1]),chunkCount:Number(indices[2]),contentBase64:encoded.slice(start-1,end)}]});
 };
 await shareMusePlaybooks([path]);
 assert.equal(pbSyncState.settings.aiPlaybooks.find(book=>book.musePath===path).content,source);
 assert.equal(calls.length,24);
 const keys=calls.map(call=>call[2]);
 assert.equal(new Set(keys).size,3);
 assert.equal(keys[0],keys[8]);assert.notEqual(keys[8],keys[9]);
 assert.equal(keys[9],keys[16]);assert.notEqual(keys[16],keys[17]);
});
test('Muse source hash mismatch leaves the unsaved Playbook untouched',async()=>{
 const path='/workspace/playbooks/stage.md';fixture({files:[{path,contentBase64:Buffer.from('Unverified content').toString('base64'),sha256:createHash('sha256').update('different source').digest('hex')}]});
 pbSyncState.settings.aiPlaybooks=[{id:'remote',name:'Stage',sourceName:'stage.md',content:'',summary:'',musePath:path}];
 await assert.rejects(shareMusePlaybooks([path]),/正文与 Workspace 文件校验不一致/);
 assert.equal(pbSyncState.settings.aiPlaybooks[0].content,'');
});
test('selected-folder manifests reject traversal, duplicate, outside and empty paths',()=>{
 const path='/workspace/playbooks/stage.md';assert.equal(parsePlaybookManifest(JSON.stringify(manifest([path])),'','playbooks').files[0].path,path);
 for(const paths of [[],[path,path],['/workspace/playbooks/../secret.md'],['/other/file.md'],['/workspace/other/file.md']])assert.throws(()=>parsePlaybookManifest(JSON.stringify(manifest(paths)),'','playbooks'));
 assert.throws(()=>parsePlaybookManifest(JSON.stringify(manifest([path])),'/different','playbooks'));
});
test('Muse rendered JSON code-card label is removed before parsing',()=>{
 const path='/workspace/playbooks/stage.md';assert.equal(parsePlaybookManifest(`json\n${JSON.stringify(manifest([path]))}`,'','playbooks').files[0].path,path);
});
test('sync lists only the selected folder without retrieving contents or using a customer thread',async()=>{
 const calls=fixture(manifest(['/workspace/playbooks/stage.md']));assert.equal(await syncMusePlaybooks(),1);
 assert.equal(calls.length,1);assert.match(calls[0][0],/playbooks/);assert.match(calls[0][0],/Do not list paths outside/);assert.doesNotMatch(calls[0][0],/Local source|Local rules/);assert.equal(calls[0][2],undefined);assert.equal(calls[0][4],-1);
 const books=pbSyncState.settings.aiPlaybooks,remote=books.find(b=>b.musePath);assert.equal(remote.content,'');assert.equal(pbSyncState.settings.aiPlaybookMuseRoot,'/workspace');assert.equal(normalizePlaybooks(books).length,2);
 const id=remote.id;await syncMusePlaybooks();assert.equal(pbSyncState.settings.aiPlaybooks.find(b=>b.musePath).id,id);assert.equal(pbSyncState.settings.aiPlaybooks.find(b=>b.id==='local').content,local.content);
});
test('failed sync keeps the successful cache and records the error',async()=>{
 fixture(()=>{throw Error('request outcome unknown');});const before=structuredClone(pbSyncState.settings.aiPlaybooks);await assert.rejects(syncMusePlaybooks(),/unknown/);assert.deepEqual(pbSyncState.settings.aiPlaybooks,before);assert.equal(pbSyncState.settings.aiPlaybookMuseSyncedAt,42);
});
test('concurrent calls share one request and never overwrite an intervening local edit',async()=>{
 let release;const pending=new Promise(r=>{release=r});const calls=fixture(()=>pending);const first=syncMusePlaybooks();assert.equal(syncMusePlaybooks(),first);await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);pbSyncState.settings.aiPlaybooks=[{...local,summary:'User edit'}];release(JSON.stringify(manifest(['/workspace/playbooks/stage.md'])));await assert.rejects(first,/修改/);assert.equal(pbSyncState.settings.aiPlaybooks[0].summary,'User edit');
});
test('restore invalidates pending sync without writing into restored data',async()=>{
 let release;const pending=new Promise(r=>{release=r});fixture(()=>pending);const task=syncMusePlaybooks();await new Promise(r=>setImmediate(r));pbSyncEpoch++;pbSyncState.settings={aiPlaybooks:[{...local,summary:'Restored'}]};release(JSON.stringify(manifest(['/workspace/playbooks/stage.md'])));await assert.rejects(task,/恢复/);assert.equal(pbSyncState.settings.aiPlaybookMuseError,undefined);assert.equal(pbSyncState.settings.aiPlaybooks[0].summary,'Restored');
});
test('missing files retain stable bindings and local sources while blocking use',()=>{
 const parsed=parsePlaybookManifest(JSON.stringify(manifest(['/workspace/playbooks/one.md','/workspace/playbooks/two.md'])),'','playbooks');let books=mergeMusePlaybooks([local],parsed,false,'playbooks');const removed=books.find(b=>b.musePath?.endsWith('one.md'));
 books=mergeMusePlaybooks(books,{root:'/workspace',files:parsed.files.slice(1)},false,'playbooks');assert.equal(books.find(b=>b.id===removed.id).museMissing,true);assert.equal(books.find(b=>b.id==='local').content,local.content);assert.ok(resolvePlaybook({aiPlaybooks:books,aiPlaybookBindings:{'["account","chat"]':removed.id}},'account','chat').error);
});
test('automatic sync requires an explicit folder, opt-in, readiness and idle queue',()=>{
 const settings={aiProvider:'muse',aiPlaybookMuseWorkspaceLinked:true,aiPlaybookAutoSync:true,aiPlaybookMuseRoot:'/workspace',aiPlaybookMuseFolder:'playbooks',aiPlaybookMuseAttemptAt:1000};assert.equal(shouldAutoSyncPlaybooks(settings,3601001,true,true,true),true);assert.equal(shouldAutoSyncPlaybooks(settings,2000,true,true,true),false);
 for(const args of [[false,true,true],[true,false,true],[true,true,false]])assert.equal(shouldAutoSyncPlaybooks(settings,4000000,...args),false);
 for(const patch of [{aiPlaybookAutoSync:false},{aiProvider:'openai'},{aiPlaybookMuseWorkspaceLinked:false},{aiPlaybookMuseFolder:''},{aiPlaybookMuseRoot:''}])assert.equal(shouldAutoSyncPlaybooks({...settings,...patch},4000000,true,true,true),false);
});
