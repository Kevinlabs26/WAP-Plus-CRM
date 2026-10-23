import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/core.ts";

const mocks = {
  react: "export const useMemo=fn=>fn();export const useState=v=>globalThis.inboxHooks.state(v);export const useRef=v=>globalThis.inboxHooks.ref(v);export const useEffect=(fn,deps)=>globalThis.inboxHooks.effect(fn,deps);",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;",
  "lucide-react": "export const Bell=()=>null;export const X=()=>null;",
  "@/store/appStore": "export const useAppStore=fn=>fn(globalThis.inboxState);useAppStore.getState=()=>globalThis.inboxState;useAppStore.setState=patch=>Object.assign(globalThis.inboxState,patch);",
  "@/i18n": "export const useI18n=()=>({locale:'zh-CN',t:(key,params)=>globalThis.inboxTranslate(key,params)});",
  "@/components/ui/Avatar": "export const Avatar=()=>null;",
  "@/lib/markChatRead": "export const markChatReadRemote=async(chat,contact)=>{globalThis.inboxReads.push([chat.id,contact?.id]);globalThis.inboxState.chats=globalThis.inboxState.chats.map(c=>c.id===chat.id?{...c,unread:0}:c);};",
  "./persist": "export const persist=()=>{globalThis.inboxSaves++;};export const scheduleStatsRecompute=()=>{};",
};
const built = await build({stdin:{contents:`export {MessageInbox} from './src/components/layout/MessageInbox.tsx';
  export * from './src/lib/messageInbox.ts';export {createUiSlice} from './src/store/uiSlice.ts';`, resolveDir:fileURLToPath(new URL("../",import.meta.url))},
  bundle:true,write:false,format:"esm",platform:"browser",jsx:"automatic",alias:{"@":fileURLToPath(new URL("../src",import.meta.url))},
  plugins:[{name:"inbox-boundaries",setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:"mock"}:undefined);b.onLoad({filter:/.*/,namespace:"mock"},a=>({contents:mocks[a.path]}));}}],
});
const {MessageInbox,buildMessageInbox,inboxRelativeTime,createUiSlice}=await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(""):tree?.props?text(tree.props.children):typeof tree==="string"||typeof tree==="number"?String(tree):"";
const chat=(id,patch={})=>({id,contactId:`c-${id}`,contactName:`Customer ${id}`,unread:2,lastMessage:`Message ${id}`,lastMessageDirection:"in",updatedAt:"2026-10-23T10:00:00Z",accountId:"wa-a",phoneId:"wa-a",...patch});
const message=(id,patch={})=>({id,chatId:"a",direction:"in",sentAt:"2026-10-23T10:00:00Z",body:id,...patch});

test("inbox aggregates unread threads across folders/accounts without duplicating each message",()=>{
  const chats=[chat("a"),chat("b",{accountId:"wa-b",archived:true,mutedUntil:Date.now()+60000,updatedAt:"2026-10-23T10:05:00Z"}),chat("read",{unread:0}),chat("saved",{localOnly:true})];
  const original=structuredClone(chats);
  const rows=buildMessageInbox(chats,{a:[message("old",{sentAt:"2026-10-23T09:00:00Z"}),message("new")]});
  assert.deepEqual(rows.map(r=>r.chat.id),["b","a"]);assert.equal(rows[1].body,"new");assert.equal(rows[1].chat.unread,2);assert.deepEqual(chats,original);
});

