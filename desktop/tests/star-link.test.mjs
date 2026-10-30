import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
 react:'export const useEffect=()=>{};export const useMemo=f=>f();export const useRef=v=>({current:v});export const useState=v=>[v,()=>{}];',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'lucide-react':'export const ChevronDown="icon",Coffee="icon",Star="icon",Settings="icon",Search="icon";',
 '@/store/appStore':'export const useAppStore=Object.assign(selector=>selector({followUps:[],stats:{},settings:{waAccounts:[]}}),{getState:()=>({pushToast:()=>globalThis.starTest.errors++})});',
 '@/lib/utils':'export const cn=(...v)=>v.join(" ");',
 '@/lib/bridge':'export const isTauri=()=>globalThis.starTest.native;',
 '@tauri-apps/plugin-shell':'export const open=()=>globalThis.starTest.open();',
 '@/components/ui/primitives':'export const Button="button";',
 '@/components/DonateModal':'export const DonateModal="modal";',
 '@/components/brand/WapPlusMark':'export const WapPlusMark="mark";',
 './AccountSwitcherMenu':'export const AccountSwitcherMenu="switcher";',
 './MessageInbox':'export const MessageInbox="inbox";',
 '@/lib/accountHealth':'export const computeAllAccountsHealth=()=>[];',
 '@/lib/syncDebug':'export const syncLog=()=>{};',
 '@/i18n':'export const useI18n=()=>({t:k=>k});',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/layout/TopBar.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {TopBar}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
test('Star uses one opener, ignores duplicate clicks, and never retries with a second opener on failure',async()=>{
 const oldWindow=globalThis.window;
 try {
  let nativeCalls=0,browserCalls=0,finish;
  globalThis.window={open:()=>browserCalls++};
  globalThis.starTest={native:true,errors:0,open:()=>{nativeCalls++;return new Promise(resolve=>finish=resolve);}};
  const button=nodes(TopBar()).find(node=>node.props['aria-label']==='nav.supportTitle');
  assert.equal(button.type,'button');assert.equal(button.props.href,undefined);
  const pending=button.props.onClick({detail:1});
  await button.props.onClick({detail:1});
  finish();await pending;
  await button.props.onClick({detail:2});
  assert.equal(nativeCalls,1);assert.equal(browserCalls,0);
  globalThis.starTest.open=async()=>{nativeCalls++;throw new Error('failed after launch');};
  await button.props.onClick({detail:1});
  assert.equal(nativeCalls,2);assert.equal(browserCalls,0);assert.equal(globalThis.starTest.errors,1);
  globalThis.starTest.native=false;
  await button.props.onClick({detail:1});assert.equal(browserCalls,1);assert.equal(nativeCalls,2);
 }finally{globalThis.window=oldWindow;delete globalThis.starTest;}
});
