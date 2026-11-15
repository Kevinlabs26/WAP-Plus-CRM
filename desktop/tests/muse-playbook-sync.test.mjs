import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {normalizePlaybooks, resolvePlaybook} from '../src/lib/aiPlaybooks.ts';

const src=fileURLToPath(new URL('../src',import.meta.url));
const mocks={
  './museWeb':'export const museWebAccounts=async()=>({accounts:[],selectedId:"",primaryId:""});export const museWebStatus=async()=>globalThis.pbSyncStatus;export const generateMuseWeb=(...args)=>globalThis.pbSyncRequest(...args);',
  '@/store/appStore':'export const useAppStore={getState:()=>globalThis.pbSyncState};',
  './aiUsage':'export const trackAiRequest=async(_meta,work)=>work();',
  '@/store/restoreGuard':'export const getDataRestoreGeneration=()=>globalThis.pbSyncEpoch;export const isDataRestoreActive=()=>globalThis.pbSyncRestoring;',
};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/lib/musePlaybookSync.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':src},plugins:[{name:'muse-sync-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});

const {parsePlaybookManifest,mergeMusePlaybooks,syncMusePlaybooks,shouldAutoSyncPlaybooks}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const local={id:'local',name:'Local',sourceName:'local.md',content:'Local source',summary:'Local rules'};
const manifest=paths=>({root:'/workspace',paths});
function fixture(output){
 globalThis.pbSyncStatus={ready:true};globalThis.pbSyncEpoch=0;globalThis.pbSyncRestoring=false;
 const calls=[];globalThis.pbSyncState={settings:{aiPlaybooks:[{...local}],aiPlaybookMuseRoot:'',aiPlaybookMuseFolder:'playbooks',aiPlaybookOverviewId:'',aiPlaybookMuseSyncedAt:42},updateSettings(patch){this.settings={...this.settings,...patch};}};
 globalThis.pbSyncRequest=async(...args)=>{calls.push(args);return typeof output==='function'?output():JSON.stringify(output);};return calls;
}
test('selected-folder manifests reject traversal, duplicate, outside and empty paths',()=>{
 const path='/workspace/playbooks/stage.md';assert.equal(parsePlaybookManifest(JSON.stringify(manifest([path])),'','playbooks').files[0].path,path);
 for(const paths of [[],[path,path],['/workspace/playbooks/../secret.md'],['/other/file.md'],['/workspace/other/file.md']])assert.throws(()=>parsePlaybookManifest(JSON.stringify(manifest(paths)),'','playbooks'));
 assert.throws(()=>parsePlaybookManifest(JSON.stringify(manifest([path])),'/different','playbooks'));
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