test("latest inbound ignores outgoing/system messages and stale history cannot override a newer preview",()=>{
  const rows=buildMessageInbox([chat("a",{lastMessageDirection:"out",lastMessage:"Our reply",updatedAt:"2026-10-23T11:00:00Z"})],{a:[
    message("latest",{sentAt:"2026-10-23T10:05:00Z"}),message("invalid",{sentAt:"bad"}),message("older"),
    message("system",{sentAt:"2026-10-23T10:08:00Z",systemKind:"group_join"}),message("system-media",{sentAt:"2026-10-23T10:09:00Z",mediaType:"system"}),
    message("outbound",{direction:"out",sentAt:"2026-10-23T11:00:00Z"}),
  ]});
  assert.equal(rows[0].body,"latest");assert.equal(rows[0].sentAt,"2026-10-23T10:05:00Z");
  const fresh=buildMessageInbox([chat("a",{lastMessage:"Preview newer",updatedAt:"2026-10-23T10:10:00Z"})],{a:[message("old")]});
  assert.equal(fresh[0].body,"Preview newer");assert.equal(fresh[0].message,undefined);
  const unknown=buildMessageInbox([chat("a",{lastMessageDirection:"out"})],{});
  assert.equal(unknown[0].body,"");assert.equal(unknown[0].sentAt,"");
});

test("relative times handle minutes/hours/days, clock skew and missing timestamps in all languages",()=>{
  const now=Date.parse("2026-10-23T10:00:00Z");
  assert.equal(inboxRelativeTime("2026-10-23T09:55:00Z",now,"zh-CN"),"5分钟前");
  assert.equal(inboxRelativeTime("2026-10-23T08:00:00Z",now,"en"),"2 hours ago");
  assert.match(inboxRelativeTime("2026-10-21T10:00:00Z",now,"fr"),/2 jours/);
  assert.equal(inboxRelativeTime("2026-10-23T10:01:00Z",now,"zh-CN"),"");
  assert.equal(inboxRelativeTime("bad",now,"zh-CN"),null);
  assert.equal(inboxRelativeTime("2026-10-23T09:59:30Z",now,"zh-CN"),"");
});

