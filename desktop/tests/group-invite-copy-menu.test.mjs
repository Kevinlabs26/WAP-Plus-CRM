import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {translate} from '../src/i18n/core.ts';
const mocks={
 react:'export const useState=v=>globalThis.inviteHooks.state(v);export const useRef=v=>globalThis.inviteHooks.ref(v);export const useEffect=(f,d)=>globalThis.inviteHooks.effect(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 'lucide-react':'export const Ban="icon",BellOff="icon",BellRing="icon",CalendarPlus="icon",Clock3="icon",ChevronRight="icon",Download="icon",Images="icon",Link2="icon",Loader2="icon",Mail="icon",MoreVertical="icon",Pin="icon",PinOff="icon",Search="icon",StickyNote="icon",UserRound="icon",UserPlus="icon",Users="icon";',
 '@/components/ui/primitives':'export const Button="button";',
 '@/i18n':'export const useI18n=()=>({t:(k,p)=>globalThis.inviteTranslate(k,p)});',
 '@/lib/baileysGroups':'export const baileysGroupInviteCode=(...args)=>globalThis.inviteRequest(...args);',
 '@/store/appStore':'export const useAppStore={getState:()=>({pushToast:(...args)=>globalThis.inviteToasts.push(args)})};',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/chat/ChatHeaderMoreMenu.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'invite-copy',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ChatHeaderMoreMenu}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'?t:'';
const button=tree=>tree.find(n=>n.props.role==='menuitem'&&['复制群组链接','正在获取链接…'].includes(text(n)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const url='https://chat.whatsapp.com/TestInviteCode0123456789';
function fixture(){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator'),cells=[],effects=[],copied=[],requests=[],toasts=[];let cursor=0,closed=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async v=>copied.push(v)}}});
 globalThis.inviteHooks={state(v){const n=cursor++;cells[n]??={value:v};return[cells[n].value,v=>cells[n].value=v];},ref(v){return cells[cursor++]??={current:v};},effect(fn,deps){const n=cursor++,old=cells[n];if(old?.deps.every((v,i)=>Object.is(v,deps[i])))return;cells[n]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[n].cleanup?.();cells[n].cleanup=fn();});}};
 globalThis.inviteTranslate=(k,p)=>translate('zh-CN',k,p);globalThis.inviteToasts=toasts;globalThis.inviteRequest=async(...args)=>{requests.push(args);return {ok:true,inviteUrl:url};};
 const props={chat:{id:'chat-a',contactId:'contact-a',isGroup:true,accountId:'wa-a'},contact:{id:'contact-a',isGroup:true,channelAddress:'123456@g.us'},localOnlyChat:false,isBaileys:true,chatConnected:true,chatAccountId:'wa-a',settings:{},open:true,exporting:false,menuRef:{current:null},onClose:()=>closed++};
 return {props,copied,requests,toasts,get closed(){return closed;},render(){cursor=0;const tree=ChatHeaderMoreMenu(props);while(effects.length)effects.shift()();return nodes(tree);},close(){cells.forEach(c=>c?.cleanup?.());if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;delete globalThis.inviteHooks;delete globalThis.inviteTranslate;delete globalThis.inviteRequest;delete globalThis.inviteToasts;}};
}

test('group menu gets and copies the correct account invite once, without resetting the link',async()=>{
 const ui=fixture();try{
  let finish;globalThis.inviteRequest=(...args)=>{ui.requests.push(args);return new Promise(resolve=>finish=resolve);};
  const original=button(ui.render());assert.equal(original.props.disabled,false);original.props.onClick();original.props.onClick();assert.equal(ui.requests.length,1);
  assert.equal(button(ui.render()).props['aria-busy'],true);finish({ok:true,inviteUrl:url});await tick();
  assert.deepEqual(ui.requests,[['123456@g.us','wa-a']]);assert.deepEqual(ui.copied,[url]);assert.deepEqual(ui.toasts,[['已复制群组链接','success']]);assert.equal(ui.closed,1);
 }finally{ui.close();}
});

test('group link action stays visible with an explanation when unavailable and never appears for private chats',()=>{
 const ui=fixture();try{
  ui.props.chatConnected=false;let action=button(ui.render());assert.equal(action.props.disabled,true);assert.match(action.props.title,/连接/);action.props.onClick();assert.equal(ui.requests.length,0);
  ui.props.chatConnected=true;ui.props.isBaileys=false;action=button(ui.render());assert.match(action.props.title,/电脑/);assert.equal(action.props.disabled,true);
  ui.props.isBaileys=true;ui.props.contact.channelAddress='12345@lid';action=button(ui.render());assert.equal(action.props.disabled,true);
  ui.props.contact.isGroup=false;ui.props.chat.isGroup=false;assert.equal(button(ui.render()),undefined);
 }finally{ui.close();}
});

test('permission and missing-link failures stay visible; clipboard failure offers a selectable URL',async()=>{
 const ui=fixture();try{
  globalThis.inviteRequest=async()=>{throw Object.assign(new Error('forbidden'),{status:403});};button(ui.render()).props.onClick();await tick();assert.match(text(ui.render()),/联系管理员/);assert.deepEqual(ui.copied,[]);
  globalThis.inviteRequest=async()=>({ok:true});button(ui.render()).props.onClick();await tick();assert.match(text(ui.render()),/未返回|没有返回/);assert.deepEqual(ui.copied,[]);
  globalThis.inviteRequest=async()=>({ok:true,inviteUrl:'https://example.invalid/unexpected'});button(ui.render()).props.onClick();await tick();assert.deepEqual(ui.copied,[]);assert.ok(ui.render().some(n=>n.props.role==='alert'));
  globalThis.inviteRequest=async()=>({ok:true,inviteUrl:url});navigator.clipboard.writeText=async()=>{throw new Error('clipboard denied');};button(ui.render()).props.onClick();await tick();
  const tree=ui.render(),input=tree.find(n=>n.type==='input');assert.equal(input.props.value,url);assert.equal(input.props.readOnly,true);assert.match(text(tree),/全选后复制/);assert.equal(ui.closed,0);
 }finally{ui.close();}
});

test('switching group or account discards an older invite response and encoded group identifiers resolve safely',async()=>{
 const ui=fixture();try{
  let finish;globalThis.inviteRequest=()=>new Promise(resolve=>finish=resolve);button(ui.render()).props.onClick();
  ui.props.chat={...ui.props.chat,id:'chat-b',contactId:'bridge-contact-wa-b%3A987654%40g.us'};ui.props.contact=undefined;ui.props.chatAccountId='wa-b';ui.render();finish({ok:true,inviteUrl:url});await tick();assert.deepEqual(ui.copied,[]);assert.equal(ui.closed,0);
  globalThis.inviteRequest=async(...args)=>{ui.requests.push(args);return {ok:true,inviteUrl:url};};button(ui.render()).props.onClick();await tick();assert.deepEqual(ui.requests,[['987654@g.us','wa-b']]);assert.deepEqual(ui.copied,[url]);
 }finally{ui.close();}
});
