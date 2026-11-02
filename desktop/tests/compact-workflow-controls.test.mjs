import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 '@/components/crm/AddContactForm':'export const AddContactForm="add-contact";',
 '@/components/crm/ContactEditor':'export const ContactEditor="contact-editor";',
 '@/components/crm/SalesStageManager':'export const SalesStageManager="stage-manager";',
 '@/components/settings/ContactImportModal':'export const ContactImportModal="import-modal";',
 './CrmBoardCard':'export const CrmBoardCard="board-card";',
 '@/lib/exportData':'export const contactsToCsv=()=>"";export const downloadText=()=>{};',
 react:'export const useState=i=>globalThis.compactHooks(i);export const useEffect=()=>{};export const useCallback=f=>f;export const useMemo=f=>f();export const useDeferredValue=v=>v;export const useRef=i=>globalThis.compactHooks(()=>({current:i}))[0];',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 '@/i18n':'export const useI18n=()=>({t:(k,p)=>k+(p?JSON.stringify(p):"")});',
 '@/components/ui/primitives':'export const Button="button",Input="input",SectionLabel="h4",Textarea="textarea",Badge="badge",EmptyState="empty",ListRow="list-row";',
 '@/components/ui/Avatar':'export const Avatar="avatar";',
 'react-virtuoso':'export const Virtuoso="list";',
 'lucide-react':'export const ChevronDown="down",ChevronUp="up",MoreHorizontal="more",RotateCcw="reset",Check="check",Download="download",HardDriveDownload="disk",Loader2="busy",Trash2="delete",Settings2="settings",CheckSquare="select",Plus="plus",Search="search",Clock3="clock",CalendarDays="calendar",Megaphone="broadcast",Tag="tag",X="close",FilePlus2="import";',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.compactState||{pushToast(){}});',
 '@/lib/localSpeech':'export const SPEECH_MODEL_PRESETS=[];export const listLocalSpeechModels=async()=>[];export const downloadSpeechModel=async()=>{};export const removeLocalSpeechModel=async()=>{};',
};
const built=await build({stdin:{contents:`export {CrmView} from './src/components/views/CrmView.tsx';export {SavedMessageToolbar} from './src/components/chat/SavedMessageToolbar.tsx';export {BroadcastPickStep} from './src/components/views/BroadcastPickStep.tsx';export {MultiWindowLayoutControls} from './src/features/multiWindow/components/MultiWindowLayoutControls.tsx';export {SettingsLocalSpeechPanel} from './src/components/settings/SettingsLocalSpeechPanel.tsx';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const ui=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=compact-workflow-controls.js').toString('base64'));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'||typeof t==='number'?String(t):'';
function harness(component,props,initial=[]){let slots=initial,cursor=0,tree;const h={props,render(){cursor=0;globalThis.compactHooks=i=>{const at=cursor++;if(!(at in slots))slots[at]=typeof i==='function'?i():i;return [slots[at],v=>slots[at]=typeof v==='function'?v(slots[at]):v];};tree=component(h.props);return tree;},nodes:()=>nodes(tree),text:()=>text(tree),button:k=>h.nodes().find(n=>n.type==='button'&&text(n).startsWith(k))};h.render();return h;}
function picker(extra={}){const h=harness(ui.BroadcastPickStep,{source:'numbers',onSourceChange:source=>{h.props.source=source;},phoneText:'',directPhoneCount:0,recipientCount:1,stages:[],stageFilter:'all',tagFilter:'',q:'',pool:[{id:'a'}],selectedContacts:[{id:'a'}],selected:new Set(['a']),onToggle(){},onSelectVisible(){},onClear(){},...extra});return h;}

test('switching recipient source retains both selections and always exposes their counts and union total',()=>{
 const changes=[];const h=picker({source:'contacts',onPhoneTextChange:v=>{changes.push(v);h.props.phoneText=v;h.props.directPhoneCount=2;h.props.recipientCount=2;},onClear:()=>assert.fail('switch must not clear contacts')});
 assert.equal(h.nodes().filter(n=>n.type==='section').length,1);assert.ok(h.nodes().some(n=>n.type==='list'));assert.ok(!h.nodes().some(n=>n.type==='textarea'));
 h.button('broadcast.directPhones').props.onClick();h.render();
 assert.ok(!h.nodes().some(n=>n.type==='list'),'inactive list is unmounted');
 h.nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'+12025550101\n+12025550102'}});h.render();
 h.button('broadcast.chooseContacts').props.onClick();h.render();
 assert.equal(h.props.selected.has('a'),true);assert.equal(h.props.phoneText,changes[0]);assert.match(text(h.button('broadcast.directPhones')),/2$/);
 assert.match(text(h.nodes().find(n=>n.props.role==='status')),/"count":2/);
 h.button('broadcast.directPhones').props.onClick();h.render();assert.equal(h.nodes().find(n=>n.type==='textarea').props.value,changes[0]);
});

test('existing pasted numbers open their source; clear selection only clears contacts',()=>{
 let clears=0;const h=picker({phoneText:'+12025550101',directPhoneCount:1,onClear:()=>{clears++;h.props.selected=new Set();}});
 assert.equal(h.nodes().filter(n=>n.type==='section').length,1);assert.ok(h.nodes().some(n=>n.type==='textarea'));assert.ok(!h.nodes().some(n=>n.type==='list'));
 h.button('broadcast.chooseContacts').props.onClick();h.render();h.button('broadcast.clearSelection').props.onClick();h.render();
 assert.equal(clears,1);assert.equal(h.props.phoneText,'+12025550101');
});

test('layout selector and hidden actions retain their existing callbacks and restore menu focus',()=>{
 const calls=[];const h=harness(ui.MultiWindowLayoutControls,{layoutMode:'two',compact:true,allVisibleCollapsed:false,onLayoutChange:v=>calls.push(v),onCompactChange:v=>calls.push(v),onToggleVisibleCollapsed:()=>calls.push('collapse'),onResetLayout:()=>calls.push('reset')});
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'three'}});
 assert.equal(h.button('multi.compact').props['aria-pressed'],true);h.button('multi.compact').props.onClick();
 h.button('multi.collapsePage').props.onClick();h.button('multi.resetLayout').props.onClick();assert.deepEqual(calls,['three',false,'collapse','reset']);
 const menu=h.nodes().find(n=>n.type==='details');let focused=0;const target={open:true,querySelector:()=>({focus(){focused++;}})};
 menu.props.onClick({target:{closest:()=>null},currentTarget:target});assert.equal(target.open,true);
 menu.props.onClick({target:{closest:()=>({})},currentTarget:target});assert.equal(target.open,false);assert.equal(focused,1);
 target.open=true;menu.props.onKeyDown({key:'Escape',stopPropagation(){},currentTarget:target});assert.equal(target.open,false);assert.equal(focused,2);
 h.props.allVisibleCollapsed=true;h.render();assert.ok(h.button('multi.expandPage'));
});

test('offline models and voices start collapsed while installed readiness remains visible',()=>{
 const h=harness(ui.SettingsLocalSpeechPanel,{embedded:true},[[],[{name:'tiny',ready:true,dir:'models/tiny'}]]);
 const sections=h.nodes().filter(n=>n.type==='details');assert.equal(sections.length,2);assert.ok(sections.every(n=>!n.props.open));
 assert.match(text(nodes(sections[0]).find(n=>n.type==='summary')),/settingsSpeech.ready.*1/);
 assert.ok(nodes(sections[0]).some(n=>n.type==='button'&&n.props.title==='settingsSpeech.deleteModel'));
 assert.match(text(nodes(sections[1]).find(n=>n.type==='summary')),/settingsSpeech.ttsVoices/);
});

test('saved item types and tags retain callbacks, with batch operations on a separate conditional row',()=>{
 const calls=[];const h=harness(ui.SavedMessageToolbar,{filter:'all',tagFilter:'Invitation',tags:['Invitation','Follow-up'],selectMode:false,selectedCount:0,onFilterChange:v=>{calls.push(v);h.props.filter=v},onTagFilterChange:v=>calls.push(v),onToggleSelectMode:()=>{h.props.selectMode=!h.props.selectMode},onSelectAll:()=>calls.push('all'),onPinSelected:()=>calls.push('pin'),onDeleteSelected:()=>calls.push('delete')});
 const filter=()=>h.nodes().find(n=>n.props['aria-label']==='saved.filterType');
 assert.equal(nodes(filter()).filter(n=>n.type==='option').length,7);assert.equal(h.button('saved.delete'),undefined);
 filter().props.onChange({target:{value:'tag'}});h.render();assert.equal(h.nodes().find(n=>n.props['aria-label']==='saved.tag').props.value,'Invitation');
 h.nodes().find(n=>n.props['aria-label']==='saved.tag').props.onChange({target:{value:'Follow-up'}});
 h.button('saved.multiSelect').props.onClick();h.render();assert.equal(h.button('saved.pin').props.disabled,true);assert.equal(h.button('saved.delete').props.disabled,true);
 const rows=h.render().props.children;assert.ok(nodes(rows[1]).includes(h.button('saved.delete')));assert.ok(!nodes(rows[0]).includes(h.button('saved.delete')));
 h.props.selectedCount=2;h.render();assert.equal(h.button('saved.delete').props.disabled,false);
 h.button('saved.selectAll').props.onClick();h.button('saved.pin').props.onClick();h.button('saved.delete').props.onClick();
 assert.deepEqual(calls,['tag','Follow-up','all','pin','delete']);
 filter().props.onChange({target:{value:'image'}});h.render();assert.equal(h.nodes().find(n=>n.props['aria-label']==='saved.tag'),undefined);
});

test('CRM toolbar preserves all filters, view preferences, import, stage management and selection actions',()=>{
 const oldStorage=globalThis.localStorage;const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.compactState={contacts:[{id:'one',name:'Grace',phone:'+12025550101',stage:'new',tags:[],notes:'note'},{id:'two',name:'David',phone:'+12025550102',stage:'new',tags:[]}],chats:[],phones:[],followUps:[{contactId:'two',dueAt:'2020-01-01T00:00:00Z'}],settings:{},selectedContactId:null};
 try{
  const h=harness(ui.CrmView,{}),filter=()=>h.nodes().find(n=>n.props['aria-label']==='crm.filters');
  const menu=h.nodes().find(n=>n.type==='details');assert.ok(menu);assert.ok(nodes(menu).includes(h.button('crm.import')));assert.ok(nodes(menu).includes(h.button('crm.manageStages')));
  assert.deepEqual(nodes(filter()).filter(n=>n.type==='option').map(n=>n.props.value),['all','active','due_followup','needs_name','has_note']);
  filter().props.onChange({target:{value:'has_note'}});h.render();assert.equal(storage.get('wap.crmQuickFilter'),'has_note');
  assert.equal(h.nodes().filter(n=>n.type==='list').reduce((sum,n)=>sum+n.props.data.length,0),1);
  h.button('crm.import').props.onClick();h.render();assert.equal(h.nodes().find(n=>n.type==='import-modal').props.open,true);
  h.button('crm.manageStages').props.onClick();h.render();assert.ok(h.nodes().some(n=>n.type==='stage-manager'));
  h.button('crm.select').props.onClick();h.render();assert.ok(h.button('crm.exitSelect'));assert.ok(h.button('crm.selectAll'));
  h.button('crm.exitSelect').props.onClick();h.render();assert.equal(h.button('crm.selectAll'),undefined);
  h.nodes().find(n=>n.type==='select'&&n.props.value==='board').props.onChange({target:{value:'list'}});h.render();assert.equal(storage.get('wap.crmMode'),'list');assert.equal(filter().props.value,'has_note');
  h.button('crm.newContact').props.onClick();h.render();assert.ok(h.nodes().some(n=>n.type==='add-contact'));
 }finally{globalThis.localStorage=oldStorage;delete globalThis.compactState;}
});
