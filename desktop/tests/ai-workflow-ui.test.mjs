import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 react:'export const useState=initial=>globalThis.aiUiHooks.state(initial);export const useEffect=()=>{};export const useMemo=fn=>fn();',
 'zustand/react/shallow':'export const useShallow=selector=>selector;',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
 '@/store/appStore':'export const useAppStore=selector=>selector(globalThis.aiUiState);useAppStore.getState=()=>globalThis.aiUiState;export const flushPersist=async()=>{};',
 '@/lib/autoReplyRuntime':'export const useAutoReplyRuntime=selector=>selector({byChat:{}});',
 '@/lib/aiSuggest':'export const hasRealAiKey=s=>!!s.customAiKey;',
 '@/i18n':'export const useI18n=()=>({t:key=>key});',
 '@/components/ui/primitives':'export const Button="button",Switch="switch";',
 './AiOutreachControls':'export const AiOutreachControls="outreach-controls";',
 './AiOutreachPreview':'export const AiOutreachPreview="outreach-preview";',
 '@/components/layout/FolderAiPromptDialog':'export const FolderAiPromptDialog="folder-editor";',
 '@/lib/aiOutreach':'export const queueOutreachDraft=async()=>{throw Error("unexpected send")};export const retryAiOutreach=async()=>{throw Error("unexpected AI call")};',
};
const built=await build({stdin:{contents:`export {AiOutreachTasks} from './src/components/settings/AiOutreachTasks.tsx';export {ChatAiStatusBar} from './src/components/chat/ChatAiStatusBar.tsx';`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'ui-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {AiOutreachTasks,ChatAiStatusBar}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=ai-workflow-ui.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):typeof tree==='string'||typeof tree==='number'?String(tree):'';
function fixture(){
 let slots=[],cursor=0;const calls=[];
 globalThis.aiUiHooks={state(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=value];}};
 const rule={enabled:true,mode:'auto',trigger:'both',time:'09:00',timeZone:'UTC',dailyLimit:10,minIdleHours:12,goal:'Say hello'};
 const day=new Date().toISOString().slice(0,10);
 globalThis.aiUiState={settings:{aiReplyMode:'auto',aiOutreachPaused:false,aiOutreachExcludedRecipients:[],customAiKey:'fixture',aiSystemPrompt:'BASE',aiSystemPromptByAccountId:{},aiAutoReplyManualChatIds:[],aiAutoReplyModeByChatId:{},aiPromptTemplates:[{id:'t',name:'Shared template',prompt:'PROMPT'}],
  chatFolders:[{id:'f',name:'Folder A',scope:{type:'account',accountId:'a'},chatIds:['chat'],aiPromptTemplateId:'t',aiOutreach:{...rule}},{id:'other',name:'Folder B',scope:{type:'account',accountId:'b'},chatIds:[],aiOutreach:{...rule}}],waAccounts:[{id:'a',label:'Account A'}],
  aiOutreachRuns:[{id:'q',folderId:'f',chatId:'chat',accountId:'a',day,status:'queued'},{id:'sent',folderId:'f',chatId:'chat',accountId:'a',day,status:'sent'},{id:'failed',folderId:'other',chatId:'chat',accountId:'b',day,status:'failed',error:'Network'}]},
  chats:[{id:'chat',contactName:'Person'}],messagesByChatId:{chat:[]},
  updateSettings(patch){aiUiState.settings={...aiUiState.settings,...patch};},setSelectedChat(...args){calls.push(['chat',...args]);},goToChats(...args){calls.push(['chats',...args]);},setSettingsOpen(...args){calls.push(['settings',...args]);},pushToast(){}};
 return {calls,render(Component=AiOutreachTasks){cursor=0;return nodes(Component===ChatAiStatusBar?Component({chatId:'chat',accountId:'a',connected:true,thread:[],recipient:'+12025550101'}):Component());},get state(){return aiUiState;}};
}

test('outreach page filters progress by folder, opens its editor and pauses only that folder without losing tasks',async()=>{
 const h=fixture();let tree=h.render();assert.equal(tree.filter(node=>node.type==='article').length,3);
 tree.find(node=>node.type==='select').props.onChange({target:{value:'f'}});tree=h.render();assert.equal(tree.filter(node=>node.type==='article').length,2);
 tree.find(node=>node.type==='button'&&text(node)==='aiTasks.configure').props.onClick();tree=h.render();assert.equal(tree.find(node=>node.type==='folder-editor').props.folderId,'f');
 await tree.find(node=>node.type==='button'&&text(node)==='aiTasks.pause').props.onClick();tree=h.render();
 assert.equal(h.state.settings.chatFolders[0].aiOutreach.paused,true);assert.equal(h.state.settings.chatFolders[0].aiOutreach.enabled,true);assert.equal(h.state.settings.chatFolders[1].aiOutreach.paused,undefined);assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
 await tree.find(node=>node.type==='button'&&text(node)==='aiTasks.resume').props.onClick();assert.equal(h.state.settings.chatFolders[0].aiOutreach.paused,false);
 tree=h.render();tree.find(node=>node.type==='button'&&text(node)==='aiTasks.sent1').props.onClick();assert.equal(h.render().filter(node=>node.type==='article').length,1);
});

test('chat header provides direct reply mode choices and folder editing without duplicate mode labels',()=>{
 const h=fixture();let tree=h.render(ChatAiStatusBar);assert.ok(tree.some(node=>node.type==='button'&&text(node).includes('Shared template')));
 assert.ok(!tree.some(node=>node.type==='button'&&text(node).includes('aiChat.manual')));
 tree.find(node=>node.type==='button'&&text(node)==='multi.replyMode.manual').props.onClick();assert.equal(h.state.settings.aiAutoReplyModeByChatId.chat,'manual');assert.equal(h.state.settings.aiAutoReplyPaused,undefined);
 tree=h.render(ChatAiStatusBar);tree.find(node=>node.type==='button'&&text(node)==='multi.replyMode.auto').props.onClick();assert.equal(h.state.settings.aiAutoReplyModeByChatId.chat,'auto');
 assert.equal(h.render(ChatAiStatusBar).find(node=>node.type==='button'&&text(node)==='multi.replyMode.auto').props['aria-pressed'],true);
 tree=h.render(ChatAiStatusBar);tree.find(node=>node.type==='button'&&text(node).includes('Shared template')).props.onClick();tree=h.render(ChatAiStatusBar);assert.equal(tree.find(node=>node.type==='folder-editor').props.folderId,'f');assert.equal(tree.find(node=>node.type==='folder-editor').props.hideReplyMode,true);
 h.state.settings.aiAutoReplyPaused=true;tree=h.render(ChatAiStatusBar);const manual=tree.find(node=>node.type==='button'&&text(node)==='multi.replyMode.manual');assert.equal(manual.props.disabled,true);manual.props.onClick();assert.equal(h.state.settings.aiAutoReplyModeByChatId.chat,'auto');assert.equal(h.calls.length,0);
});

test('outreach master and person permission are independent from automatic reply mode',()=>{
 const h=fixture();h.render().find(node=>node.type==='switch').props.onChange({target:{checked:false}});assert.equal(h.state.settings.aiOutreachPaused,true);assert.equal(h.state.settings.aiAutoReplyPaused,undefined);assert.equal(h.state.settings.aiReplyMode,'auto');
 h.render(ChatAiStatusBar).find(node=>node.type==='switch').props.onChange({target:{checked:false}});assert.deepEqual(h.state.settings.aiOutreachExcludedRecipients,[':12025550101']);assert.deepEqual(h.state.settings.aiAutoReplyModeByChatId,{});
 h.render(ChatAiStatusBar).find(node=>node.type==='switch').props.onChange({target:{checked:true}});assert.deepEqual(h.state.settings.aiOutreachExcludedRecipients,[]);assert.equal(h.state.settings.aiOutreachPaused,true);
});

test('enabling outreach shows a read-only preview and waits for the explicit enable action',()=>{
 const h=fixture();h.state.settings.aiOutreachPaused=true;
 h.render().find(node=>node.type==='select').props.onChange({target:{value:'f'}});
 h.render().find(node=>node.type==='switch').props.onChange({target:{checked:true}});assert.equal(h.state.settings.aiOutreachPaused,true);
 const preview=h.render().find(node=>node.type==='outreach-preview');assert.equal(preview.props.assumeRunning,true);assert.equal(typeof preview.props.onConfirm,'function');
 assert.deepEqual(preview.props.folderIds,['f','other'],'global enable previews every enabled folder even when the page is filtered');
 preview.props.onConfirm();assert.equal(h.state.settings.aiOutreachPaused,false);assert.equal(h.state.settings.aiAutoReplyPaused,undefined);
});

test('bulk setup changes selected folders only, preserves prompts and does not override a stopped master switch',async()=>{
 const h=fixture(),untouched=h.state.settings.chatFolders[1].aiOutreach;h.state.settings.aiOutreachPaused=true;
 let tree=h.render();tree.find(node=>node.type==='button'&&text(node)==='aiOutreach.bulk').props.onClick();tree=h.render();
 const boxes=tree.filter(node=>node.type==='input'&&node.props.type==='checkbox');assert.equal(boxes.length,2);boxes[0].props.onChange({target:{checked:true}});tree=h.render();
 const controls=tree.find(node=>node.type==='outreach-controls');controls.props.onChange({...controls.props.value,time:'10:30',goal:''});tree=h.render();
 tree.find(node=>node.type==='button'&&text(node)==='aiOutreach.applyBulk').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.state.settings.chatFolders[0].aiOutreach.time,'10:30');assert.equal(h.state.settings.chatFolders[0].aiOutreach.enabled,true);assert.equal(h.state.settings.chatFolders[0].aiPromptTemplateId,'t');assert.strictEqual(h.state.settings.chatFolders[1].aiOutreach,untouched);assert.equal(h.state.settings.aiOutreachPaused,true);
});

test('default restores inheritance for this chat only, preserving other overrides and manual opt-outs',()=>{
 const h=fixture();h.state.settings.chatFolders[0].autoReplyMode='manual';h.state.settings.aiAutoReplyModeByChatId={chat:'auto',other:'manual'};h.state.settings.aiAutoReplyManualChatIds=['chat','other'];
 let tree=h.render(ChatAiStatusBar);assert.equal(tree.find(node=>node.type==='button'&&text(node)==='multi.replyMode.manual').props['aria-pressed'],true);
 tree.find(node=>node.type==='button'&&text(node)==='crmPanel.inheritShort').props.onClick();
 assert.deepEqual(h.state.settings.aiAutoReplyModeByChatId,{other:'manual'});assert.deepEqual(h.state.settings.aiAutoReplyManualChatIds,['other']);assert.equal(h.state.settings.aiReplyMode,'auto');assert.equal(h.state.settings.chatFolders[0].autoReplyMode,'manual');
 tree=h.render(ChatAiStatusBar);assert.equal(tree.find(node=>node.type==='button'&&text(node)==='crmPanel.inheritShort').props['aria-pressed'],true);assert.ok(tree.some(node=>node.props.role==='status'&&text(node).includes('aiChat.manual')));
});

test('outreach progress follows delivery immediately without waiting for the ledger tick',()=>{
 const h=fixture();h.state.settings.aiOutreachRuns[0].messageId='out';h.state.messagesByChatId.chat=[{id:'out',deliveryStatus:'sent'}];
 let tree=h.render();assert.ok(tree.some(node=>node.type==='button'&&text(node)==='aiTasks.sent2'));assert.ok(tree.some(node=>node.type==='button'&&text(node)==='aiTasks.pending0'));
 h.state.messagesByChatId.chat=[{id:'out',deliveryStatus:'failed',lastError:'Delivery unknown',deliveryUncertain:true}];tree=h.render();assert.ok(tree.some(node=>node.props.role==='alert'&&text(node)==='Delivery unknown'));assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
});
