import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {normalizePlaybooks, resolvePlaybook} from '../src/lib/aiPlaybooks.ts';

const src=fileURLToPath(new URL('../src',import.meta.url));
const mocks={
  './museWeb':'export const museWebStatus=async()=>globalThis.pbSyncStatus;export const generateMuseWeb=(...args)=>globalThis.pbSyncRequest(...args);',
  '@/store/appStore':'export const useAppStore={getState:()=>globalThis.pbSyncState};',
  './aiUsage':'export const trackAiRequest=async(_meta,work)=>work();',
  '@/store/restoreGuard':'export const getDataRestoreGeneration=()=>globalThis.pbSyncEpoch;export const isDataRestoreActive=()=>globalThis.pbSyncRestoring;',
};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/lib/musePlaybookSync.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':src},plugins:[{name:'muse-sync-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {parsePlaybookManifest,parsePlaybookSummaries,mergeMusePlaybooks,syncMusePlaybooks,shouldAutoSyncPlaybooks}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const source=(name,role='stage',hash='a')=>({path:`/workspace/playbooks/${name}.md`,name,sha256:hash.repeat(64),role});
const manifest=(files)=>({root:'/workspace/playbooks',files});
const summaries=files=>({files:files.map(file=>({path:file.path,sha256:file.sha256,summary:`Real concise rules for ${file.name}`}))});
const local={id:'local',name:'Local',sourceName:'local.md',content:'Local full source',summary:'Local rules'};
function fixture(outputs=[]){
  globalThis.pbSyncStatus={ready:true}; globalThis.pbSyncEpoch=0;globalThis.pbSyncRestoring=false;
  const calls=[];
  globalThis.pbSyncState={settings:{aiPlaybooks:[{...local}],aiPlaybookMuseRoot:'',aiPlaybookOverviewId:'',aiPlaybookMuseSyncedAt:42},updateSettings(patch){this.settings={...this.settings,...patch};}};
  globalThis.pbSyncRequest=async(...args)=>{calls.push(args);const output=outputs.shift();if(output instanceof Error)throw output;if(typeof output==='function')return output();return JSON.stringify(output);};
  return {calls,outputs};
}

test('workspace manifests reject unsafe paths, duplicate files, invalid revisions and source changes',()=>{
  const file=source('stage');
  assert.equal(parsePlaybookManifest(JSON.stringify(manifest([file]))).files[0].path,file.path);
  for(const invalid of [manifest([]),manifest([file,file]),manifest([{...file,path:'/workspace/playbooks/../secret.md'}]),manifest([{...file,path:'/other/file.md'}]),manifest([{...file,sha256:'fake'}]),manifest([source('one','overview'),source('two','overview')])])assert.throws(()=>parsePlaybookManifest(JSON.stringify(invalid)));
  assert.throws(()=>parsePlaybookManifest(JSON.stringify(manifest([file])),'/different/root'));
  assert.throws(()=>parsePlaybookSummaries(JSON.stringify({files:[{path:file.path,sha256:'b'.repeat(64),summary:'wrong version'}]}),[file]));
  assert.throws(()=>parsePlaybookSummaries(JSON.stringify({files:[{path:file.path,sha256:file.sha256,summary:''}]}),[file]));
});

test('first sync reads actual file metadata then changed concise contents; unchanged files need no regeneration',async()=>{
  const files=[source('actual-overview','overview'),source('arbitrary-title')];
  const ui=fixture([manifest(files),summaries(files)]);
  assert.equal(await syncMusePlaybooks(),2);
  assert.equal(ui.calls.length,2);
  assert.match(ui.calls[0][0],/Read-only workspace file retrieval/);
  assert.doesNotMatch(ui.calls[0][0],/Local full source|Local rules/);
  assert.equal(ui.calls[0][2],undefined,'sync has no customer conversation binding');
  assert.equal(ui.calls[0][4],-1,'reply tasks have queue priority');
  const books=pbSyncState.settings.aiPlaybooks;
  const remote=books.find(book=>book.musePath===files[1].path);
  assert.equal(remote.name,'arbitrary-title');assert.equal(remote.content,'');
  assert.equal(pbSyncState.settings.aiPlaybookOverviewId,books.find(book=>book.musePath===files[0].path).id);
  assert.equal(normalizePlaybooks(books).length,3,'remote provenance survives reload');
  ui.outputs.push(manifest(files));
  assert.equal(await syncMusePlaybooks(),0);assert.equal(ui.calls.length,3);
  assert.equal(pbSyncState.settings.aiPlaybooks.find(book=>book.musePath===files[1].path).id,remote.id);
  assert.equal(pbSyncState.settings.aiPlaybooks.find(book=>book.id==='local').content,'Local full source');
});

