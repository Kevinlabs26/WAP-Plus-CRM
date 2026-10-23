import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/core.ts";

const mocks = {
  react: "export const useState=v=>globalThis.dragHooks.state(v); export const useRef=v=>globalThis.dragHooks.ref(v); export const useEffect=(f,d)=>globalThis.dragHooks.effect(f,d); export const useMemo=f=>f(); export const memo=f=>f;",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;",
  "@/store/appStore": "export const useAppStore=Object.assign(f=>f(globalThis.dragStore),{getState:()=>globalThis.dragStore});",
  "zustand/react/shallow": "export const useShallow=f=>f;",
  "@/i18n": "export const useI18n=()=>({t:(k,p)=>globalThis.dragTranslate(k,p)});",
  "lucide-react": ["BellOff", "Copy", "MoreVertical", "Pin", "ChevronDown", "ChevronRight", "Folder", "FolderPlus", "Link2", "GripVertical", "LayoutGrid", "MoreHorizontal", "Pencil", "Trash2", "Upload", "Users", "UserRoundX", "Archive", "CalendarDays", "Inbox"].map(n=>`export const ${n}=()=>null;`).join(""),
  "@/components/ui/Avatar": "export const Avatar=()=>null;",
  "@/components/chat/Ticks": "export const Ticks=()=>null;",
  "@/components/ui/primitives": "export const Badge='badge', ListRow='button';",
};
const built = await build({
  stdin: { contents: `export {useChatFolderDrag} from './src/components/layout/useChatFolderDrag.ts';
    export {ChatSidebarRow} from './src/components/layout/ChatSidebarRow.tsx';
    export {FolderHeaderRow} from './src/components/layout/FolderHeaderRow.tsx';
    export {SidebarSpecialItem} from './src/components/layout/SidebarSpecialItem.tsx';
    export {buildSidebarItems} from './src/components/layout/buildSidebarItems.ts';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "drag-boundaries", setup(b) {
    b.onResolve({filter:/.*/}, args=>mocks[args.path]?{path:args.path,namespace:"mock"}:undefined);
    b.onLoad({filter:/.*/,namespace:"mock"}, args=>({contents:mocks[args.path]}));
  }}],
});
const {useChatFolderDrag,ChatSidebarRow,FolderHeaderRow,SidebarSpecialItem,buildSidebarItems} = await import("data:text/javascript;base64,"+Buffer.from(built.outputFiles[0].text).toString("base64"));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree,...nodes(tree.props.children)] : [];

function fixture() {
  const originalWindow=globalThis.window, originalDocument=globalThis.document;
  const cells=[], effects=[], listeners=new Map(), frames=new Map(), moves=[], toasts=[], reorders=[];
  let cursor=0, frameId=0, hit=null;
  globalThis.window={
    addEventListener(name,fn) { const list=listeners.get(name)||[]; list.push(fn); listeners.set(name,list); },
    removeEventListener(name,fn) { listeners.set(name,(listeners.get(name)||[]).filter(f=>f!==fn)); },
    requestAnimationFrame(fn) { frames.set(++frameId,fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  globalThis.document={elementFromPoint:()=>hit};
  globalThis.dragHooks={
    state(initial) {const i=cursor++; cells[i]??={value:initial}; return [cells[i].value,v=>{cells[i].value=v;}];},
    ref(initial) {return cells[cursor++]??={current:initial};},
    effect(fn,deps) {const i=cursor++; if(cells[i])return; cells[i]={}; effects.push(()=>{cells[i].cleanup=fn();});},
  };
  globalThis.dragTranslate=(key,params)=>translate("zh-CN",key,params);
  const folders=[{id:"a",name:"A",chatIds:["one"],scope:{type:"all"}}, {id:"b",name:"B",chatIds:[],scope:{type:"all"}}];
  globalThis.dragStore={settings:{chatFolders:folders},chats:[{id:"one"},{id:"two"}],peerPresenceByKey:{},
    moveChatToFolder:(...args)=>moves.push(args),pushToast:(...args)=>toasts.push(args),reorderChatFolder:(...args)=>reorders.push(args)};
  const rect={left:0,right:280,top:100,bottom:500,height:400};
  const scroller={scrollTop:0,isConnected:true,getBoundingClientRect:()=>rect};
  const event=(extra={})=>({pointerId:1,isPrimary:true,button:0,buttons:1,clientX:100,clientY:200,currentTarget:{closest:()=>scroller},preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
  const dispatch=(name,extra={})=>{const e=event(extra); for(const fn of [...listeners.get(name)||[]])fn(e);return e;};
  const render=()=>{cursor=0;const value=useChatFolderDrag({chatFolders:dragStore.settings.chatFolders});while(effects.length)effects.shift()();return value;};
  render();
  return {moves,toasts,reorders,frames,scroller,render,event,dispatch,
    target(id,{header=false}={}) {const element={dataset:{chatFolderDrop:id,...(header?{folderReorderTarget:id}:{})},getBoundingClientRect:()=>({top:250,height:40})};
      hit=id?{closest:selector=>selector==="[data-chat-folder-drop]"||header?element:null}:null;},
    start(ids) {dispatch("pointerdown");render().startChatPointerDrag(event(),"one",ids);},
    move(extra={}) {return dispatch("pointermove",{clientY:260,...extra});},
    up(extra={}) {return dispatch("pointerup",{clientY:260,...extra});},
    tick(time=16) {const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));},
    close() {for(const cell of cells)cell?.cleanup?.();globalThis.window=originalWindow;globalThis.document=originalDocument;
      for(const key of ["dragHooks","dragStore","dragTranslate"])delete globalThis[key];},
  };
}

test("dropping inside a group list moves the chat, reports the destination and suppresses the trailing click",()=>{
  const ui=fixture();try {
    ui.start();ui.target("b");ui.move();
    assert.equal(ui.render().dropTarget,"b");assert.match(ui.render().dragHint,/B/);
    ui.up();assert.deepEqual(ui.moves,[["one","b"]]);assert.match(ui.toasts[0][0],/已移动到.*B/);
    const click=ui.dispatch("click",{detail:1});assert.equal(click.defaultPrevented,true);assert.equal(click.stopped,true);
    assert.equal(ui.render().dragChatId,null);assert.equal(ui.frames.size,0);
    ui.dispatch("pointerdown");assert.equal(ui.dispatch("click",{detail:1}).defaultPrevented,undefined);
  } finally {ui.close();}
});

test("a click or a small pointer movement never moves a chat or prevents opening it",()=>{
  const ui=fixture();try {
    ui.start();ui.target("b");ui.move({clientX:102,clientY:202});ui.up({clientX:102,clientY:202});
    assert.deepEqual(ui.moves,[]);assert.deepEqual(ui.toasts,[]);assert.equal(ui.dispatch("click",{detail:1}).defaultPrevented,undefined);
  } finally {ui.close();}
});

test("merged account rows move all distinct underlying chats and ungrouping uses a null destination",()=>{
  const ui=fixture();try {
    ui.start(["one","two","one"]);ui.target("b");ui.move();ui.up();assert.deepEqual(ui.moves,[["one","b"],["two","b"]]);
    ui.moves.length=0;ui.start();ui.target("__ungrouped");ui.move();ui.up();assert.deepEqual(ui.moves,[["one",null]]);
  } finally {ui.close();}
});

test("missed, unchanged, deleted-target and deleted-source drops give feedback without changing membership",()=>{
  for(const scenario of ["missed","unchanged","target deleted","source deleted"]) {
    const ui=fixture();try {
      ui.start();ui.target(scenario==="missed"?null:scenario==="unchanged"?"a":"b");ui.move();
      if(scenario==="target deleted")dragStore.settings.chatFolders=dragStore.settings.chatFolders.filter(f=>f.id!=="b");
      if(scenario==="source deleted")dragStore.chats=[];
      ui.up();assert.deepEqual(ui.moves,[],scenario);assert.equal(ui.toasts.length,1,scenario);assert.equal(ui.toasts[0][1],"info");
    } finally {ui.close();}
  }
});

test("stationary edge dragging scrolls each animation frame and refreshes the drop target after virtualization",()=>{
  const ui=fixture();try {
    ui.start();ui.target("a");ui.move({clientY:495});ui.tick();const first=ui.scroller.scrollTop;assert.ok(first>0);
    ui.target("b");ui.tick(32);assert.ok(ui.scroller.scrollTop>first);assert.equal(ui.render().dropTarget,"b");
    ui.move({clientY:105});ui.tick(48);assert.ok(ui.scroller.scrollTop<first*2);
    ui.move({clientX:400,clientY:495});const stopped=ui.scroller.scrollTop;ui.tick(64);assert.equal(ui.scroller.scrollTop,stopped);
    ui.up();assert.equal(ui.frames.size,0);
  } finally {ui.close();}
});

test("Escape, pointer cancellation, losing focus and a released mouse cancel without moving",()=>{
  for(const [name,extra] of [["keydown",{key:"Escape"}],["pointercancel",{}],["blur",{}],["pointermove",{buttons:0}]]) {
    const ui=fixture();try {ui.start();ui.target("b");ui.move();ui.dispatch(name,extra);ui.up();assert.deepEqual(ui.moves,[]);assert.equal(ui.frames.size,0);assert.equal(ui.render().dragChatId,null);}
    finally {ui.close();}
  }
});

test("other pointers cannot move or finish the active drag",()=>{
  const ui=fixture();try {ui.start();ui.target("b");ui.move({pointerId:2});ui.up({pointerId:2});assert.deepEqual(ui.moves,[]);
    assert.equal(ui.render().dragChatId,null);ui.move();ui.dispatch("pointercancel",{pointerId:2});ui.up();assert.deepEqual(ui.moves,[["one","b"]]);}
  finally {ui.close();}
});

test("folder reordering stays within the same parent and account scope",()=>{
  const ui=fixture();try {
    ui.render().startFolderPointerDrag(ui.event(),"a");ui.target("b",{header:true});ui.move({clientY:285});ui.up({clientY:285});assert.deepEqual(ui.reorders,[["a","b",true]]);
    dragStore.settings.chatFolders[1].scope={type:"account",accountId:"wa-b"};ui.reorders.length=0;
    ui.render().startFolderPointerDrag(ui.event(),"a");ui.move();ui.up();assert.deepEqual(ui.reorders,[]);
  }finally{ui.close();}
});

test("group headers and empty hints expose full drop zones; merged rows are draggable and copies stay click-only",()=>{
  const ui=fixture();try {
    const header=FolderHeaderRow({folderId:"b",name:"B",collapsed:false,depth:0,total:0,unread:0});
    assert.ok(nodes(header).some(n=>n.props["data-chat-folder-drop"]==="b"));
    for(const folderId of ["b","__ungrouped"]) {
      const empty=SidebarSpecialItem({item:{kind:"folder_empty",folderId,dragging:true,dropActive:true}});
      assert.equal(empty.props["data-chat-folder-drop"],folderId);
    }
    const calls=[], props={chat:{id:"one",contactId:"person",contactName:"Person",unread:0},preview:"Hello",isBaileys:false,accountCount:2,memberChatIds:["one","two"],onDragStart:(...args)=>calls.push(args)};
    ChatSidebarRow(props).props.onPointerDown(ui.event());assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(1),["one",["one","two"]]);
    const copy=ChatSidebarRow({...props,cloneId:"copy"});copy.props.onPointerDown(ui.event());assert.equal(calls.length,1);assert.match(copy.props.className,/cursor-default/);
  } finally {ui.close();}
});

const sidebarModel=(overrides={})=>buildSidebarItems({listTab:"chats",archivedCount:0,showArchived:false,isAllAccountsView:false,
  filteredChats:[{id:"one",contactId:"c-one",lastMessage:"Hello",unread:3},{id:"two",contactId:"c-two",lastMessage:"Hi",unread:2}],
  chatFolders:[{id:"parent",name:"Parent",chatIds:[],collapsed:true},{id:"child",parentId:"parent",name:"Child",chatIds:["one"],collapsed:true}],
  chatFolderClones:[],contactById:new Map(),ungroupedCollapsed:true,query:"",folderDisplayName:f=>f.name,selectedChatId:"one",...overrides});

test("a collapsed parent retains the selected descendant and unread total without expanding or changing membership",()=>{
  const folders=[{id:"parent",name:"Parent",chatIds:[],collapsed:true},{id:"child",parentId:"parent",name:"Child",chatIds:["one"],collapsed:true}];
  const original=structuredClone(folders),items=sidebarModel({chatFolders:folders});
  const parent=items.find(i=>i.folderId==="parent");
  assert.equal(parent.containsSelected,true);assert.equal(parent.unread,1);assert.equal(parent.total,1);
  assert.equal(items.some(i=>i.kind==="chat"),false);assert.equal(items.some(i=>i.folderId==="child"),false);assert.deepEqual(folders,original);
  const expanded=sidebarModel({chatFolders:folders.map(f=>f.id==="parent"?{...f,collapsed:false}:f)});
  assert.equal(expanded.find(i=>i.folderId==="child").containsSelected,true);
  const other=sidebarModel({selectedChatId:"two"});assert.equal(other.find(i=>i.folderId==="parent").containsSelected,false);
  assert.equal(other.find(i=>i.kind==="ungrouped_header").containsSelected,true);
});

test("folder selection follows merged account members and explicit copies, and ignores filtered-out or removed threads",()=>{
  const contacts=new Map([["c-one",{id:"c-one",phone:"+12025550100"}],["c-two",{id:"c-two",phone:"+12025550100"}]]);
  const args={isAllAccountsView:true,contactById:contacts,selectedChatId:"two",chatFolders:[{id:"a",name:"A",chatIds:["one"],collapsed:true},{id:"b",name:"B",chatIds:[],collapsed:true}]};
  let items=sidebarModel(args);assert.equal(items.find(i=>i.folderId==="a").containsSelected,true);assert.equal(items.find(i=>i.folderId==="a").unread,1);
  assert.equal(items.find(i=>i.folderId==="b").containsSelected,false);assert.equal(items.find(i=>i.kind==="ungrouped_header").containsSelected,false);
  items=sidebarModel({...args,chatFolderClones:[{id:"copy",folderId:"b",sourceChatId:"two"}]});assert.equal(items.find(i=>i.folderId==="b").containsSelected,true);
  items=sidebarModel({...args,filteredChats:[{id:"one",contactId:"c-one",lastMessage:"Hello",unread:3}]});
  assert.equal(items.filter(i=>i.kind==="folder_header").some(i=>i.containsSelected),false);
  assert.equal(sidebarModel({selectedChatId:null}).some(i=>i.containsSelected),false);
  assert.equal(sidebarModel({showArchived:true}).some(i=>i.kind==="folder_header"||i.kind==="ungrouped_header"),false);
});

test("folder badges count unread conversations rather than messages, including children and ungrouped rows",()=>{
  const chats=Array.from({length:5},(_,i)=>({id:`chat-${i}`,contactId:`person-${i}`,unread:[10,50,0,0,0][i]}));
  let items=sidebarModel({filteredChats:chats,chatFolders:[{id:"all",name:"All",chatIds:chats.map(c=>c.id),collapsed:true}]});
  let header=items.find(i=>i.folderId==="all");assert.equal(header.total,5);assert.equal(header.unread,2);
  items=sidebarModel({filteredChats:chats,chatFolders:[{id:"parent",name:"Parent",chatIds:[],collapsed:true},{id:"child",parentId:"parent",name:"Child",chatIds:chats.map(c=>c.id)}]});
  header=items.find(i=>i.folderId==="parent");assert.equal(header.total,5);assert.equal(header.unread,2);
  items=sidebarModel({filteredChats:chats,chatFolders:[{id:"empty",name:"Empty",chatIds:[]}]});
  header=items.find(i=>i.kind==="ungrouped_header");assert.equal(header.total,5);assert.equal(header.unread,2);
  const cleared=sidebarModel({filteredChats:chats.map(c=>({...c,unread:0})),chatFolders:[{id:"all",name:"All",chatIds:chats.map(c=>c.id)}]});
  assert.equal(cleared.find(i=>i.folderId==="all").unread,0);
});

test("collapsed folder and ungrouped controls describe current location, exact unread totals and expansion while retaining callbacks",()=>{
  const ui=fixture();try {
    let toggles=0;
    const props={folderId:"a",name:"A",collapsed:true,depth:0,total:140,unread:123,containsSelected:true,onToggle:()=>toggles++};
    const tree=FolderHeaderRow(props),control=nodes(tree).find(n=>n.props["aria-expanded"]===false);
    assert.ok(control);control.props.onClick();assert.equal(toggles,1);
    assert.ok(nodes(tree).some(n=>n.props.title==="当前打开的会话在此分组中"));
    assert.ok(nodes(tree).some(n=>n.props["aria-label"]==="123 个会话有未读消息"&&n.props.children==="99+"));
    assert.ok(nodes(tree).some(n=>n.props["aria-label"]==="140 个会话"));
    const item={kind:"ungrouped_header",total:140,unread:123,collapsed:true,containsSelected:true};
    const ungrouped=SidebarSpecialItem({item,onToggleUngrouped:()=>toggles++});
    nodes(ungrouped).find(n=>n.props["aria-expanded"]===false).props.onClick();assert.equal(toggles,2);
    assert.ok(nodes(ungrouped).some(n=>n.props.title==="当前打开的会话在此分组中"));
    assert.ok(nodes(ungrouped).some(n=>n.props["aria-label"]==="123 个会话有未读消息"&&n.props.children==="99+"));
    const cleared=SidebarSpecialItem({item:{...item,unread:0,containsSelected:false}});
    assert.equal(nodes(cleared).some(n=>n.props.title==="当前打开的会话在此分组中"||n.props["aria-label"]==="0 个会话有未读消息"),false);
  }finally{ui.close();}
});

test("selected conversation rows expose current state and retain open/drag actions; unread presentation clears with read state",()=>{
  const ui=fixture();try {
    const opened=[],props={chat:{id:"one",contactId:"person",contactName:"Person",unread:123},preview:"Hello",active:true,isBaileys:false,
      lastMessageAt:"2026-10-23T10:00:00Z",onOpen:(...args)=>opened.push(args)};
    const tree=ChatSidebarRow(props),row=nodes(tree).find(n=>n.props["aria-current"]==="true");assert.ok(row);
    row.props.onClick();assert.deepEqual(opened,[["person","one"]]);
    assert.ok(nodes(tree).some(n=>n.props["aria-label"]==="123 条未读消息"&&n.props.children==="99+"));
    const read=ChatSidebarRow({...props,active:false,chat:{...props.chat,unread:0}});
    assert.equal(nodes(read).some(n=>n.props["aria-current"]==="true"||n.props["aria-label"]==="0 条未读消息"),false);
  }finally{ui.close();}
});
