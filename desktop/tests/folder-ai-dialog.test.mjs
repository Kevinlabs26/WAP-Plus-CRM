import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  react: 'export const useEffect=()=>{};export const useState = initial => globalThis.folderAiHooks.state(initial);',
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/i18n': 'export const useI18n=()=>({t:key=>key});',
  '@/components/ui/primitives': 'export const Textarea="textarea";',
  '@/components/settings/AiPromptLibrary':'export const AiPromptLibrary="prompt-library";',
  '@/components/settings/AiOutreachControls':'export const AiOutreachControls="outreach-controls";',
  '@/components/settings/AiOutreachPreview':'export const AiOutreachPreview="outreach-preview";',
  '@/store/appStore': 'export const flushPersist=async()=>{};export const useAppStore=selector=>selector(globalThis.folderAiState);useAppStore.getState=()=>globalThis.folderAiState;',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/layout/FolderAiPromptDialog.tsx',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},
  plugins:[{name:'folder-prompt-boundaries',setup(b){
    b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));
  }}]});
const {FolderAiPromptDialog}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
function harness(prompt,initialise=()=>{}) {
  let slots=[],cursor=0,tree,closed=0;
  const settings={aiReplyMode:'semi',activeAccountId:'a',aiSystemPrompt:'GLOBAL',aiSystemPromptByAccountId:{a:'ACCOUNT'},chatFolders:[
    {id:'parent',name:'Parent',chatIds:[],scope:{type:'account',accountId:'a'},aiSystemPrompt:'PARENT'},
    {id:'f',name:'Folder',chatIds:['chat'],parentId:'parent',scope:{type:'account',accountId:'a'},aiSystemPrompt:prompt},
  ]};
  const state={settings,updateSettings(patch){this.settings={...this.settings,...patch};}};
  initialise(state);
  globalThis.folderAiState=state;
  globalThis.folderAiHooks={state(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=v;}];}};
  const h={state,props:{},get closed(){return closed;},render(){cursor=0;tree=FolderAiPromptDialog({folderId:'f',onClose(){closed++;},...h.props});return tree;},
    select(value){nodes(tree).find(n=>n.type==='select').props.onChange({target:{value}});h.render();},
    type(value){nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value}});h.render();},
    click(label){nodes(tree).find(n=>n.type==='button'&&n.props.children===label).props.onClick();},nodes(){return nodes(tree);}};
  h.render();return h;
}

test('folder dialog previews inheritance and saves an independent identity without enabling automation',()=>{
 const h=harness();assert.ok(JSON.stringify(h.render()).includes('PARENT'));
 h.select('custom');assert.equal(h.nodes().find(n=>n.type==='textarea').props.maxLength,6000);
 assert.equal(h.nodes().find(n=>n.props.children==='dialog.save').props.disabled,true);
 h.type('  NEW FOLDER ROLE  ');
 h.state.settings={...h.state.settings,chatFolders:h.state.settings.chatFolders.map(f=>f.id==='parent'?{...f,name:'Renamed elsewhere'}:f)};
 h.click('dialog.save');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').aiSystemPrompt,'NEW FOLDER ROLE');
 assert.equal(h.state.settings.chatFolders[0].name,'Renamed elsewhere');
 assert.equal(h.state.settings.aiReplyMode,'semi');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').autoReplyMode,undefined);
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').aiOutreach.mode,'auto');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').aiOutreach.enabled,false);
 assert.equal(h.closed,1);
});

test('chat entry hides folder reply-mode controls and saving cannot overwrite the folder mode',()=>{
 const h=harness('CUSTOM');h.props.hideReplyMode=true;h.state.settings.chatFolders[1].autoReplyMode='manual';
 h.render();assert.ok(!h.nodes().some(node=>node.type==='button'&&node.props.children==='multi.replyMode.auto'));h.click('dialog.save');assert.equal(h.state.settings.chatFolders[1].autoReplyMode,'manual');
});

