import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks={
 react:'export const useState=i=>globalThis.batchHooks.state(i),useRef=i=>globalThis.batchHooks.ref(i),useEffect=(f,d)=>globalThis.batchHooks.effect(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx;',
 'lucide-react':'export const LoaderCircle="loading",Pause="pause",Play="play";',
 '@/components/ui/primitives':'export const Button="button";',
 '@/i18n':'export const useI18n=()=>({t:(k,p)=>k+(p?JSON.stringify(p):"")});',
 '@/store/appStore':'export const useAppStore=Object.assign(f=>f(globalThis.batchState),{getState:()=>globalThis.batchState});',
 '@/lib/scheduledPlanActions':'export const updateScheduledPlan=async(id,change)=>{const s=globalThis.batchState;s.settings.scheduledPlans=s.settings.scheduledPlans.map(p=>p.id===id?change(p):p);};',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/layout/BatchTaskIndicator.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'batch-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {BatchTaskIndicator}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
test('bulk progress opens automatically, pauses queued tasks and preserves the completion result',async()=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document;const listeners=new Map();
 globalThis.window={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),setInterval:()=>1,clearInterval(){}};
 globalThis.document={addEventListener(){},removeEventListener(){}};
 const now=new Date().toISOString();const state={settings:{scheduledPlans:[],waAccounts:[{id:'a',label:'Account A'}]},broadcastCampaigns:[],pushToast(){},setSettingsOpen(...args){state.opened=args;}};
 globalThis.batchState=state;let slots=[],cursor=0,tree;const effects=[],cleanups=[];
 globalThis.batchHooks={state(i){const at=cursor++;if(!(at in slots))slots[at]=typeof i==='function'?i():i;return[slots[at],v=>{slots[at]=typeof v==='function'?v(slots[at]):v;}];},ref(i){const at=cursor++;return slots[at]??(slots[at]={current:i});},effect(f,d){const at=cursor++;if(!slots[at]||d.some((v,j)=>v!==slots[at].deps[j])){slots[at]?.cleanup?.();slots[at]={deps:d};effects.push(()=>{const cleanup=f();slots[at].cleanup=cleanup;cleanups.push(cleanup);});}}};
 const render=()=>{cursor=0;tree=BatchTaskIndicator();while(effects.length)effects.shift()();};
 const find=label=>nodes(tree).find(n=>n.props['aria-label']===label||n.props.children===label);
 try{
  render();assert.equal(tree,null);
  state.settings.scheduledPlans=[{id:'p',title:'Folder bulk',status:'pending',text:'Hello',createdAt:now,dueAt:now,gapSec:30,items:[{id:'1',status:'pending',accountId:'a',contactName:'One'},{id:'2',status:'pending',accountId:'a',contactName:'Two'}]}];
  listeners.get('wap:open-batch-progress')({detail:{planId:'p'}});render();
  assert.equal(find('planQueue.progressTitle').props['aria-expanded'],true);
  assert.equal(nodes(tree).find(n=>n.props.role==='progressbar').props['aria-valuenow'],0);
  find('planQueue.pause').props.onClick();await Promise.resolve();render();
  assert.equal(state.settings.scheduledPlans[0].status,'paused');assert.ok(find('planQueue.userPaused'));
  find('planQueue.resume').props.onClick();await Promise.resolve();render();assert.equal(state.settings.scheduledPlans[0].status,'pending');
  state.settings.scheduledPlans[0]={...state.settings.scheduledPlans[0],status:'paused',items:[{id:'1',status:'sending'}]};render();
  assert.equal(find('planQueue.resume').props.disabled,true);assert.ok(find('planQueue.pausingInFlight'));
  state.settings.scheduledPlans[0]={...state.settings.scheduledPlans[0],status:'done',items:[{id:'1',status:'sent'},{id:'2',status:'sent'}]};render();
  assert.ok(find('planQueue.status.done'));assert.equal(nodes(tree).find(n=>n.props.role==='progressbar').props['aria-valuenow'],2);
  find('planQueue.details').props.onClick();assert.deepEqual(state.opened,[true,'scheduled']);render();assert.equal(tree,null);
 }finally{cleanups.forEach(f=>f?.());globalThis.window=previousWindow;globalThis.document=previousDocument;delete globalThis.batchState;delete globalThis.batchHooks;}
});
