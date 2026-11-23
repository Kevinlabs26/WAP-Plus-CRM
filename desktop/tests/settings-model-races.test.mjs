import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const src = fileURLToPath(new URL('../src', import.meta.url));
const mocks={
 './PlaybookLibrary':'export const PlaybookLibrary="playbook-library";',
 './MuseWebFields':'export const MuseWebFields="muse-fields";',
 './AiUsagePanel':'export const AiUsagePanel="ai-usage";',
 react:'export const useState=v=>globalThis.modelHooks.state(v);export const useRef=v=>globalThis.modelHooks.ref(v);export const useEffect=(f,d)=>globalThis.modelHooks.effect(f,d);export const useCallback=(f,d)=>globalThis.modelHooks.callback(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.modelStore);',
 '@/components/ui/primitives':'export const Input="input",SectionLabel="h4";',
 '@/i18n':'export const useI18n=()=>({t:globalThis.modelTranslate});',
 '@/lib/listModels':'export const listProviderModels=(provider,settings)=>new Promise((resolve,reject)=>globalThis.modelRequests.push({provider,key:settings.openaiKey||settings.groqKey,resolve,reject}));',
 '@/lib/vertexAi':'export { VERTEX_CREDENTIAL_LIMIT, VERTEX_DEFAULT_MODEL, parseVertexServiceAccount, packVertexCredentials, unpackVertexCredentials } from "./lib/vertexAi.ts"; export const listVertexModels=(key,model,signal)=>new Promise(resolve=>globalThis.modelRequests.push({key,model,signal,resolve}));',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/settings/SettingsAiPanel.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':src},plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:src}));}}]});
const {AiServiceFields,ModelPicker}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setupHooks(){
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
 return {
  render(view){index=0;const tree=view();effects.splice(0).forEach(fn=>fn());return nodes(tree);},
  unmount(){cells.forEach(cell=>cell?.cleanup?.());},
  writes:()=>writes,
  close(){for(const key of ['modelHooks','modelRequests','modelTranslate','modelStore'])delete globalThis[key];},
 };
}
test('only the latest model request can update the list, including credential changes and unmount',async()=>{
 const hooks=setupHooks();
 const render=()=>hooks.render(()=>ModelPicker({settings:modelStore.settings,onModelChange:()=>{}}));
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
  hooks.unmount();const before=hooks.writes();
  modelRequests[5].resolve([{id:'after-unmount',label:'Late'}]);await tick();assert.equal(hooks.writes(),before);
 }finally{hooks.close();}
});

test('importing and removing Vertex JSON preserves the Express key', async () => {
 const hooks = setupHooks();
 const apiKey = 'AQ.vertex-test-key';
 const serviceAccountJson = JSON.stringify({
  type: 'service_account', project_id: 'crm-project', client_email: 'crm@crm-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
 });
 let settings = { aiProvider: 'vertex', vertexCredential: apiKey, aiModel: '' };
 const updateSettings = patch => { settings = { ...settings, ...patch }; };
 const render = () => hooks.render(() => {
  const vertex = nodes(AiServiceFields({ settings, updateSettings })).find(node => node.type?.name === 'VertexFields');
  return vertex.type(vertex.props);
 });
 const authMethod = tree => tree.find(node => node.type === 'select'
  && nodes(node).some(option => option.type === 'option' && option.props.value === 'service_account'));
 try {
  const input = render().find(node => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files: [{ size: serviceAccountJson.length, text: async () => serviceAccountJson }] } });
  await tick();
  assert.equal(authMethod(render()).props.value, 'express');
  assert.equal(JSON.parse(settings.vertexCredential).apiKey, apiKey);
  authMethod(render()).props.onChange({ target: { value: 'service_account' } });
  assert.equal(authMethod(render()).props.value, 'service_account');
  assert.equal(JSON.parse(settings.vertexCredential).serviceAccountJson, serviceAccountJson);
  render().find(node => node.type === 'button' && node.props.children === 'settingsAi.vertexRemove').props.onClick();
  assert.equal(settings.vertexCredential, apiKey);
  assert.equal(authMethod(render()), undefined);

  settings.vertexCredential = serviceAccountJson;
  render().find(node => node.type?.name === 'SecretInput').props.onChange(apiKey);
  assert.equal(authMethod(render()).props.value, 'service_account');
  assert.equal(JSON.parse(settings.vertexCredential).serviceAccountJson, serviceAccountJson);
 } finally { hooks.unmount(); hooks.close(); }
});

test('Vertex pulls models on demand and requires a new choice if the saved model is unavailable',async()=>{
 const hooks=setupHooks();
 let settings={aiProvider:'vertex',vertexCredential:'first-key',aiModel:'gemini-unavailable'};
 const updateSettings=patch=>{settings={...settings,...patch};};
 const render=()=>hooks.render(()=>{
  const fields=AiServiceFields({settings,updateSettings});
  const vertex=nodes(fields).find(node=>typeof node.type==='function'&&node.type.name==='VertexFields');
  return vertex.type(vertex.props);
 });
 const button=(tree,label)=>tree.find(node=>node.type==='button'&&node.props.children===label);
 try {
  const initial=render();
  const file=initial.find(node=>node.type==='input'&&node.props.type==='file');
  assert.equal(file.props.className,'hidden');
  let opened=false;file.props.ref.current={click(){opened=true;}};
  button(initial,'contactImport.chooseFile').props.onClick();
  assert.ok(opened);
  assert.equal(modelRequests.length,0);

  button(initial,'settingsAi.vertexLoadModels').props.onClick();
  assert.equal(modelRequests[0].key,'first-key');
  modelRequests[0].resolve(['gemini-available']);await tick();
  const loaded=render();
  assert.deepEqual(loaded.filter(node=>node.type==='option').map(node=>node.props.value),['','gemini-available']);
  assert.ok(button(loaded,'settingsAi.vertexVerify').props.disabled);
  assert.equal(settings.aiModel,'gemini-unavailable');
  loaded.find(node=>node.type==='select').props.onChange({target:{value:'gemini-available'}});
  assert.equal(settings.aiModel,'gemini-available');

  button(render(),'settingsAi.vertexLoadModels').props.onClick();
  settings={...settings,vertexCredential:'second-key'};render();
  assert.ok(modelRequests[1].signal.aborted);
  modelRequests[1].resolve(['gemini-stale']);await tick();
  assert.ok(render().find(node=>node.type==='select').props.disabled);
  assert.ok(!render().find(node=>node.type==='option'&&node.props.value==='gemini-stale'));
 }finally{hooks.unmount();hooks.close();}
});