test('cross-account preview follows the chat or last successful contact, and changing preview never saves a sending account',()=>{
 for(const latest of ['a','b']){
  const h=harness(undefined,state=>{
   state.settings.chatFolders[1].scope={type:'all'};state.settings.liveBaileysAccountId='b';state.settings.activeAccountId='b';
   state.settings.aiSystemPromptByAccountId={a:'ACCOUNT_A',b:'ACCOUNT_B'};state.settings.waAccounts=[{id:'a',label:'1'},{id:'b',label:'2'}];
   state.selectedChatId='chat-a';state.chats=[{id:'chat-a',contactId:'a',accountId:'a'},{id:'chat-b',contactId:'b',accountId:'b'}];
   state.contacts=[{id:'a',phone:'+12025550101',accountId:'a'},{id:'b',phone:'+12025550101',accountId:'b'}];
   state.messages=[{id:'old',chatId:'chat-a',accountId:'a',direction:'out',deliveryStatus:'sent',sentAt:'2026-11-04T09:00:00Z'},
    {id:'new',chatId:'chat-b',accountId:'b',direction:'out',deliveryStatus:latest==='b'?'sent':'failed',sentAt:'2026-11-05T09:00:00Z'}];
  });
  assert.ok(JSON.stringify(h.render()).includes(latest==='a'?'ACCOUNT_A':'ACCOUNT_B'));
  const selector=h.nodes().find(node=>node.type==='select'&&node.props['aria-label']==='aiLibrary.previewAccount');assert.equal(selector.props.value,'');
  selector.props.onChange({target:{value:'b'}});h.render();h.click('dialog.save');
  assert.equal(h.state.settings.chatFolders[1].scope.type,'all');assert.equal(h.state.settings.chatFolders[1].aiOutreach.accountId,undefined);
 }
});

test('inherit clears only the folder override and cancel does not save draft changes',()=>{
 const h=harness('CUSTOM');h.select('inherit');h.click('dialog.save');
 assert.equal(h.state.settings.chatFolders.find(f=>f.id==='f').aiSystemPrompt,undefined);
 assert.equal(h.state.settings.chatFolders[0].aiSystemPrompt,'PARENT');
 const cancelled=harness('OLD');cancelled.type('UNSAVED');cancelled.click('dialog.cancel');
 assert.equal(cancelled.state.settings.chatFolders.find(f=>f.id==='f').aiSystemPrompt,'OLD');
 assert.equal(cancelled.closed,1);
});

test('deleting a folder while its editor is open cannot recreate it',()=>{
 const h=harness('CUSTOM');
 h.state.settings={...h.state.settings,chatFolders:h.state.settings.chatFolders.filter(f=>f.id!=='f')};
 h.click('dialog.save');assert.equal(h.state.settings.chatFolders.some(f=>f.id==='f'),false);
 assert.equal(h.render(),null);
});

test('append mode composes the parent and local text while saving hard constraints without enabling outreach',()=>{
 const h=harness();h.select('append');h.type('CHILD ADDITION');
 assert.ok(JSON.stringify(h.render()).includes('PARENT\\n\\nCHILD ADDITION'));
 const max=h.nodes().find(node=>node.type==='input'&&node.props.type==='number');max.props.onChange({target:{value:'80'}});h.render();
 h.click('dialog.save');const folder=h.state.settings.chatFolders.find(folder=>folder.id==='f');
 assert.equal(folder.aiPromptMode,'append');assert.equal(folder.aiReplyMaxChars,80);assert.equal(folder.aiOutreach.enabled,false);
});

test('folder reply mode is committed with its prompt and cancel leaves automation untouched',()=>{
 const h=harness('CUSTOM');h.click('multi.replyMode.auto');h.render();h.click('dialog.save');
 assert.equal(h.state.settings.chatFolders.find(folder=>folder.id==='f').autoReplyMode,'auto');
 assert.equal(h.state.settings.chatFolders[0].autoReplyMode,undefined);
 assert.equal(h.state.settings.chatFolders.find(folder=>folder.id==='f').aiOutreach.enabled,false);
 const cancelled=harness('CUSTOM');cancelled.click('multi.replyMode.auto');cancelled.click('dialog.cancel');
 assert.equal(cancelled.state.settings.chatFolders.find(folder=>folder.id==='f').autoReplyMode,undefined);
});

