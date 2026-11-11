import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 react:'export const memo=f=>f,useMemo=(f,d)=>globalThis.callLinkTest.memo(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
 '@/store/appStore':'export const useAppStore={getState:()=>globalThis.callLinkTest.state};',
 '@/lib/bridge':'export const isTauri=()=>globalThis.callLinkTest.native;',
 '@tauri-apps/api/core':'export const invoke=(...a)=>globalThis.callLinkTest.invoke(...a);',
 '@tauri-apps/plugin-shell':'export const open=(...a)=>globalThis.callLinkTest.browser(...a);',
};
const result=await build({stdin:{contents:"export {MessageBody} from './src/components/chat/MessageBody.tsx';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {MessageBody}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const click=a=>a.props.onClick({stopPropagation(){},preventDefault(){}});
let sequence=0;
function harness(){
 const accounts=[{id:'one',phoneE164:'+12025550101'},{id:'two',phoneE164:'+12025550102'}];
 const setup={apps:[{appId:'client-one'},{appId:'client-two'}],bindings:{'+12025550101':'client-one','+12025550102':'client-two'},verified:{'+12025550101':'client-one','+12025550102':'client-two'}};
 const calls=[],browsers=[],windows=[],toasts=[];let memo;
 const h={native:true,state:{chats:[{id:'c1',accountId:'one'},{id:'c2',accountId:'two'}],settings:{waAccounts:accounts},pushToast:(...a)=>toasts.push(a)},memo(f,d){if(!memo||d.some((v,i)=>v!==memo.deps[i]))memo={deps:d,value:f()};return memo.value;},invoke:async(...a)=>{calls.push(a);return a[0]==='clone_call_setup'?setup:undefined;},browser:async(...a)=>{browsers.push(a);},calls,browsers,windows,toasts,setup};
 globalThis.callLinkTest=h;globalThis.window={open:(...a)=>windows.push(a)};
 const url='https://call.whatsapp.com/voice/test_'+(++sequence);
 h.render=(props={})=>nodes(MessageBody({text:url,accountId:'one',chatId:'c1',...props})).find(n=>n.type==='a');
 return h;
}
test('one click burst opens only the bound client and never a browser',async()=>{
 const h=harness();let release;h.invoke=(...a)=>{h.calls.push(a);return a[0]==='clone_call_setup'?new Promise(r=>release=()=>r(h.setup)):Promise.resolve();};
 const a=h.render();click(a);click(a);await settle();assert.equal(h.calls.length,1);release();await settle();
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1][1],{ownerPhone:'+12025550101',appId:'client-one',url:a.props.href});assert.equal(h.browsers.length,0);assert.equal(h.windows.length,0);
});
test('unavailable or failed clients fall back to exactly one browser launch',async()=>{
 for(const failure of ['missing','activation']){const h=harness();if(failure==='missing')h.setup.apps=[];else h.invoke=async(cmd,...args)=>{h.calls.push([cmd,...args]);if(cmd==='clone_call_setup')return h.setup;throw Error('client unavailable');};
 const a=h.render();click(a);click(a);await settle();assert.equal(h.browsers.length,1);assert.equal(h.windows.length,0);}
});
test('a native browser launch error does not trigger a second browser via window.open',async()=>{
 const h=harness();h.setup.apps=[];h.browser=async(...a)=>{h.browsers.push(a);throw Error('shell failed');};click(h.render());await settle();assert.equal(h.browsers.length,1);assert.equal(h.windows.length,0);assert.equal(h.toasts.length,1);
});
test('browser preview opens one tab without attempting native activation',async()=>{
 const h=harness();h.native=false;const a=h.render();click(a);click(a);await settle();assert.equal(h.calls.length,0);assert.equal(h.browsers.length,0);assert.equal(h.windows.length,1);
});
test('identical message text follows updated account and conversation props',async()=>{
 for(const props of [{accountId:'two',chatId:'c1'},{accountId:undefined,chatId:'c2'}]){const h=harness();h.render();click(h.render(props));await settle();assert.equal(h.calls[1][1].ownerPhone,'+12025550102');assert.equal(h.browsers.length,0);}
});
