import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
 '@/store/appStore': 'export const useAppStore={getState:()=>globalThis.syncState};',
 '@/lib/googleSheets': 'export const letter=i=>String.fromCharCode(65+i),tabRange=s=>s,readSheet=(...a)=>globalThis.syncState.read(...a),updateSheetCell=(...a)=>globalThis.syncState.write(...a);',
 '@/lib/googleSheetErrors': 'export const sheetErrorHint=()=>"error";',
};
const bundle = await build({entryPoints:[fileURLToPath(new URL('../src/lib/quickReplySheetSync.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'sync-boundaries',setup(b){
 b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}]});
const {scheduleQuickReplySheetSync,resumePendingQuickReplySheetSync,cancelQuickReplySheetSync} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('concurrent new replies reserve different rows and stale edits cannot roll back newer edits',async()=>{
 const link={spreadsheetId:'sheet',tab:'Tab',row:0,originalColumn:0,translationColumn:1,originalSnapshot:'',translationSnapshot:''};
 const state={settings:{quickReplies:['a','b'].map(id=>({id,body:id,translation:id.toUpperCase(),sheetLink:{...link}}))},
  updateSettings(patch){Object.assign(state.settings,patch);},pushToast(...args){throw Error(JSON.stringify(args));}};
 const columns=[[],[]];let active=0,maxActive=0;const writes=[];
 state.read=async(id,ranges)=>{
  active++;maxActive=Math.max(maxActive,active);
  const result={valueRanges:ranges.map(range=>({values:[columns[range.includes('!A')?0:1].slice()]}))};
  await new Promise(setImmediate);active--;return result;
 };
 state.write=async(id,tab,column,row,value)=>{columns[column][row-1]=value;writes.push([column,row,value]);};
 globalThis.syncState=state;
 const originalTimer=globalThis.setTimeout;const pending=[];
 globalThis.setTimeout=fn=>{pending.push(fn);return pending.length;};
 try{
  scheduleQuickReplySheetSync('a',k=>k);scheduleQuickReplySheetSync('b',k=>k);
  pending.splice(0).forEach(fn=>fn());
  for(let i=0;i<20&&state.settings.quickReplies.some(r=>!r.sheetLink.row);i++)await new Promise(setImmediate);
  assert.deepEqual(state.settings.quickReplies.map(r=>r.sheetLink.row),[1,2]);
  assert.equal(maxActive,1);
  assert.deepEqual(columns,[['a','b'],['A','B']]);

  state.read=async()=>{await new Promise(setImmediate);return {valueRanges:[{values:[['a']]},{values:[['A']]}]};};
  state.settings.quickReplies[0].body='intermediate';
  scheduleQuickReplySheetSync('a',k=>k);pending.splice(0).forEach(fn=>fn());
  await Promise.resolve();
  state.settings.quickReplies[0].body='latest';
  scheduleQuickReplySheetSync('a',k=>k);pending.splice(0).forEach(fn=>fn());
  for(let i=0;i<20&&state.settings.quickReplies[0].sheetLink.originalSnapshot!=='latest';i++)await new Promise(setImmediate);
  assert.equal(state.settings.quickReplies[0].body,'latest');
  assert.equal(columns[0][0],'latest');
  assert.ok(!writes.some(([, ,value])=>value==='intermediate'));
 }finally{globalThis.setTimeout=originalTimer;delete globalThis.syncState;}
});

test('offline edits keep a persisted pending marker, retry after reconnect and recover unfinished edits on startup',async()=>{
 const originalTimer=globalThis.setTimeout, originalClear=globalThis.clearTimeout;const pending=new Map();let timerId=0,offline=true,attempts=0,remote='old';
 const state={settings:{quickReplies:[{id:'offline',body:'new body',translation:'',sheetLink:{spreadsheetId:'sheet',tab:'Tab',row:1,originalColumn:0,translationColumn:1,originalSnapshot:'old',translationSnapshot:''}}]},
  updateSettings(patch){Object.assign(state.settings,patch)},pushToast(){},read:async()=>{attempts++;if(offline)throw Error('offline');return {valueRanges:[{values:[[remote]]},{values:[['']]}]};},write:async(_id,_tab,column,_row,value)=>{if(column===0)remote=value;}};
 globalThis.syncState=state;globalThis.setTimeout=fn=>{pending.set(++timerId,fn);return timerId};globalThis.clearTimeout=id=>pending.delete(id);
 const drain=async()=>{const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn());for(let i=0;i<30;i++)await new Promise(setImmediate)};
 try{
  scheduleQuickReplySheetSync('offline',x=>x);assert.equal(state.settings.quickReplies[0].sheetLink.syncPending,true);
  await drain();assert.equal(attempts,1);assert.ok(state.settings.quickReplies[0].sheetLink.syncError);assert.equal(pending.size,1);
  offline=false;await drain();assert.equal(state.settings.quickReplies[0].sheetLink.syncPending,false);assert.equal(state.settings.quickReplies[0].sheetLink.originalSnapshot,'new body');
  state.settings.quickReplies=JSON.parse(JSON.stringify(state.settings.quickReplies));state.settings.quickReplies[0].body='edit restored after restart';
  resumePendingQuickReplySheetSync(x=>x);assert.equal(pending.size,1);await drain();assert.equal(state.settings.quickReplies[0].sheetLink.originalSnapshot,'edit restored after restart');
 }finally{cancelQuickReplySheetSync('offline');globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalClear;delete globalThis.syncState;}
});
