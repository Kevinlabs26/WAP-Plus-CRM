import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {translate} from '../src/i18n/core.ts';
const mocks={
 'react':`export const useState=v=>globalThis.updateHooks.state(v);export const useRef=v=>globalThis.updateHooks.ref(v);export const useEffect=(f,d)=>globalThis.updateHooks.effect(f,d);`,
 'react/jsx-runtime':`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`,
 'lucide-react':`export const ArrowRight=()=>null,Check=()=>null,ChevronDown=()=>null,Coffee=()=>null,ExternalLink=()=>null,X=()=>null;`,
 '@/components/brand/WapPlusMark':`export const WapPlusMark=()=>null;`,
 '@/lib/bridge':`export const isTauri=()=>true;export const getAppInfo=async()=>({version:'0.1.44'});`,
 '@/lib/appUpdate':`export const PENDING_UPDATE_STORAGE_KEY='pending-update';`,
 '@/i18n':`export const useI18n=()=>({t:(k,p)=>globalThis.updateTranslate(k,p)});`,
};
const result=await build({entryPoints:[fileURLToPath(new URL('../src/components/UpdateCompleteModal.tsx',import.meta.url))],bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'update-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {UpdateCompleteModal}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
function fixture(previous='0.1.43',pending) {
 const original={window:globalThis.window,document:globalThis.document},cells=[],effects=[],listeners=new Map(),storage=new Map([['wap-plus.last-running-version',previous]]);
 if(pending!==undefined)storage.set('pending-update',pending);
 let cursor=0,controls=[];
 const trigger={isConnected:true,focus(){document.activeElement=this;}};
 globalThis.document={activeElement:trigger};
 globalThis.window={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 globalThis.updateTranslate=(k,p)=>translate('zh-CN',k,p);
 globalThis.updateHooks={state(v){const i=cursor++;cells[i]??={value:v};return[cells[i].value,v=>cells[i].value=typeof v==='function'?v(cells[i].value):v];},ref(v){return cells[cursor++]??={current:v};},effect(fn,deps){const i=cursor++,old=cells[i];if(old&&deps.every((v,j)=>Object.is(v,old.deps[j])))return;cells[i]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}};
 return{listeners,storage,trigger,
  render(ready=true){cursor=0;const tree=UpdateCompleteModal({ready});controls=nodes(tree).filter(n=>n.type==='button'||n.type==='a');for(const n of controls){n.element={focus(){document.activeElement=this;}};if(n.props.ref)n.props.ref.current=n.element;}const dialog=nodes(tree).find(n=>n.props.ref&&n.type==='div');if(dialog)dialog.props.ref.current={querySelectorAll:()=>controls.map(n=>n.element),contains:el=>controls.some(n=>n.element===el)};while(effects.length)effects.shift()();return tree;},
  async open(ready=true){this.render(ready);await Promise.resolve();await Promise.resolve();return this.render(ready);},
  close(){for(const c of cells)c?.cleanup?.();Object.assign(globalThis,original);delete globalThis.updateHooks;delete globalThis.updateTranslate;},
 };
}
const text=t=>Array.isArray(t)?t.map(text).join(''):typeof t==='string'?t:t?.props?text(t.props.children):'';
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n).startsWith(label));
test('upgrade waits for ready, presents compact actions, and restores focus after starting',async()=>{
 const ui=fixture();try{assert.equal(await ui.open(false),null);assert.equal(ui.listeners.size,0);let tree=ui.render();assert.equal(tree.props.role,'dialog');assert.equal(ui.storage.get('wap-plus.last-running-version'),'0.1.44');assert.equal(nodes(tree).some(n=>n.type==='a'||n.type==='img'),false);assert.equal(button(tree,'请作者喝杯咖啡').props['aria-expanded'],false);button(tree,'开始使用新版本').props.onClick();assert.equal(ui.render(),null);assert.equal(document.activeElement,ui.trigger);assert.equal(ui.listeners.size,0);}finally{ui.close();}
});
test('support expands on demand and every original platform retains its QR and external link',async()=>{
 const ui=fixture();try{let tree=await ui.open();button(tree,'请作者喝杯咖啡').props.onClick();tree=ui.render();for(const label of ['Ko-fi','Buy Me a Coffee','Lemon Squeezy']){button(tree,label).props.onClick();tree=ui.render();assert.equal(button(tree,label).props['aria-expanded'],true);const link=nodes(tree).find(n=>n.type==='a');assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');assert.match(nodes(tree).find(n=>n.type==='img').props.src,/api.qrserver.com/);assert.ok(nodes(tree).find(n=>n.type==='img').props.src.includes(encodeURIComponent(link.props.href)));}button(tree,'请作者喝杯咖啡').props.onClick();assert.equal(nodes(ui.render()).some(n=>n.type==='a'),false);}finally{ui.close();}
});
test('keyboard stays in the modal and Escape dismisses it',async()=>{
 const ui=fixture();try{const tree=await ui.open();let prevented=false;ui.listeners.get('keydown')({key:'Tab',preventDefault(){prevented=true;}});assert.equal(prevented,true);ui.listeners.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(ui.render(),null);assert.equal(document.activeElement,ui.trigger);assert.ok(tree);}finally{ui.close();}
});
test('normal restarts stay silent and pending upgrades still trigger once',async()=>{
 for(const [previous,pending,shown] of [['0.1.44',undefined,false],['0.1.44','{broken',false],['0.1.44','{"version":"0.1.44"}',true]]){const ui=fixture(previous,pending);try{assert.equal(Boolean(await ui.open()),shown);assert.equal(ui.storage.has('pending-update'),false);}finally{ui.close();}}
});
