import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 react:'export const useState=initial=>globalThis.previewHooks.state(initial);export const useRef=initial=>globalThis.previewHooks.ref(initial);export const useMemo=fn=>fn();export const useEffect=()=>{};',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/store/appStore':'export const useAppStore={getState:()=>({settings:{}})};',
 '@/i18n':'export const useI18n=()=>({t:key=>key});',
 '@/components/ui/primitives':'export const Button="button";',
 '@/lib/aiSuggest':'export const hasRealAiKey=()=>true;',
 '@/lib/aiOutreachPreview':'export const buildOutreachPreview=(...args)=>globalThis.previewBuild(...args);',
};
const built=await build({entryPoints:[root+'src/components/settings/AiOutreachPreview.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'preview-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {AiOutreachPreview}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const slots=[];let cursor=0;
 globalThis.previewHooks={state(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value];},ref(initial){const i=cursor++;return slots[i]??=( {current:initial} );}};
 const props={settings:{uiLanguage:'en',aiTimeZone:'UTC',waAccounts:[]},folderIds:['f'],auto:false,onConfirm(){throw Error('unexpected enable');}};
 globalThis.previewBuild=async()=>({checkedAt:Date.now(),rows:[],eligible:0,readyNow:0,blocked:0,nextAt:null});
 return {props,render(){cursor=0;return nodes(AiOutreachPreview(props));},check(tree){return tree.find(n=>n.type==='button'&&n.props.children!=='outreachPreview.enable');},confirm(tree){return tree.find(n=>n.type==='button'&&n.props.children==='outreachPreview.enable');}};
}

test('enable stays disabled until a current preview completes and is invalidated by rule changes',async()=>{
 const h=fixture();assert.equal(h.confirm(h.render()).props.disabled,true);
 h.check(h.render()).props.onClick();assert.equal(h.confirm(h.render()).props.disabled,true);await settle();assert.equal(h.confirm(h.render()).props.disabled,false);
 h.props.settings={...h.props.settings,aiOutreachPaused:true};assert.equal(h.confirm(h.render()).props.disabled,true);
});

test('failed refresh cannot enable using an earlier successful preview',async()=>{
 const h=fixture();h.check(h.render()).props.onClick();await settle();assert.equal(h.confirm(h.render()).props.disabled,false);
 globalThis.previewBuild=async()=>{throw Error('check failed');};h.check(h.render()).props.onClick();await settle();
 assert.equal(h.confirm(h.render()).props.disabled,true);assert.ok(h.render().some(n=>n.props.role==='alert'&&n.props.children==='check failed'));
});
