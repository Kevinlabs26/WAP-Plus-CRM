import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import * as template from '../src/lib/broadcastTemplate.ts';
import {BROADCAST_HARD_CAP,BROADCAST_DEFAULT_EXTRA_GAP_SEC,BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC} from '../src/types/broadcast.ts';

const entry=fileURLToPath(new URL('../src/components/views/BroadcastView.tsx',import.meta.url));
const source=await readFile(entry,'utf8');
const imports=new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)].map(([,names,path])=>[path,names.split(',').map(n=>n.trim()).filter(n=>n&&!n.startsWith('type '))]));
const bundled=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'broadcast-boundaries',setup(b){
  b.onResolve({filter:/.*/},a=>a.kind==='entry-point'?undefined:{path:a.path,namespace:'mock'});
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";':a.path==='react'?'export const useState=(...a)=>globalThis.broadcastHooks.state(...a);export const useRef=(...a)=>globalThis.broadcastHooks.ref(...a);export const useMemo=(...a)=>globalThis.broadcastHooks.memo(...a);export const useDeferredValue=v=>v;':(imports.get(a.path)||[]).map(n=>`export const ${n}=globalThis.broadcastBindings[${JSON.stringify(n)}]||(()=>null);`).join('\n')}));
}}]});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'||typeof t==='number'?String(t):'';
const contacts=Array.from({length:20000},(_,i)=>({id:'c'+i,name:'Contact '+i,phone:'+1202'+String(1000000+i),accountId:'a',tags:[],stage:'new'}));

async function fixture(draftIds=[]) {
  const cells=[],storage=new Map([[template.BROADCAST_DRAFT_CONTACT_IDS_KEY,JSON.stringify(draftIds)]]);let cursor=0,tree;
  const oldStorage=globalThis.sessionStorage;globalThis.sessionStorage={getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)};
  const metrics={indexes:0,phones:0,confirmations:0,created:0};
  const state={contacts,chats:[],messages:[],broadcastCampaigns:[],settings:{waAccounts:[{id:'a',label:'Account A'},{id:'b',label:'Account B'}],activeAccountId:'a',liveBaileysAccountId:'a',sendChannel:'baileys'},baileysUi:{connection:'open'},pushToast(){},requestConfirm:async()=>{metrics.confirmations++;return false;},createBroadcastCampaign(){metrics.created++;return {ok:true,id:'demo'};}};
  const flags={warmup:false,connected:true};
  globalThis.broadcastHooks={
    state(initial){const i=cursor++;cells[i]??={value:typeof initial==='function'?initial():initial};return [cells[i].value,value=>{cells[i].value=typeof value==='function'?value(cells[i].value):value;}];},
    ref(initial){const i=cursor++;return cells[i]??={current:initial};},
    memo(fn,deps){const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j])))cells[i]={value:fn(),deps};return cells[i].value;},
  };
  globalThis.broadcastBindings={...template,BROADCAST_HARD_CAP,BROADCAST_DEFAULT_EXTRA_GAP_SEC,BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC,
    useAppStore:selector=>selector(state),useShallow:fn=>fn,useI18n:()=>({t:(key,params)=>key+(params?JSON.stringify(params):'')}),
    cn:(...parts)=>parts.filter(Boolean).join(' '),Button:'button',Input:'input',Textarea:'textarea',SectionLabel:'h4',BroadcastPickStep:'picker',BroadcastMediaPicker:'media-picker',CampaignRunPanel:'run-panel',
    DEFAULT_RATE_LIMITS:{},applyAccountWarmup:()=>({active:flags.warmup,hoursLeft:24}),isWaAccountConnected:()=>flags.connected,lastContactedAccounts:()=>new Map(),recipientKey:(_account,phone)=>phone,salesStagesWithLabels:()=>[],formatAccountDisplay:account=>account.label,
    buildContactLookup:()=>{metrics.indexes++;return new Map();},contactSendablePhone:contact=>{metrics.phones++;return template.contactSendablePhone(contact);},
  };
  const {BroadcastView}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text+'\n//# sourceURL=broadcast-setup.js').toString('base64')+'#'+Math.random());
  const h={state,flags,metrics,render(){cursor=0;tree=BroadcastView();return tree;},picker(){return nodes(tree).find(n=>n.type==='picker').props;},
    launch(){return nodes(tree).find(n=>n.type==='button'&&n.props.className?.includes('sm:min-w-48'));},
    account(){return nodes(tree).find(n=>n.type==='select');},all(){return nodes(tree);},close(){globalThis.sessionStorage=oldStorage;}};
  h.render();return h;
}

