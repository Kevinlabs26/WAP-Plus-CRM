import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function DeferredWatchers('),app.indexOf('function DeferredCrmPanel('));
const delay=app.match(/const WATCHER_AFTER_READY_MS = (\d+);/)[1];
const {code}=await transform(`
 const WATCHER_AFTER_READY_MS=${delay};
 const useState=()=>[false,value=>globalThis.startupValues.push(value)];
 const useEffect=fn=>{globalThis.startupEffect=fn;};
 const isComposerInputActive=()=>true;
 ${source}
 export {DeferredWatchers};
`,{loader:'tsx',jsxFactory:'h',format:'esm'});
const {DeferredWatchers}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('continuous typing cannot postpone global watchers indefinitely, and unmount cancels startup',()=>{
 const oldWindow=globalThis.window,oldNow=Date.now;
 let now=1700000000000,nextId=0;
 const timers=new Map();
 Date.now=()=>now;
 globalThis.window={setTimeout(fn,ms){const id=++nextId;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
 const advance=ms=>{const end=now+ms;while(timers.size){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(timer.at>end)break;now=timer.at;timers.delete(id);timer.fn();}now=end;};
 try{
  globalThis.startupValues=[];
  DeferredWatchers({interactive:true});
  let cleanup=globalThis.startupEffect();
  advance(4500);assert.deepEqual(globalThis.startupValues,[]);
  advance(1500);assert.deepEqual(globalThis.startupValues,[true]);cleanup();
  globalThis.startupValues=[];
  DeferredWatchers({interactive:true});cleanup=globalThis.startupEffect();cleanup();
  advance(10000);assert.deepEqual(globalThis.startupValues,[]);
  DeferredWatchers({interactive:false});globalThis.startupEffect();
  assert.deepEqual(globalThis.startupValues,[false]);
 }finally{globalThis.window=oldWindow;Date.now=oldNow;delete globalThis.startupEffect;delete globalThis.startupValues;}
});
