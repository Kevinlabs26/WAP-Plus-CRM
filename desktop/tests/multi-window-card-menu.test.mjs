import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
 react:'export const useRef=v=>globalThis.cardMenuHooks.ref(v);export const useState=v=>globalThis.cardMenuHooks.state(v);export const useId=()=>"qa-window-menu";export const useEffect=(f,d)=>globalThis.cardMenuHooks.effect(f,d);export const useLayoutEffect=useEffect;',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'react-dom':'export const createPortal=children=>children;',
 'lucide-react':'export const MoreHorizontal="icon";',
 '@/i18n':'export const useI18n=()=>({t:k=>k});',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/features/multiWindow/components/MultiWindowCardMenu.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {MultiWindowCardMenu}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
function fixture(){
 const original={window:globalThis.window,document:globalThis.document,Node:globalThis.Node};
 const listeners=new Map(),cells=[],effects=[];let index=0,tree,items=[];
 globalThis.document={body:{},activeElement:null};
 class FakeNode{contains(node){return node===this||this.children?.includes(node);}focus(){globalThis.document.activeElement=this;}}
 globalThis.Node=FakeNode;
 const trigger=new FakeNode();trigger.getBoundingClientRect=()=>({right:1000,top:650,bottom:680});
 const menu=new FakeNode();menu.style={};menu.getBoundingClientRect=()=>({width:208,height:240});menu.querySelectorAll=()=>items.filter(item=>!item.disabled);
 globalThis.window={innerWidth:900,innerHeight:720,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 globalThis.cardMenuHooks={ref(v){return cells[index++]??={current:v};},state(v){const n=index++;cells[n]??={value:v};return[cells[n].value,v=>cells[n].value=v];},effect(f,deps){const n=index++,old=cells[n];if(!old||!deps.every((v,i)=>Object.is(v,old.deps[i]))){cells[n]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[n].cleanup?.();cells[n].cleanup=f();});}}};
 const calls=[];const actions=[{label:'Pin',onSelect:()=>calls.push('pin')},{label:'Refresh',disabled:true,onSelect:()=>calls.push('refresh')},{label:'Remove',destructive:true,onSelect:()=>calls.push('remove')}];
 const render=()=>{index=0;tree=MultiWindowCardMenu({title:'Customer',actions});const list=nodes(tree);list.find(n=>n.props['aria-haspopup']==='menu').props.ref.current=trigger;const popup=list.find(n=>n.props.role==='menu');if(popup){popup.props.ref.current=menu;items=list.filter(n=>n.props.role==='menuitem').map(n=>Object.assign(new FakeNode(),{disabled:n.props.disabled,label:n.props.children}));menu.children=items;}while(effects.length)effects.shift()();return list;};
 return{render,calls,trigger,menu,listeners,get tree(){return nodes(tree);},get focused(){return globalThis.document.activeElement;},get items(){return items;},key(key){this.tree.find(n=>n.props.role==='menu').props.onKeyDown({key,currentTarget:menu,preventDefault(){},stopPropagation(){}});},close(){cells.forEach(c=>c?.cleanup?.());Object.assign(globalThis,original);delete globalThis.cardMenuHooks;}};
}

test('card menu fits the viewport and keyboard navigation skips disabled actions',()=>{
 const ui=fixture();try{let tree=ui.render();assert.equal(tree.some(n=>n.props.role==='menu'),false);tree.find(n=>n.props['aria-haspopup']).props.onClick();ui.render();assert.equal(ui.menu.style.left,'684px');assert.equal(ui.menu.style.top,'406px');assert.equal(ui.focused.label,'Pin');ui.key('ArrowDown');assert.equal(ui.focused.label,'Remove');ui.key('ArrowDown');assert.equal(ui.focused.label,'Pin');ui.key('End');assert.equal(ui.focused.label,'Remove');ui.key('Home');assert.equal(ui.focused.label,'Pin');ui.key('Escape');tree=ui.render();assert.equal(tree.some(n=>n.props.role==='menu'),false);assert.equal(ui.focused,ui.trigger);assert.equal(ui.listeners.size,0);}finally{ui.close();}
});

test('choosing an action closes the menu and outside clicks preserve outside focus',()=>{
 const ui=fixture();try{ui.render().find(n=>n.props['aria-haspopup']).props.onClick();ui.render();ui.tree.find(n=>n.props.role==='menuitem'&&n.props.children==='Remove').props.onClick();ui.render();assert.deepEqual(ui.calls,['remove']);assert.equal(ui.tree.some(n=>n.props.role==='menu'),false);
 ui.tree.find(n=>n.props['aria-haspopup']).props.onKeyDown({key:'ArrowUp',preventDefault(){}});ui.render();assert.equal(ui.focused.label,'Remove');const outside=new globalThis.Node();outside.focus();ui.listeners.get('pointerdown')({target:outside});ui.render();assert.equal(ui.focused,outside);assert.equal(ui.tree.some(n=>n.props.role==='menu'),false);
 }finally{ui.close();}
});


test('switching focus to another chat closes the menu without taking focus back',()=>{
 const ui=fixture();try{ui.render().find(n=>n.props['aria-haspopup']).props.onClick();ui.render();const input=new globalThis.Node();input.focus();ui.listeners.get('focusin')({target:input});ui.render();assert.equal(ui.focused,input);assert.equal(ui.tree.some(n=>n.props.role==='menu'),false);assert.equal(ui.listeners.size,0);}finally{ui.close();}
});
