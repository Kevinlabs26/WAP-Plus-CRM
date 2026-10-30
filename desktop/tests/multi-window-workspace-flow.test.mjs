import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks = {
 react: 'export const useState=v=>globalThis.windowFlowHooks.state(v);export const useRef=v=>globalThis.windowFlowHooks.ref(v);export const useMemo=(f,d)=>globalThis.windowFlowHooks.memo(f,d);export const useCallback=(f,d)=>useMemo(()=>f,d);export const useEffect=(f,d)=>globalThis.windowFlowHooks.effect(f,d);',
 'react/jsx-runtime': 'export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;',
 'lucide-react': 'export const ArrowLeft="icon",ArrowDownUp="icon",CheckCheck="icon",ChevronLeft="icon",ChevronRight="icon",Plus="icon",Search="icon",Undo2="icon";',
 '@/store/appStore': 'export const useAppStore=Object.assign(fn=>fn(globalThis.windowFlowState),{getState:()=>globalThis.windowFlowState});',
 '@/i18n': 'export const useI18n=()=>({t:k=>k});',
 '@/components/ui/Avatar': 'export const Avatar="avatar";',
 '@/components/ui/primitives': 'export const Button="button";',
 '@/lib/utils': 'export const cn=(...a)=>a.filter(Boolean).join(" ");export const displayContactLabel=(...a)=>a.find(Boolean)||"Contact";',
 '@/lib/todayBoard': 'export const scopeTodayBoard=data=>data;',
 '@/lib/markChatRead': 'export const markChatReadRemote=()=>{};',
 '@/features/multiWindow/components/MultiWindowCard': 'export const MultiWindowCard="card";',
 '@/features/multiWindow/components/MultiWindowLayoutControls': 'export const MultiWindowLayoutControls="layout";',
 '@/features/multiWindow/components/MultiWindowQuickReplies': 'export const MultiWindowQuickReplies="quick-replies";',
 '@/features/multiWindow/hooks/useMultiWindowDataEffects': 'export const useMultiWindowDataEffects=()=>({loadErrorByChatId:{}});',
 '@/features/multiWindow/hooks/useMultiWindowHistory': 'export const useMultiWindowHistory=()=>({historyByChatId:{},registerInitialPage(){},loadOlder(){}});',
 '@/features/multiWindow/hooks/useMultiWindowReorder': 'export const useMultiWindowReorder=()=>({});',
 '@/features/multiWindow/hooks/useMultiWindowRefresh': 'export const useMultiWindowRefresh=()=>({refreshWindow(){}});',
 '@/features/multiWindow/hooks/useMultiWindowShortcuts': 'export const useMultiWindowShortcuts=()=>{};',
 '@/features/multiWindow/hooks/useMultiWindowPersistence': 'export const useMultiWindowPersistence=()=>{};',
 '@/features/multiWindow/storage': `export const FOLDER_STORAGE_KEY='folder',STORAGE_KEY='open';export const scopedStorageKey=v=>v;
 export const readStoredChatIds=()=>globalThis.windowFlowStored.open;export const readStoredFolderIds=()=>globalThis.windowFlowStored.folders;
 export const readSortMode=()=>globalThis.windowFlowStored.sort;export const readLayoutMode=()=>"auto";export const readIgnoreGroups=()=>false;export const readCompactMode=()=>false;
 export const readStoredCollapsedWindowIds=()=>[];export const readStoredPinnedWindowIds=()=>[];export const readRecentQueueIds=()=>[];export const readStoredActiveMembers=()=>({});export const readStoredManualMembers=()=>({});`,
};
const built = await build({ entryPoints:[fileURLToPath(new URL('../src/components/views/MultiWindowWorkspace.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'ui-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}] });
const {MultiWindowWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const textOf=t=>Array.isArray(t)?t.map(textOf).join(''):typeof t==='string'?t:t?.props?textOf(t.props.children):'';
function fixture(count=4,{folder=false,multi=false}={}){
 const chats=Array.from({length:count},(_,i)=>({id:`chat-${i}`,contactId:`contact-${i}`,accountId:`account-${i}`,updatedAt:`2026-10-29T10:00:${String(i).padStart(2,'0')}Z`,replyPendingSince:`2026-10-29T10:00:${String(i).padStart(2,'0')}Z`,lastMessageDirection:'in',unread:1}));
 const contacts=chats.map((c,i)=>({id:c.contactId,name:`Customer ${i}`,phone:`+1202555${String(100+i).padStart(4,'0')}`}));
 if(multi)contacts[2].phone=contacts[0].phone;
 globalThis.windowFlowStored={open:['chat-0','chat-1'],folders:folder?['f']:[],sort:'priority'};
 globalThis.windowFlowState={chats,contacts,messages:[],draftReplyByChatId:{},settings:{waAccounts:[],chatFolders:folder?[{id:'f',name:'Test folder',chatIds:chats.map(c=>c.id)}]:[],chatFolderClones:[]},
 pushToast(){},markReplyHandled(id){const st=globalThis.windowFlowState;st.chats=st.chats.map(c=>c.id===id?{...c,replyHandledAt:'2026-10-29T11:00:00Z'}:c);},patchChat(id,patch){const st=globalThis.windowFlowState;st.chats=st.chats.map(c=>c.id===id?{...c,...patch}:c);}};
 const cells=[],effects=[];let cursor=0,dirty=false;
 const hooks={state(v){const i=cursor++;if(!cells[i])cells[i]={value:typeof v==='function'?v():v};return[cells[i].value,update=>{const value=typeof update==='function'?update(cells[i].value):update;if(!Object.is(value,cells[i].value)){cells[i].value=value;dirty=true;}}];},ref(v){return cells[cursor++]??={current:v};},memo(f,deps){const i=cursor++,old=cells[i];if(!old||!deps.every((d,j)=>Object.is(d,old.deps[j])))cells[i]={deps,value:f()};return cells[i].value;},effect(f,deps){const i=cursor++,old=cells[i];if(!old||!deps.every((d,j)=>Object.is(d,old.deps[j]))){cells[i]={deps,cleanup:old?.cleanup};effects.push(()=>{cells[i].cleanup?.();cells[i].cleanup=f();});}}};
 globalThis.windowFlowHooks=hooks;
 let tree;
 const render=()=>{for(let attempts=0;attempts<20;attempts++){dirty=false;cursor=0;tree=MultiWindowWorkspace({onBack(){}});while(effects.length)effects.shift()();if(!dirty)return tree;}throw new Error('Unstable render');};
 return{render,cards:()=>nodes(tree).filter(n=>n.type==='card'),ids:()=>nodes(tree).filter(n=>n.type==='card').map(n=>n.props.chat.id),button:key=>nodes(tree).find(n=>n.type==='button'&&textOf(n).includes(key)),sort:value=>nodes(tree).find(n=>n.type==='select'&&n.props['aria-label']==='multi.sortMode').props.onChange({target:{value}}),patch:(id,patch)=>globalThis.windowFlowState.patchChat(id,patch),get state(){return globalThis.windowFlowState;},close(){cells.forEach(c=>c?.cleanup?.());}};
}

test('actual workspace holds windows through a successful send, another reply and a live inbound',()=>{
 const ui=fixture();try{ui.render();const ids=ui.ids();ui.patch('chat-0',{lastMessageDirection:'out',replyPendingSince:'',updatedAt:'2026-10-29T10:10:00Z'});ui.render();assert.deepEqual(ui.ids(),ids);
 ui.patch('chat-0',{updatedAt:'2026-10-29T10:11:00Z'});ui.render();assert.deepEqual(ui.ids(),ids);
 ui.patch('chat-3',{updatedAt:'2026-10-29T10:12:00Z',replyPendingSince:'2026-10-29T10:12:00Z'});ui.render();assert.deepEqual(ui.ids(),ids);
 ui.button('multi.newPending').props.onClick();ui.render();assert.deepEqual(ui.ids(),ids);
 ui.sort('recent');ui.render();assert.equal(ui.ids().length,2);assert.ok(ui.ids().includes('chat-0'));
 }finally{ui.close();}
});

test('explicit completion changes only one card, and undo restores it without erasing a newer inbound',()=>{
 const ui=fixture();try{ui.render();ui.cards()[0].props.onComplete();ui.render();assert.deepEqual(ui.ids(),['chat-2','chat-1']);assert.ok(ui.state.chats[0].replyHandledAt);
 ui.patch('chat-0',{unread:2,lastMessageDirection:'in',replyPendingSince:'2026-10-29T11:01:00Z',updatedAt:'2026-10-29T11:01:00Z'});ui.render();ui.button('multi.undoComplete').props.onClick();ui.render();assert.deepEqual(ui.ids(),['chat-0','chat-1']);assert.equal(ui.state.chats[0].replyHandledAt,undefined);assert.equal(ui.state.chats[0].unread,2);assert.equal(ui.state.chats[0].replyPendingSince,'2026-10-29T11:01:00Z');
 }finally{ui.close();}
});

test('with no next customer the completed card stays open and can be undone',()=>{
 const ui=fixture(2);try{ui.render();ui.cards()[0].props.onComplete();ui.render();assert.deepEqual(ui.ids(),['chat-0','chat-1']);assert.ok(ui.state.chats[0].replyHandledAt);ui.button('multi.undoComplete').props.onClick();ui.render();assert.equal(ui.state.chats[0].replyHandledAt,undefined);}finally{ui.close();}
});

test('multi-account completion handles only the active account and never switches again on sending',()=>{
 const ui=fixture(3,{folder:true,multi:true});try{ui.render();ui.cards()[0].props.onComplete();ui.render();assert.deepEqual(ui.ids(),['chat-2','chat-1']);assert.equal(ui.state.chats[2].replyHandledAt,undefined);assert.ok(ui.state.chats[0].replyHandledAt);
 ui.patch('chat-2',{lastMessageDirection:'out',replyPendingSince:'',updatedAt:'2026-10-29T11:01:00Z'});ui.render();assert.deepEqual(ui.ids(),['chat-2','chat-1']);assert.equal(ui.cards()[0].props.accountOptions.length,2);
 ui.button('multi.undoComplete').props.onClick();ui.render();assert.deepEqual(ui.ids(),['chat-0','chat-1']);
 }finally{ui.close();}
});


test('a message arriving between render and clicking complete is never silently handled',()=>{
 const ui=fixture();try{ui.render();const complete=ui.cards()[0].props.onComplete;ui.patch('chat-0',{updatedAt:'2026-10-29T11:02:00Z',replyPendingSince:'2026-10-29T11:02:00Z'});complete();ui.render();assert.deepEqual(ui.ids(),['chat-0','chat-1']);assert.equal(ui.state.chats[0].replyHandledAt,undefined);}finally{ui.close();}
});

test('undo does not overwrite a newer completion from another view',()=>{
 const ui=fixture();try{ui.render();ui.cards()[0].props.onComplete();ui.render();ui.patch('chat-0',{replyHandledAt:'2026-10-29T12:00:00Z'});ui.button('multi.undoComplete').props.onClick();ui.render();assert.equal(ui.state.chats[0].replyHandledAt,'2026-10-29T12:00:00Z');assert.deepEqual(ui.ids(),['chat-0','chat-1']);}finally{ui.close();}
});


test('a normal workspace keeps other accounts of the same customer reachable without a folder',()=>{
 const ui=fixture(3,{multi:true});try{ui.render();assert.equal(ui.cards()[0].props.accountOptions.length,2);ui.cards()[0].props.onComplete();ui.render();assert.deepEqual(ui.ids(),['chat-2','chat-1']);ui.patch('chat-2',{lastMessageDirection:'out',replyPendingSince:'',updatedAt:'2026-10-29T11:01:00Z'});ui.render();assert.deepEqual(ui.ids(),['chat-2','chat-1']);ui.button('multi.undoComplete').props.onClick();ui.render();assert.deepEqual(ui.ids(),['chat-0','chat-1']);}finally{ui.close();}
});


test('undo cannot dismiss unfinished content in the replacement window',()=>{
 const ui=fixture();try{ui.render();ui.cards()[0].props.onComplete();ui.render();const node={dataset:{unfinished:'true'}};ui.cards()[0].props.cardRef(node);ui.button('multi.undoComplete').props.onClick();ui.render();assert.deepEqual(ui.ids(),['chat-2','chat-1']);assert.ok(ui.state.chats[0].replyHandledAt);node.dataset.unfinished='false';ui.button('multi.undoComplete').props.onClick();ui.render();assert.deepEqual(ui.ids(),['chat-0','chat-1']);}finally{ui.close();}
});
