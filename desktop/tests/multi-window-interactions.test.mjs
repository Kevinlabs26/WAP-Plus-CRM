import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks = {
 react: 'export const useRef=v=>globalThis.hooks.ref(v); export const useState=v=>globalThis.hooks.state(v); export const useEffect=(f,d)=>globalThis.hooks.effect(f,d); export const useLayoutEffect=useEffect;',
 'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";',
 'lucide-react': 'export const Mic=()=>null; export const Pencil=()=>null,Reply=()=>null,Send=()=>null,X=()=>null,Zap=()=>null;',
 '@/components/chat/VoiceRecordingControls': 'export const VoiceRecordingControls="voice-controls";',
 '@/components/chat/MediaSendPreview': 'export const MediaSendPreview="media-preview";',
 '@/components/chat/TranslateBar': 'export const TranslateBar="translate-bar";',
 '@/i18n': 'export const useI18n=()=>({t:k=>k});',
 '@/components/ui/primitives': 'export const Textarea="textarea";',
 '@/features/multiWindow/components/MultiWindowAttachmentButton': 'export const MultiWindowAttachmentButton=()=>null;',
};
const result=await build({stdin:{contents:`export {useMultiWindowScroll} from './src/features/multiWindow/hooks/useMultiWindowScroll.ts'; export {MultiWindowComposer} from './src/features/multiWindow/components/MultiWindowComposer.tsx'; export {emitQuickReplyMedia} from './src/lib/quickReplyMedia.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {useMultiWindowScroll,MultiWindowComposer,emitQuickReplyMedia}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const originalBrowser = { requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, ResizeObserver: globalThis.ResizeObserver };
beforeEach(() => {
 globalThis.requestAnimationFrame = () => 1;
 globalThis.cancelAnimationFrame = () => {};
 globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
afterEach(() => Object.assign(globalThis, originalBrowser));
function fixture(){
 const cells=[],effects=[];let i=0;
 const hooks={
  ref(v){return cells[i++]??={current:v};},
  state(v){const n=i++;cells[n]??={value:v};return[cells[n].value,v=>cells[n].value=v];},
  effect(f,deps){const n=i++,old=cells[n];if(old&&deps.every((v,j)=>Object.is(v,old.deps[j])))return;cells[n]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[n].cleanup?.();cells[n].cleanup=f();});},
 };
 return{render(fn){i=0;globalThis.hooks=hooks;return fn();},flush(){while(effects.length)effects.shift()();},close(){cells.forEach(cell=>cell?.cleanup?.());delete globalThis.hooks;}};
}
test('scroll follows new messages, preserves history reading, and can return to latest',()=>{
 const ui=fixture(),node={scrollHeight:800,clientHeight:200,scrollTop:0};let messages=[{id:'b'}];
 const render=()=>{const hook=ui.render(()=>useMultiWindowScroll(messages,false));hook.scrollRef.current=node;ui.flush();return hook;};
 try{let hook=render();assert.equal(node.scrollTop,800);node.scrollTop=100;hook.onScroll();messages=[{id:'b'},{id:'c'}];node.scrollHeight=900;hook=render();assert.equal(node.scrollTop,100);assert.equal(hook.awayFromBottom,true);
 messages=[{id:'a'},...messages];node.scrollHeight=1100;hook=render();assert.equal(node.scrollTop,300);hook.scrollToLatest();assert.equal(node.scrollTop,1100);messages=[...messages,{id:'d'}];node.scrollHeight=1200;render();assert.equal(node.scrollTop,1200);
 }finally{ui.close();}
});
test('media quick replies reach only their selected chat and carry the caption',()=>{
 const fixtures=[],sent=[];
 try{for(const [chatId,disabled] of [['a',false],['b',false],['blocked',true]]){const ui=fixture();fixtures.push(ui);ui.render(()=>MultiWindowComposer({chatId,value:'',onChange(){},onSend(){},onAttach:(file,caption)=>sent.push([chatId,file.name,caption]),ariaLabel:chatId,disabled}));ui.flush();}
 for(const chatId of ['b','blocked',undefined])emitQuickReplyMedia({chatId,target:'multi',dataUrl:'data:text/plain;base64,aGk=',fileName:'hi.txt',mimeType:'text/plain',kind:'file',token:'one',caption:'hello'});
 assert.deepEqual(sent,[['b','hi.txt','hello']]);
 }finally{fixtures.forEach(ui=>ui.close());}
});

test('initial asynchronous history and later layout changes stay at the newest message',()=>{
 const ui=fixture(),resizes=[],frames=[];let disconnected=0,cancelled=0,top=0;
 globalThis.requestAnimationFrame=f=>{frames.push(f);return 1;};
 globalThis.cancelAnimationFrame=()=>cancelled++;
 globalThis.ResizeObserver=class{constructor(f){resizes.push(f);}observe(){}disconnect(){disconnected++;}};
 const node={scrollHeight:100,clientHeight:200,firstElementChild:{},get scrollTop(){return top;},set scrollTop(value){top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));}};
 let messages=[{id:'latest'}];
 const render=()=>{const hook=ui.render(()=>useMultiWindowScroll(messages,false));hook.scrollRef.current=node;ui.flush();return hook;};
 try{let hook=render();assert.equal(top,0);
  // Grid height settles after the first render; no message update is needed.
  node.scrollHeight=900;frames[0]();assert.equal(top,700);
  messages=[{id:'older'},...messages];node.scrollHeight=1100;hook=render();assert.equal(top,900);
  node.scrollHeight=1300;resizes[0]();assert.equal(top,1100);
  node.clientHeight=150;resizes[0]();assert.equal(top,1150);
  node.scrollTop=200;hook.onScroll();node.scrollHeight=1500;resizes[0]();assert.equal(top,200);
 }finally{ui.close();}
 assert.equal(disconnected,1);assert.equal(cancelled,1);
});

test('empty composers start voice recording and text composers expose translation without sending',()=>{
 const ui=fixture(),calls=[];
 const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
 const base={chatId:'a',onChange(){},onSend:()=>calls.push('send'),onBeginVoice:()=>calls.push('record'),ariaLabel:'draft'};
 try{let tree=ui.render(()=>MultiWindowComposer({...base,value:''}));ui.flush();
 const mic=nodes(tree).find(n=>n.props['aria-label']==='tooltip.startRecording');assert.equal(mic.props.type,'button');mic.props.onClick();assert.deepEqual(calls,['record']);
 tree=ui.render(()=>MultiWindowComposer({...base,value:'hello',translation:{visible:true,onTranslate:()=>calls.push('translate')}}));ui.flush();assert.ok(nodes(tree).find(n=>n.type==='translate-bar'));
 nodes(tree).find(n=>n.type==='textarea').props.onKeyDown({ctrlKey:true,shiftKey:true,key:'t',preventDefault(){}});assert.deepEqual(calls,['record','translate']);
 tree=ui.render(()=>MultiWindowComposer({...base,value:'',voice:{seconds:1,paused:false,sending:false,readLevel:()=>0,onDelete(){},onTogglePause(){},onSend(){}}}));ui.flush();assert.ok(nodes(tree).find(n=>n.type==='voice-controls'));assert.equal(nodes(tree).some(n=>n.type==='textarea'),false);
 }finally{ui.close();}
});


test('staged attachments require confirmation and Enter sends media rather than a text message',()=>{
 const ui=fixture(),calls=[];const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
 const media={items:[{id:'file'}],sendingIndex:-1,onRemove(){},onClose:()=>calls.push('close'),onSend:()=>calls.push('media')};
 const opts={chatId:'a',value:'',onChange(){},onSend:()=>calls.push('text'),onBeginVoice:()=>calls.push('record'),ariaLabel:'draft',media};
 try{const tree=ui.render(()=>MultiWindowComposer(opts));ui.flush();assert.ok(nodes(tree).some(n=>n.type==='media-preview'));const send=nodes(tree).find(n=>n.props['aria-label']==='multi.send');assert.equal(send.props.disabled,false);assert.equal(send.props.type,'submit');assert.deepEqual(calls,[]);
 const input=nodes(tree).find(n=>n.type==='textarea');input.props.onKeyDown({key:'Enter',nativeEvent:{},preventDefault(){}});assert.deepEqual(calls,['media']);input.props.onKeyDown({key:'Escape',preventDefault(){}});assert.deepEqual(calls,['media','close']);
 media.sendingIndex=0;const busy=ui.render(()=>MultiWindowComposer(opts));ui.flush();nodes(busy).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.deepEqual(calls,['media','close']);
 }finally{ui.close();}
});
