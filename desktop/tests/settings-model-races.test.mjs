import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
 react:'export const useState=v=>globalThis.modelHooks.state(v);export const useRef=v=>globalThis.modelHooks.ref(v);export const useEffect=(f,d)=>globalThis.modelHooks.effect(f,d);export const useCallback=(f,d)=>globalThis.modelHooks.callback(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.modelStore);',
 '@/components/ui/primitives':'export const Input="input",SectionLabel="h4";',
 '@/i18n':'export const useI18n=()=>({t:globalThis.modelTranslate});',
 '@/lib/listModels':'export const listProviderModels=(provider,settings)=>new Promise((resolve,reject)=>globalThis.modelRequests.push({provider,key:settings.openaiKey||settings.groqKey,resolve,reject}));',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/settings/SettingsAiPanel.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {SettingsAiPanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('only the latest model request can update the list, including credential changes and unmount',async()=>{
 const cells=[],effects=[];let index=0,writes=0;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 globalThis.modelRequests=[];globalThis.modelTranslate=k=>k;
 globalThis.modelStore={settings:{aiProvider:'openai',openaiKey:'test-a',aiModel:''},updateSettings:()=>{}};
 globalThis.modelHooks={
  state(initial){const n=index++;cells[n]??={value:initial};return[cells[n].value,value=>{writes++;cells[n].value=value;}];},
  ref(value){return cells[index++]??={current:value};},
  callback(fn,deps){const n=index++;if(!equal(cells[n]?.deps,deps))cells[n]={deps,fn};return cells[n].fn;},
  effect(fn,deps){const n=index++;if(!equal(cells[n]?.deps,deps)){const old=cells[n];cells[n]={deps};effects.push(()=>{old?.cleanup?.();cells[n].cleanup=fn();});}},
 };
 const ModelPicker=nodes(SettingsAiPanel()).find(node=>node.type?.name==='ModelPicker').type;
 const render=()=>{index=0;const tree=ModelPicker({settings:modelStore.settings,onModelChange:()=>{}});effects.splice(0).forEach(fn=>fn());return nodes(tree);};
 const options=()=>render().filter(node=>node.type==='option').map(node=>node.props.value);
 try {
  render();assert.equal(modelRequests.length,1);
  modelStore.settings={aiProvider:'groq',groqKey:'test-b',aiModel:''};render();assert.equal(modelRequests.length,2);
  modelRequests[1].resolve([{id:'groq-model',label:'Groq'}]);await tick();assert.ok(options().includes('groq-model'));
  modelRequests[0].reject(new Error('old provider error'));await tick();assert.ok(options().includes('groq-model'));
  modelStore.settings={...modelStore.settings,groqKey:'test-b-new'};render();assert.equal(modelRequests.length,3);
  modelRequests[2].resolve([{id:'new-key-model',label:'New'}]);await tick();assert.ok(options().includes('new-key-model'));assert.ok(!options().includes('groq-model'));
  const refresh=render().find(node=>node.type==='button');refresh.props.onClick();refresh.props.onClick();assert.equal(modelRequests.length,5);
  modelRequests[4].resolve([{id:'latest-refresh',label:'Latest'}]);await tick();
  modelRequests[3].resolve([{id:'stale-refresh',label:'Stale'}]);await tick();
  assert.ok(options().includes('latest-refresh'));assert.ok(!options().includes('stale-refresh'));
  render().find(node=>node.type==='button').props.onClick();assert.equal(modelRequests.length,6);
  cells.forEach(cell=>cell?.cleanup?.());const before=writes;
  modelRequests[5].resolve([{id:'after-unmount',label:'Late'}]);await tick();assert.equal(writes,before);
 }finally{for(const key of ['modelHooks','modelRequests','modelTranslate','modelStore'])delete globalThis[key];}
});