test('ordinary entry defaults to number paste and never builds the 20,000-contact list while pasting',async()=>{
  const h=await fixture();try{
    assert.equal(h.picker().source,'numbers');assert.deepEqual(h.picker().pool,[]);assert.equal(h.metrics.indexes,0);assert.equal(h.metrics.phones,0);
    h.picker().onPhoneTextChange('+12025550101\n+12025550102\n+12025550101\ninvalid');h.render();
    assert.equal(h.picker().directPhoneCount,2);assert.equal(h.picker().recipientCount,2);assert.equal(h.metrics.indexes,0);assert.equal(h.metrics.phones,0);
    h.picker().onSourceChange('contacts');h.render();assert.equal(h.picker().pool.length,20000);assert.equal(h.metrics.indexes,1);
    h.picker().onSourceChange('numbers');h.render();const calls=h.metrics.phones;
    h.picker().onPhoneTextChange('+12025550103');h.render();assert.equal(h.metrics.indexes,1);assert.equal(h.metrics.phones,calls);
  }finally{h.close();}
});

test('source switching preserves pasted numbers, filters and selections; changing the new-contact default preserves recipients',async()=>{
  const h=await fixture();try{
    h.picker().onSourceChange('contacts');h.render();h.picker().onToggle('c0');h.picker().onQChange('Contact 0');h.render();
    h.picker().onSourceChange('numbers');h.picker().onPhoneTextChange(contacts[0].phone+'\n+12025550102');h.render();
    assert.equal(h.picker().recipientCount,2,'overlap between list and pasted phones is deduplicated');assert.ok(h.picker().selected.has('c0'));assert.equal(h.picker().q,'Contact 0');
    h.picker().onSourceChange('contacts');h.render();assert.equal(h.picker().phoneText,contacts[0].phone+'\n+12025550102');assert.ok(h.picker().selected.has('c0'));
    h.account().props.onChange({target:{value:'b'}});h.render();assert.equal(h.picker().selected.size,1);assert.equal(h.picker().directPhoneCount,2);
  }finally{h.close();}
});

test('explicit selections imported from the CRM still open the contact list instead of hiding the chosen people',async()=>{
  const h=await fixture(['c0','missing']);try{assert.equal(h.picker().source,'contacts');assert.equal(h.picker().selected.size,1);assert.equal(h.picker().recipientCount,1);}finally{h.close();}
});

test('recipient cap, minimum sending intervals, connection and warmup guards remain in the setup page',async()=>{
  const h=await fixture();try{
    assert.equal(h.launch().props.disabled,true);
    h.picker().onPhoneTextChange(Array.from({length:BROADCAST_HARD_CAP+1},(_,i)=>'+1202'+String(2000000+i)).join('\n'));h.render();
    assert.equal(h.picker().recipientCount,BROADCAST_HARD_CAP+1);assert.equal(h.launch().props.disabled,true);await h.launch().props.onClick();assert.equal(h.metrics.confirmations,0);
    h.picker().onPhoneTextChange('+12025550101');h.render();assert.equal(h.launch().props.disabled,false);
    const intervals=h.all().filter(n=>n.type==='input'&&n.props.type==='number');assert.equal(intervals[0].props.min,20);assert.equal(intervals[0].props.value,20);assert.equal(intervals[1].props.value,30);
    h.flags.connected=false;h.render();assert.equal(h.launch().props.disabled,true);h.flags.connected=true;h.flags.warmup=true;h.render();assert.equal(h.launch().props.disabled,true);
    assert.equal(h.metrics.created,0,'test never creates or sends a live campaign');
  }finally{h.close();}
});

test('recording blocks launch, and a voice-only campaign requires no placeholder text',async()=>{
  const h=await fixture();try{
    h.picker().onPhoneTextChange('+12025550101');h.render();
    h.all().find(n=>n.type==='textarea').props.onChange({target:{value:''}});h.render();
    assert.equal(h.launch().props.disabled,true);
    let media=h.all().find(n=>n.type==='media-picker').props;
    media.onBusyChange(true);h.render();assert.equal(h.launch().props.disabled,true);
    media.onChange([{id:'voice',kind:'audio',mime:'audio/ogg',voiceNote:true}],'single',{voice:'data:audio/ogg;base64,T2dnUw=='});
    h.render();assert.equal(h.launch().props.disabled,true,'cannot launch before recording has finished');
    media.onBusyChange(false);h.render();assert.equal(h.launch().props.disabled,false);
    h.all().find(n=>n.type==='textarea').props.onChange({target:{value:'caption'}});h.render();
    assert.equal(h.launch().props.disabled,true,'never silently lose a voice caption');
    assert.equal(h.metrics.created,0);
  }finally{h.close();}
});
