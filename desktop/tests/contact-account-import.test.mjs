import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
 react:'export const useState=i=>globalThis.importHooks.state(i);export const useRef=i=>globalThis.importHooks.ref(i);export const useEffect=(fn,deps)=>globalThis.importHooks.effect(fn,deps);export const useMemo=f=>f();',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':'export const UsersRound="users",X="close";',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.importState);',
 '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});',
 '@/components/ui/primitives':'export const Button="button",Input="input";',
 '@/lib/bridge':'export const savePhoneContacts=async()=>({saved:0,exists:0,failed:0});',
 '@/lib/baileys':'export const baileysSaveContacts=async(account,rows)=>{globalThis.importCalls.push(["remote",account,rows]);return {saved:rows.length,failed:0};};',
};
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({entryPoints:[root+'src/components/settings/BatchSaveContactsModal.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'import-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {BatchSaveContactsModal}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'?t:'';

test('pasted contacts retain edits during status refresh and are saved into the explicitly selected account',async()=>{
 const originalWindow=globalThis.window;globalThis.window=new EventTarget();
 const cells=[],effects=[];let cursor=0;globalThis.importCalls=[];
 globalThis.importHooks={
  state(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return [cells[i],value=>cells[i]=typeof value==='function'?value(cells[i]):value];},
  ref(initial){return cells[cursor++]??={current:initial};},
  effect(fn,deps){const i=cursor++,old=cells[i];if(old&&deps.every((value,index)=>Object.is(value,old.deps[index])))return;cells[i]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});},
 };
 globalThis.importState={contacts:[{id:'original',accountId:'a',name:'Same person',phone:'+12025550101'}],settings:{liveBaileysAccountId:'a'},phones:[],selectedPhoneId:null,bridge:{connected:false},importContacts:rows=>{importCalls.push(['local',rows]);return rows.length;},pushToast:()=>{}};
 const props={open:true,onClose:()=>{},accounts:[{id:'a',label:'A'},{id:'b',label:'B'}],accountId:'b',connectedAccountIds:['a','b'],cloudAvailable:true};
 const render=()=>{let tree;for(let i=0;i<2;i++){cursor=0;tree=BatchSaveContactsModal(props);while(effects.length)effects.shift()();}return nodes(tree);};
 try{
  render().find(node=>node.type==='textarea').props.onPaste({preventDefault(){},clipboardData:{getData:()=> 'Name\tPhone\nExample\t+12025550101'}});
  let tree=render();tree.find(node=>node.type==='input'&&node.props.value==='Example').props.onChange({target:{value:'Edited'}});
  props.accounts=props.accounts.map(account=>({...account,status:'connected'}));props.connectedAccountIds=['b','a'];
  tree=render();assert.ok(tree.some(node=>node.type==='input'&&node.props.value==='Edited'),'background account refresh cannot wipe pasted rows');
  assert.equal(tree.find(node=>node.type==='select').props.value,'b');
  await tree.find(node=>node.type==='button'&&text(node).startsWith('batchContacts.save{')).props.onClick();
  const local=importCalls.find(call=>call[0]==='local')[1];assert.equal(local.length,1);assert.equal(local[0].accountId,'b');assert.match(local[0].name,/Edited$/);
  assert.equal(importCalls.find(call=>call[0]==='remote')[1],'b');assert.equal(importState.contacts[0].accountId,'a');
 }finally{for(const cell of cells)cell?.cleanup?.();globalThis.window=originalWindow;}
});