function fixture() {
  const cells=[],effects=[],listeners=new Map(),timers=new Set(),reads=[];
  let cursor=0,opened=0,focused=0;
  const oldWindow=globalThis.window;
  globalThis.window={setInterval(fn){timers.add(fn);return fn;},clearInterval(fn){timers.delete(fn);},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  globalThis.inboxHooks={state(initial){const i=cursor++;cells[i]??={value:typeof initial==="function"?initial():initial};return[cells[i].value,next=>{cells[i].value=typeof next==="function"?next(cells[i].value):next;}];},
    ref(initial){return cells[cursor++]??={current:initial};},effect(fn,deps){const i=cursor++,prev=cells[i];if(prev&&deps.every((d,j)=>Object.is(d,prev.deps[j])))return;cells[i]={deps,cleanup:prev?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}};
  globalThis.inboxTranslate=(key,params)=>translate("zh-CN",key,params);globalThis.inboxReads=reads;globalThis.inboxSaves=0;
  const chats=[chat("a"),chat("b",{accountId:"wa-b",phoneId:"wa-b",unread:3,updatedAt:"2026-10-23T10:05:00Z"})];
  globalThis.inboxState={chats,contacts:chats.map(c=>({id:c.contactId,name:c.contactName,phone:"+12025550100",accountId:c.accountId})),messagesByChatId:{a:[message("latest-a")]},
    selectedChatId:null,selectedPhoneId:null,selectedContactId:null,selectedThreadAccount:null,activeNav:"crm",chatListFilter:"awaiting",unreadHoldUntilByChatId:{b:123},
    settings:{activeAccountId:"wa-a",accountViewMode:{type:"account",accountId:"wa-a"},waAccounts:[{id:"wa-a",label:"Sales"},{id:"wa-b",label:"Support"}],chatFolders:[{id:"f",name:"报价组",collapsed:true,chatIds:["b"]}]}};
  const ctx={get:()=>inboxState,set:patch=>Object.assign(inboxState,typeof patch==="function"?patch(inboxState):patch)};
  Object.assign(inboxState,createUiSlice(ctx));
  return {reads,listeners,timers,get opened(){return opened;},get focused(){return focused;},
    render(){cursor=0;const tree=MessageInbox({onOpen:()=>opened++});for(const node of nodes(tree)){if(node.props.ref)node.props.ref.current={focus(){focused++;},contains(target){return target==="inside";}};}while(effects.length)effects.shift()();return tree;},
    close(){for(const cell of cells)cell?.cleanup?.();globalThis.window=oldWindow;for(const key of ["inboxState","inboxHooks","inboxTranslate","inboxReads","inboxSaves"])delete globalThis[key];},
  };
}
const bell=tree=>nodes(tree).find(n=>n.props["aria-controls"]==="message-inbox");
const dialog=tree=>nodes(tree).find(n=>n.props.role==="dialog");
const rows=tree=>nodes(dialog(tree)).filter(n=>n.type==="li");

test("opening or dismissing the bell never reads messages; new arrivals and folder metadata update while open",()=>{
  const ui=fixture();try{
    let tree=ui.render();assert.equal(bell(tree).props["aria-label"],"新消息，2 个未读会话");assert.equal(dialog(tree),undefined);assert.equal(ui.timers.size,0);
    bell(tree).props.onClick();tree=ui.render();assert.equal(ui.opened,1);assert.equal(rows(tree).length,2);assert.ok(text(rows(tree)[0]).includes("报价组"));assert.ok(text(rows(tree)[0]).includes("Support"));
    assert.deepEqual(inboxState.chats.map(c=>c.unread),[2,3]);assert.equal(ui.reads.length,0);assert.equal(inboxSaves,0);assert.equal(ui.timers.size,1);
    inboxState.chats=[...inboxState.chats,chat("c",{updatedAt:"2026-10-23T11:00:00Z"})];tree=ui.render();assert.ok(text(rows(tree)[0]).includes("Customer c"));
    ui.listeners.get("keydown")({key:"Escape",preventDefault(){}});tree=ui.render();assert.equal(dialog(tree),undefined);assert.equal(ui.timers.size,0);assert.equal(ui.reads.length,0);assert.ok(ui.focused>=2);
  }finally{ui.close();}
});

test("clicking a row opens its actual account/thread, clears only that unread count and keeps browsing/sending account intact",()=>{
  const ui=fixture();try{
    let tree=ui.render();bell(tree).props.onClick();tree=ui.render();nodes(rows(tree)[0]).find(n=>n.type==="button").props.onClick();tree=ui.render();
    assert.equal(inboxState.activeNav,"chats");assert.equal(inboxState.chatListFilter,"all");assert.equal(inboxState.selectedChatId,"b");
    assert.deepEqual(inboxState.selectedThreadAccount,{chatId:"b",accountId:"wa-b"});assert.equal(inboxState.selectedContactId,"c-b");
    assert.equal(inboxState.settings.activeAccountId,"wa-a");assert.equal(inboxState.settings.accountViewMode.accountId,"wa-a");
    assert.deepEqual(inboxState.chats.map(c=>c.unread),[2,0]);assert.equal(inboxState.unreadHoldUntilByChatId.b,undefined);assert.deepEqual(ui.reads,[["b","c-b"]]);assert.equal(dialog(tree),undefined);
    bell(tree).props.onClick();tree=ui.render();nodes(rows(tree)[0]).find(n=>n.type==="button").props.onClick();assert.equal(inboxState.focusMessageId,"latest-a");
  }finally{ui.close();}
});

test("deleted rows are safe, empty state works, outside clicks and keyboard focus dismiss without side effects",()=>{
  const ui=fixture();try{
    let tree=ui.render();bell(tree).props.onClick();tree=ui.render();const stale=nodes(rows(tree)[0]).find(n=>n.type==="button");
    inboxState.chats=[];stale.props.onClick();assert.equal(inboxState.selectedChatId,null);assert.equal(ui.reads.length,0);
    tree=ui.render();bell(tree).props.onClick();tree=ui.render();assert.ok(text(tree).includes("暂时没有未读消息"));
    ui.listeners.get("pointerdown")({target:"outside"});tree=ui.render();assert.equal(dialog(tree),undefined);
    bell(tree).props.onClick();tree=ui.render();tree.props.onBlur({relatedTarget:"outside",currentTarget:{contains:()=>false}});tree=ui.render();assert.equal(dialog(tree),undefined);
  }finally{ui.close();}
});
