import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createContactActions} from '../src/store/contactActions.ts';

const mocks={
 react:'export const useState=i=>globalThis.contactHooks.state(i);export const useRef=i=>globalThis.contactHooks.ref(i);export const useEffect=()=>{};export const useMemo=f=>f();',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 'react-virtuoso':'export const Virtuoso="list";',
 'lucide-react':'export const Download="download",FilePlus2="import",Plus="add",Trash2="delete",MessageSquare="chat";',
 '@/store/appStore':'export const useAppStore=selector=>selector(globalThis.contactState);useAppStore.getState=()=>globalThis.contactState;export const flushPersist=async()=>globalThis.contactCalls.push(["flush"]);',
 '@/components/ui/primitives':'export const Button="button",Input="input";',
 '@/components/settings/ContactImportModal':'export const ContactImportModal="import-modal";',
 '@/lib/exportData':'export const contactsToCsv=rows=>rows.map(row=>row.id).join(",");export const downloadText=(...args)=>globalThis.contactCalls.push(["export",...args]);',
 '@/lib/baileys':'export const baileysSaveContacts=async(account,rows)=>{globalThis.contactCalls.push(["remote",account,rows]);if(globalThis.contactGate)await globalThis.contactGate;return {saved:1,failed:rows.length-1,savedPhones:[rows[0].phoneE164]};};',
 '@/i18n':'export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):"")});',
 './baileysCore':'export const request=(...args)=>globalThis.contactRequest(...args);export const resolveBaileysAccountId=id=>id;export const baileysResetAccount=()=>{};',
};
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({stdin:{contents:`export {ContactManagementPanel} from './src/components/layout/ContactManagementPanel.tsx';export {contactCopiesForAccount} from './src/lib/contactManagement.ts';export {baileysSaveContacts as saveBatch} from './src/lib/baileysChatActions.ts';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'contacts-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ContactManagementPanel,contactCopiesForAccount,saveBatch}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):typeof tree==='string'?tree:'';
const person=(id,phone='+12025550101',accountId='a')=>({id,name:id,phone,accountId,tags:['tag'],stage:'new',notes:'note',waKey:{id:'never-copy'},lastMessageAt:'2026-01-01'});
function fixture(){
 const cells=[];let cursor=0;globalThis.contactCalls=[];globalThis.contactGate=null;
 globalThis.contactHooks={state(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return [cells[i],value=>cells[i]=typeof value==='function'?value(cells[i]):value];},ref(initial){return cells[cursor++]??={current:initial};}};
 const contacts=[person('one'),person('two','+12025550102')];
 globalThis.contactState={contacts,settings:{liveBaileysAccountId:'a'},pushToast:(...args)=>contactCalls.push(['toast',...args]),importContacts:rows=>{contactCalls.push(['copies',rows]);return rows.length;},updateContact:(...args)=>contactCalls.push(['edit',...args]),requestConfirm:async()=>true,deleteContactsLocal:ids=>contactCalls.push(['delete',ids]),batchUpdateContacts:(...args)=>contactCalls.push(['tags',...args]),scheduleFollowUps:(...args)=>contactCalls.push(['followups',...args]),openContactWorkspace:()=>{}};
 const props={contacts,accounts:[{id:'a',label:'A'},{id:'b',label:'B'}],accountId:'a',connectedAccountIds:['a','b'],isBaileys:true,onPaste(){}};
 const render=()=>{cursor=0;return nodes(ContactManagementPanel(props));};
 const row=i=>nodes(render().find(node=>node.type==='list').props.itemContent(i,props.contacts[i]));
 const select=i=>row(i).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange();
 const save=()=>render().find(node=>node.type==='button'&&text(node)==='contactManage.saveAccount');
 return {props,render,row,select,save};
}

test('saving selected contacts uses the explicit account, copies only successful numbers and preserves originals',async()=>{
 const h=fixture();h.select(0);h.select(1);h.render().find(n=>n.type==='select').props.onChange({target:{value:'b'}});
 h.save().props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(contactCalls.find(call=>call[0]==='remote')[1],'b');
 const copies=contactCalls.find(call=>call[0]==='copies')[1];assert.equal(copies.length,1);assert.equal(copies[0].accountId,'b');assert.equal(copies[0].notes,'note');
 assert.equal(contactState.contacts[0].accountId,'a');assert.equal(copies[0].waKey,undefined);assert.equal(copies[0].lastMessageAt,undefined);
 assert.ok(contactCalls.some(call=>call[0]==='toast'&&call.at(-1)==='error'),'partial failure stays visible');
});

test('selection cannot leak to another account or search result; offline targets cannot be saved',()=>{
 const h=fixture();h.select(0);h.props.contacts=[person('other','+12025550103','b')];assert.equal(h.save(),undefined);
 h.select(0);h.props.connectedAccountIds=[];assert.equal(h.save().props.disabled,true);
 h.row(0).find(node=>node.type==='input'&&!node.props.type).props.onBlur({target:{value:'Renamed'}});
 assert.deepEqual(contactCalls.at(-1),['edit','other',{name:'Renamed'}]);
});

test('copying contacts skips existing target numbers, duplicates, failed numbers and protocol metadata',()=>{
 const one=person('one'),two=person('two','+12025550102'),existing=person('kept',one.phone,'b');
 assert.deepEqual(contactCopiesForAccount([one,two,two],[existing],'b',[one.phone,two.phone],'a').map(row=>row.phone),[two.phone]);
 assert.deepEqual(contactCopiesForAccount([one],[],'b',[],'a'),[]);
 assert.throws(()=>contactCopiesForAccount([one],[],'',[one.phone]),/target account/);
});

test('batch deletion updates once, removes only selected local records and preserves every chat',()=>{
 const chats=[{id:'chat',contactId:'one'}];let state={contacts:[person('one'),person('two')],chats,followUps:[{contactId:'one'},{contactId:'two'}],activities:[{contactId:'one'},{contactId:'two'}]};let writes=0,saves=0;
 const actions=createContactActions({getContacts:()=>state.contacts,getPhones:()=>[],setState:updater=>{state={...state,...updater(state)};writes++;},setSelectedPhone(){},logActivity(){},stageLabel:id=>id,resolveStage:id=>id,recomputeStats(){},persist(){saves++;}});
 actions.deleteContactsLocal(['one']);assert.equal(writes,1);assert.equal(saves,1);assert.equal(state.chats,chats);assert.deepEqual(state.contacts.map(row=>row.id),['two']);assert.deepEqual(state.followUps,[{contactId:'two'}]);
});

test('WhatsApp batch results retain exactly the confirmed successful numbers across pages',async()=>{
 const calls=[];globalThis.contactRequest=async(path,options,account)=>{const rows=JSON.parse(options.body).items;calls.push({path,account,count:rows.length});return {items:rows.map((_,i)=>({status:i===0?'saved':'failed'}))};};
 const contacts=Array.from({length:501},(_,i)=>({name:'N'+i,phoneE164:'+1202555'+String(i).padStart(4,'0')}));
 const result=await saveBatch('b',contacts);assert.deepEqual(calls.map(call=>[call.account,call.count]),[['b',500],['b',1]]);
 assert.equal(result.saved,2);assert.equal(result.failed,499);assert.deepEqual(result.savedPhones,[contacts[0].phoneE164,contacts[500].phoneE164]);
});
