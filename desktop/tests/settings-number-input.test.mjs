import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={react:'export const useState=v=>globalThis.numberHooks.state(v);export const useEffect=(f,d)=>globalThis.numberHooks.effect(f,d);','react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";','@/components/ui/primitives':'export const Input="input";','@/i18n':'export const useI18n=()=>({t:k=>k});'};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/settings/SettingsNumberInput.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {SettingsNumberInput}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
test('numeric drafts are committed on blur; blank, invalid and out-of-range values preserve the saved value',()=>{
 const cells=[],effects=[],commits=[];let index=0;
 globalThis.numberHooks={state(value){const n=index++;cells[n]??={value};return[cells[n].value,next=>cells[n].value=next];},effect(fn,deps){const n=index++;if(!cells[n]||!deps.every((v,i)=>Object.is(v,cells[n].deps[i]))){cells[n]={deps};effects.push(fn);}}};
 let props={value:8,min:1,max:100,integer:true,onCommit:value=>commits.push(value)};
 const render=()=>{index=0;return nodes(SettingsNumberInput(props));};
 const input=()=>render().find(node=>node.type==='input');
 try {
  render();effects.splice(0).forEach(fn=>fn());
  input().props.onChange({target:{value:''}});assert.equal(input().props.value,'');assert.deepEqual(commits,[]);
  input().props.onChange({target:{value:'12'}});assert.deepEqual(commits,[]);input().props.onBlur();assert.deepEqual(commits,[12]);
  for(const value of ['', '-1', '101', '1.5', 'Infinity']){input().props.onChange({target:{value}});input().props.onBlur();assert.equal(input().props.value,'8');assert.equal(commits.length,1);assert.ok(render().some(node=>node.props.role==='alert'));}
  input().props.onChange({target:{value:'40'}});let stopped=false;input().props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){stopped=true;}});assert.equal(input().props.value,'8');assert.equal(stopped,true);assert.equal(commits.length,1);
  props={...props,value:3.5,min:0,integer:false};render();effects.splice(0).forEach(fn=>fn());
  input().props.onChange({target:{value:'0.5'}});input().props.onBlur();assert.equal(commits.at(-1),0.5);
 }finally{delete globalThis.numberHooks;}
});
