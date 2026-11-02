import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/ui/useDetailsMenu.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'details-hook',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const useRef=()=>globalThis.detailsRef;export const useEffect=fn=>{globalThis.detailsEffect=fn;};'}));}}]});
const {useDetailsMenu}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('details menus dismiss outside, on focus loss, window blur, Escape and context change, but preserve inside interaction',()=>{
  const names=['Node','document','window'],original=names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  class Element extends EventTarget {children=[];contains(node){return this===node||this.children.includes(node);}}
  let focused=0;const menu=new Element(),inside=new Element(),summary=new Element(),outside=new Element();
  menu.children=[inside,summary];summary.focus=()=>focused++;menu.querySelector=()=>summary;menu.open=true;
  // This flat registry needs no capture phase; Node's boolean-capture removal differs from the DOM.
  class Document extends EventTarget {
    addEventListener(type,listener){super.addEventListener(type,listener);}
    removeEventListener(type,listener){super.removeEventListener(type,listener);}
  }
  const document=new Document(),window=new EventTarget();let cleanup;
  const fire=(type,target=outside,key)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:target});if(key)Object.defineProperty(event,'key',{value:key});document.dispatchEvent(event);return event;};
  try {
    for(const [key,value] of Object.entries({Node:Element,document,window}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    globalThis.detailsRef={current:menu};useDetailsMenu('chat-a');cleanup=globalThis.detailsEffect();assert.equal(menu.open,false);
    for(const type of ['pointerdown','focusin']){
      menu.open=true;fire(type,inside);assert.equal(menu.open,true,'moving between menu controls must keep it open');
      fire(type);assert.equal(menu.open,false);
    }
    menu.open=true;window.dispatchEvent(new Event('blur'));assert.equal(menu.open,false);
    menu.open=true;assert.equal(fire('keydown',inside,'a').defaultPrevented,false);assert.equal(menu.open,true);
    const escape=fire('keydown',inside,'Escape');assert.equal(menu.open,false);assert.equal(escape.defaultPrevented,true);assert.equal(focused,1);
    assert.equal(fire('keydown',outside,'Escape').defaultPrevented,false,'closed menus must not swallow other Escape handlers');
    cleanup();menu.open=true;fire('pointerdown');fire('focusin');window.dispatchEvent(new Event('blur'));assert.equal(menu.open,true,'unmount removes document and window listeners');
    useDetailsMenu('chat-b');cleanup=globalThis.detailsEffect();assert.equal(menu.open,false,'chat/account changes close an old menu');
    menu.open=true;cleanup();assert.equal(menu.open,false);
  } finally {
    cleanup?.();delete globalThis.detailsRef;delete globalThis.detailsEffect;
    for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