test('choosing a template from inherited mode appends it without enabling automatic sending',()=>{
 const h=harness();h.state.settings.aiPromptTemplates=[{id:'t',name:'Template',prompt:'TEMPLATE'}];h.render();
 h.nodes().find(node=>node.type==='select'&&node.props['aria-label']==='aiLibrary.choose').props.onChange({target:{value:'t'}});h.render();
 h.click('dialog.save');const folder=h.state.settings.chatFolders.find(folder=>folder.id==='f');
 assert.equal(folder.aiPromptMode,'append');assert.equal(folder.aiPromptTemplateId,'t');assert.equal(folder.autoReplyMode,undefined);assert.equal(folder.aiOutreach.enabled,false);
});

test('folder can save and start a round from its own dialog without changing its recurring schedule',async()=>{
 const h=harness('',state=>{
  state.settings.chatFolders[1].aiOutreach={enabled:true,mode:'auto',trigger:'both',time:'22:55',timeZone:'UTC',dailyLimit:10,minIdleHours:12,goal:''};
  state.pushToast=()=>{};
 });
 const button=()=>h.nodes().find(n=>n.type==='button'&&n.props.children==='aiOutreach.saveRunNow');
 assert.equal(!!button().props.disabled,false);
 h.click('aiOutreach.saveRunNow');
 await new Promise(resolve=>setImmediate(resolve));
 const rule=h.state.settings.chatFolders[1].aiOutreach;
 assert.ok(rule.runNowAt);assert.equal(rule.time,'22:55');assert.equal(rule.dailyLimit,10);assert.equal(h.closed,1);
 h.state.settings.aiOutreachPaused=true;h.render();assert.equal(button().props.disabled,true);
});

test('saving account allocation converts only this folder to cross-account scope and persists a fixed assignment',()=>{
 const h=harness('',state=>{
  state.settings.waAccounts=[{id:'a',label:'A',status:'connected'}];state.baileysUi={connection:'connected'};
  state.contacts=[{id:'p',accountId:'a',phone:'+12025550101'}];state.messages=[];
  state.chats=[{id:'chat',contactId:'p',accountId:'a',hasMessageHistory:false,updatedAt:'2026-01-01T00:00:00Z'}];
 });
 const allocation=h.nodes().find(n=>typeof n.type==='function'&&n.type.name==='FirstContactAllocation');
 allocation.props.onChange({...allocation.props.value,firstContactQuotas:{a:1}});h.render();h.click('dialog.save');
 const folder=h.state.settings.chatFolders.find(f=>f.id==='f');
 assert.equal(folder.scope.type,'all');assert.equal(folder.aiOutreach.firstContactAssignments[':12025550101'],'a');
 assert.equal(h.state.settings.chatFolders[0].scope.type,'account');
});

test('folder plan schedules are saved explicitly without deleting the existing fixed binding',()=>{
 const h=harness('',state=>{state.settings.aiPlaybookPlans=[{id:'p',name:'Welcome',days:['one','two']}];state.settings.chatFolders[1].aiPlaybookId='fixed';});
 const control=h.nodes().find(n=>typeof n.type==='function'&&n.type.name==='PlaybookScheduleFields');
 const schedule={planId:'p',startDate:'2026-11-11',timeZone:'Europe/Paris',switchTime:'09:00'};
 control.props.onChange(schedule);h.render();h.click('dialog.save');
 assert.deepEqual(h.state.settings.chatFolders[1].aiPlaybookSchedule,schedule);assert.equal(h.state.settings.chatFolders[1].aiPlaybookId,'fixed');
});