test('failed later batches and unknown submissions never partially replace the successful cache',async()=>{
  const files=Array.from({length:7},(_,i)=>source(`stage-${i}`));
  const ui=fixture([manifest(files),summaries(files.slice(0,6)),new Error('request outcome unknown')]);
  const before=JSON.stringify(pbSyncState.settings.aiPlaybooks);
  await assert.rejects(()=>syncMusePlaybooks(),/unknown/);
  assert.equal(ui.calls.length,3);assert.equal(JSON.stringify(pbSyncState.settings.aiPlaybooks),before);
  assert.equal(pbSyncState.settings.aiPlaybookMuseSyncedAt,42);
  assert.match(pbSyncState.settings.aiPlaybookMuseError,/unknown/);
});

test('concurrent sync calls share one request and a local edit prevents another remote request or overwrite',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const ui=fixture([()=>pending]);
  const first=syncMusePlaybooks(),second=syncMusePlaybooks();assert.equal(first,second);
  await Promise.resolve();await Promise.resolve();
  pbSyncState.settings.aiPlaybooks=[{...local,summary:'User edit'}];
  release(JSON.stringify(manifest([source('stage')])));
  await assert.rejects(()=>first,/修改/);
  assert.equal(ui.calls.length,1);assert.equal(pbSyncState.settings.aiPlaybooks[0].summary,'User edit');
});

test('restore invalidates pending synchronization without writing status or data into the restored settings',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  fixture([()=>pending]);const task=syncMusePlaybooks();
  await Promise.resolve();await Promise.resolve();
  pbSyncEpoch++;pbSyncState.settings={aiPlaybooks:[{...local,summary:'Restored'}],aiPlaybookMuseRoot:''};
  release(JSON.stringify(manifest([source('stage')])));
  await assert.rejects(()=>task,/恢复/);
  assert.equal(pbSyncState.settings.aiPlaybooks[0].summary,'Restored');assert.equal(pbSyncState.settings.aiPlaybookMuseError,undefined);
});

test('remote missing files remain cached but block their old bindings; unrelated local documents remain intact',()=>{
  const files=[source('first'),source('second')];
  let books=mergeMusePlaybooks([local],manifest(files),parsePlaybookSummaries(JSON.stringify(summaries(files)),files));
  const removedId=books.find(book=>book.musePath===files[0].path).id;
  books=mergeMusePlaybooks(books,manifest([files[1]]),new Map());
  assert.equal(books.find(book=>book.id===removedId).museMissing,true);
  assert.equal(books.find(book=>book.id==='local').content,local.content);
  assert.match(resolvePlaybook({aiPlaybooks:books,aiPlaybookBindings:{'["account","chat"]':removedId}},'account','chat').error,/同步清单/);
});

test('automatic checks require a linked source, explicit enablement, visible ready UI, idle text queue and hourly spacing',()=>{
  const config={aiPlaybookAutoSync:true,aiPlaybookMuseRoot:'/workspace/playbooks',aiPlaybookMuseAttemptAt:1000};
  assert.equal(shouldAutoSyncPlaybooks(config,3_601_001,true,true,true),true);
  assert.equal(shouldAutoSyncPlaybooks(config,2000,true,true,true),false);
  for(const args of [[false,true,true],[true,false,true],[true,true,false]])assert.equal(shouldAutoSyncPlaybooks(config,4_000_000,...args),false);
  assert.equal(shouldAutoSyncPlaybooks({...config,aiPlaybookAutoSync:false},4_000_000,true,true,true),false);
  assert.equal(shouldAutoSyncPlaybooks({...config,aiPlaybookMuseRoot:''},4_000_000,true,true,true),false);
});
