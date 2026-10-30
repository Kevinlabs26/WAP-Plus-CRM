import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
 '@/store/appStore':'export const useAppStore=selector=>selector({requestConfirm:async opts=>{globalThis.sheetDisconnectPrompt=opts;return !!globalThis.sheetDisconnectApproved;}});',
 react:'export const useState=(v)=>globalThis.sheetSettingsHooks.state(v);export const useEffect=(f,d)=>globalThis.sheetSettingsHooks.effect(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'lucide-react':'export const Check="icon",ExternalLink="icon",Link2="icon",RefreshCw="icon",TableProperties="icon";',
 '@/components/ui/primitives':'export const Button="button",SectionLabel="label";',
 '@/i18n':'export const useI18n=()=>({t:k=>k});',
 '@/lib/googleSheetApi':'export const spreadsheetId=v=>v.includes("abc")?"abc":null;',
 '@/lib/googleSheets':'export const useGoogleSheets=()=>globalThis.sheetSettingsState;export const initializeSheets=async()=>{};export const letter=i=>String.fromCharCode(65+i);export const sheetHeaders=async()=>["Phone","Order"];export const saveSheetConfig=async config=>globalThis.sheetSaved=config;export const readSheet=async()=>({sheets:[]});export const connectSheets=async()=>{};export const disconnectSheets=async()=>{globalThis.sheetDisconnected=true;};export const refreshSheets=async()=>{};',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/settings/SettingsGoogleSheets.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {SettingsGoogleSheets}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
test('reopening a saved connection and reloading headers preserves custom labels and refresh schedules',async()=>{
 const oldWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
 let index=0;const cells=[],effects=[];
 const fields=[{id:'order',label:'My order status',column:{heading:'Order'},schedule:{kind:'daily',time:'14:30'}}];
 globalThis.sheetSettingsState={ready:true,configured:true,email:'test@example.com',config:{spreadsheet:'abc',tab:'Customers',headerRow:2,phone:{heading:'Phone'},fields},data:{},error:'',busy:false};
 globalThis.sheetSettingsHooks={state(value){const n=index++;cells[n]??={value};return[cells[n].value,next=>cells[n].value=typeof next==='function'?next(cells[n].value):next];},effect(fn,deps){const n=index++;if(!cells[n]||!deps.every((v,i)=>Object.is(v,cells[n].deps[i]))){cells[n]={deps};effects.push(fn);}}};
 const onCloseGuardChange=guard=>globalThis.sheetCloseGuard=guard;
 const render=()=>{index=0;return nodes(SettingsGoogleSheets({onCloseGuardChange}));};
 try{
  render();effects.splice(0).forEach(fn=>fn());
  let tree=render();
  assert.ok(tree.some(node=>node.type==='input'&&node.props.value==='https://docs.google.com/spreadsheets/d/abc/edit'));
  const columns=tree.find(node=>node.type==='button'&&node.props.children==='sheets.columns');
  columns.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  tree=render();
  assert.ok(tree.some(node=>node.props.value==='My order status'));
  assert.ok(tree.some(node=>node.props.type==='time'&&node.props.value==='14:30'));
  const save=tree.find(node=>node.type==='button'&&node.props.children==='sheets.save');
  assert.equal(save.props.disabled,false);save.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(globalThis.sheetSaved.fields,fields);
  assert.equal(globalThis.sheetSaved.headerRow,2);
  const disconnect=tree.find(node=>node.type==='button'&&node.props.children==='sheets.disconnect');
  disconnect.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(globalThis.sheetDisconnectPrompt.tone,'danger');
  assert.equal(globalThis.sheetDisconnectPrompt.description,'sheets.disconnectDescription');
  assert.equal(globalThis.sheetDisconnected,undefined);
  globalThis.sheetDisconnectApproved=true;
  disconnect.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(globalThis.sheetDisconnected,true);
  tree.find(node=>node.props.type==='time').props.onChange({target:{value:'15:45'}});
  render();effects.splice(0).forEach(fn=>fn());
  assert.equal(globalThis.sheetCloseGuard.dirty,true);
  assert.equal(globalThis.sheetCloseGuard.canSave,true);
  assert.equal(await globalThis.sheetCloseGuard.save(),true);
  assert.equal(globalThis.sheetSaved.fields[0].schedule.time,'15:45');
  globalThis.sheetSettingsState={...globalThis.sheetSettingsState,email:null,config:null};
  render();effects.splice(0).forEach(fn=>fn());
  globalThis.sheetSettingsState={...globalThis.sheetSettingsState,email:'new@example.com'};
  assert.ok(render().some(node=>node.type==='input'&&node.props.placeholder?.includes('spreadsheets')&&node.props.value===''));
 }finally{globalThis.window=oldWindow;for(const key of ['sheetSettingsHooks','sheetSettingsState','sheetSaved','sheetCloseGuard','sheetDisconnectPrompt','sheetDisconnectApproved','sheetDisconnected'])delete globalThis[key];}
});
