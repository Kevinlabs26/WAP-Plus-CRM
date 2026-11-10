import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=async(contents,mocks={})=>{const out=await build({stdin:{contents,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':root+'src'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text+'\n//# sourceURL=clone-calls-test.js').toString('base64'));};
const {cloneCallTarget,cloneCallInvoke,cloneCallOwnerPhone,isWhatsAppCallLink,tryOpenBoundCallLink}=await bundle(`export * from './src/lib/cloneCalls.ts';`,{'@/lib/bridge':'export const isTauri=()=>false;'});
const accounts=[{id:'one',label:'1',phoneE164:'+12025550101',historyPhoneE164:'+12025550101',status:'disconnected'},{id:'two',label:'2',phoneE164:'+12025550102',status:'connected'}];
const chat={id:'c',accountId:'one',contactId:'person'},contact={id:'person',phone:'+33612345678'};
test('calls follow the selected conversation account, including offline CRM sessions, without online/default fallback',()=>{
 assert.equal(cloneCallTarget(chat,contact,accounts).accountId,'one');
 assert.equal(cloneCallTarget(chat,contact,accounts,'two').ownerPhone,'+12025550102');
 assert.equal(cloneCallTarget(chat,contact,accounts,'deleted'),null);
 assert.equal(cloneCallTarget({...chat,accountId:undefined},contact,accounts),null);
 assert.equal(cloneCallTarget({...chat,accountId:undefined,lastSuccessfulOutgoing:{at:'2026-11-01',accountId:'one'}},contact,accounts).accountId,'one');
});
test('no calls for groups, saved items, self, stale account identity or unresolved LIDs',()=>{
 for(const patch of [{isGroup:true},{localOnly:true}])assert.equal(cloneCallTarget({...chat,...patch},contact,accounts),null);
 assert.equal(cloneCallTarget(chat,{...contact,isGroup:true},accounts),null);
 assert.equal(cloneCallTarget(chat,{...contact,phone:accounts[0].phoneE164},accounts),null);
 assert.equal(cloneCallTarget(chat,{id:'bridge-contact-wa1:123456789012345@lid',channelAddress:'123456789012345@lid'},accounts),null);
 assert.equal(cloneCallTarget(chat,contact,[{...accounts[0],phoneE164:'+12025550103'}]),null);
});
test('browser preview cannot pretend to launch a native call',async()=>{await assert.rejects(cloneCallInvoke('clone_call_start',{}),/Windows/);});
test('only WhatsApp voice call links qualify for account-bound dispatch',async()=>{
 assert.equal(isWhatsAppCallLink('https://call.whatsapp.com/voice/Abc_123?x=1'),true);
 for(const url of ['https://evil.example/voice/Abc','http://call.whatsapp.com/voice/Abc','https://call.whatsapp.com/voice/'])assert.equal(isWhatsAppCallLink(url),false);
 assert.equal(await tryOpenBoundCallLink('https://call.whatsapp.com/voice/Abc','one',accounts),false);
});

test('device bindings require a stable known account phone, not its slot ID',()=>{
 assert.equal(cloneCallOwnerPhone(accounts[0]),accounts[0].phoneE164);
 assert.equal(cloneCallOwnerPhone({...accounts[0],phoneE164:undefined}),accounts[0].phoneE164);
 for(const account of [undefined,{id:'one'},{...accounts[0],phoneE164:'+12025550199'},{phoneE164:'123@lid'}])assert.equal(cloneCallOwnerPhone(account),'');
});
const uiMocks={
 react:'export const useState=i=>globalThis.callHooks.state(i),useRef=i=>globalThis.callHooks.ref(i),useEffect=(f,d)=>globalThis.callHooks.effect(f,d);',
 'react/jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
 'lucide-react':'export const Loader2="loader",Phone="phone",X="x",ExternalLink="external",RefreshCw="refresh",Check="check",GripVertical="grip",MoreHorizontal="more",Pencil="pencil",Trash2="trash";',
 '@/i18n':'export const useI18n=()=>({t:(key,args)=>key+(args?JSON.stringify(args):"")});',
 '@/components/ui/primitives':'export const Button="button",OnlineDot="online";',
 '@/components/ui/Avatar':'export const Avatar="avatar";',
 '@/components/settings/BaileysConnectCard':'export const BaileysConnectCard="connection";',
 '@/store/appStore':'export const useAppStore=selector=>selector(globalThis.callStore);',
 '@/lib/cloneCalls':'export const cloneCallInvoke=(...args)=>globalThis.callInvoke(...args),cloneCallOwnerPhone=a=>globalThis.ownerPhone(a);',
};
const {CloneCallButton,AccountSlotCard,useCloneCallBindings}=await bundle(`export {CloneCallButton} from './src/components/chat/CloneCallButton.tsx'; export {useCloneCallBindings} from './src/components/views/CloneCallBinding.tsx'; export {AccountSlotCard} from './src/components/views/AccountSlotCard.tsx';`,uiMocks);
function DeviceCards({accounts,enabled=true}) {
 const clients=useCloneCallBindings(enabled);
 return accounts.map((account,idx)=>AccountSlotCard({account,idx,cloneClients:clients,title:account.label,statusText:'loggedOut'}));
}
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):typeof t?.type==='function'?nodes(t.type(t.props)):t?.props?[t,...nodes(t.props.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):typeof t==='string'?t:'';
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
const app={appId:'KevinLabs.WhatsAppClone3_20wb6qy974p7e!App',name:'Clone 3'};
const app2={appId:'KevinLabs.WhatsAppClone4_20wb6qy974p7e!App',name:'Clone 4'};
const data=()=>({apps:[app,app2],bindings:{[accounts[0].phoneE164]:app.appId,[accounts[1].phoneE164]:app2.appId},verified:{[accounts[0].phoneE164]:app.appId,[accounts[1].phoneE164]:app2.appId}});
function harness(handler,component=CloneCallButton,props={target:cloneCallTarget(chat,contact,accounts)}){
 let slots=[],cursor=0,tree;const effects=[],calls=[],toasts=[],navigation=[];
 globalThis.ownerPhone=cloneCallOwnerPhone;
 globalThis.callInvoke=(cmd,args)=>{calls.push([cmd,args]);return handler(cmd,args);};
 globalThis.callStore={pushToast:(...args)=>toasts.push(args),setActiveNav:nav=>navigation.push(nav)};
 const h={calls,toasts,navigation,render(nextProps=props){
  props=nextProps;cursor=0;
  globalThis.callHooks={
   state(i){const n=cursor++;if(!(n in slots))slots[n]=typeof i==='function'?i():i;return[slots[n],v=>slots[n]=typeof v==='function'?v(slots[n]):v];},
   ref(i){const n=cursor++;return slots[n]??={current:i};},
   effect(f,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i]))effects.push(()=>{old?.cleanup?.();slots[n]={deps,cleanup:f()};});}
  };
  tree=component(props);while(effects.length)effects.shift()();return tree;
 },button(k){return nodes(tree).find(n=>n.type==='button'&&(n.props['aria-label']?.startsWith(k)||text(n)===k));},
 select(id){return nodes(tree).find(n=>n.type==='select'&&n.props.id===`clone-client-${id}`);},
 nodes:()=>nodes(tree),unmount(){slots.forEach(s=>s?.cleanup?.());}};h.render();return h;
}
test('chat button requests one call to the exact recipient through its account, without a configuration dialog',async()=>{
 let finish;const h=harness(async cmd=>cmd==='clone_call_setup'?data():new Promise(r=>finish=r),CloneCallButton,{target:cloneCallTarget(chat,contact,accounts,'two')});
 const click=h.button('cloneCall.action').props.onClick;click();click();await settle();h.render();
 assert.equal(h.calls.length,2);assert.equal(h.calls[1][0],'clone_call_start');
 assert.equal(h.calls[1][1].ownerPhone,accounts[1].phoneE164);assert.equal(h.calls[1][1].recipientPhone,contact.phone);assert.match(h.calls[1][1].requestId,/^[a-f0-9-]{36}$/);
 assert.ok(h.button('cloneCall.action').props.disabled);
 assert.ok(!h.nodes().some(n=>n.props.role==='dialog'));assert.equal(h.button('cloneCall.action').props.onContextMenu,undefined);
 finish();await settle();h.render();assert.equal(h.toasts.at(-1)[1],'success');assert.equal(h.button('cloneCall.action').props.disabled,false);
});
test('unbound or removed clients go to Devices without falling back to another installed client',async()=>{
 for(const setup of [{apps:[app],bindings:{}},{apps:[app2],bindings:data().bindings}]){
  const h=harness(async()=>setup);h.button('cloneCall.action').props.onClick();await settle();
  assert.deepEqual(h.calls,[['clone_call_setup',{}]]);assert.deepEqual(h.navigation,['phones']);assert.match(h.toasts[0][0],/bindInDevices/);
 }
});
test('switching chats during discovery prevents a stale client launch',async()=>{
 let ready;const h=harness(async()=>new Promise(r=>ready=r));h.button('cloneCall.action').props.onClick();h.unmount();ready(data());await settle();assert.equal(h.calls.length,1);assert.equal(h.toasts.length,0);
});
test('failed automatic calling reports the error without retrying or claiming a call',async()=>{
 const h=harness(async cmd=>{if(cmd==='clone_call_setup')return data();throw new Error('Client unavailable');});
 h.button('cloneCall.action').props.onClick();await settle();h.render();assert.deepEqual(h.toasts,[['Client unavailable','error']]);assert.ok(h.nodes().some(n=>n.props.role==='alert'&&text(n).includes('Client unavailable')));h.button('common.close').props.onClick();h.render();assert.ok(!h.nodes().some(n=>n.props.role==='alert'));assert.equal(h.calls.length,2);assert.equal(h.button('cloneCall.action').props.disabled,false);
});
test('account cards share one discovery and each opens its exact client without placing calls',async()=>{
 const h=harness(async cmd=>cmd==='clone_call_setup'?data():undefined,DeviceCards,{accounts});await settle();h.render();
 assert.equal(h.select('one').props.value,app.appId);assert.equal(h.select('two').props.value,app2.appId);
 assert.equal(h.nodes().filter(n=>n.type==='select').length,2);assert.equal(h.nodes().filter(n=>n.props.draggable).length,2);
 assert.equal(nodes(h.select('one')).find(n=>n.type==='option'&&n.props.value===app2.appId).props.disabled,true);
 h.nodes().filter(n=>n.type==='button'&&n.props['aria-label']?.startsWith('cloneCall.openAccount'))[1].props.onClick();await settle();
 assert.deepEqual(h.calls,[['clone_call_setup',{}],['clone_call_open',{appId:app2.appId}]]);
});
test('device selection saves immediately, prevents double writes, and clearing explicitly unbinds',async()=>{
 let finish;const h=harness(async cmd=>cmd==='clone_call_setup'?{apps:[app],bindings:{}}:new Promise(r=>finish=r),DeviceCards,{accounts});await settle();h.render();
 const change=h.select('one').props.onChange;change({target:{value:app.appId}});change({target:{value:app.appId}});h.render();
 assert.ok(h.select('one').props.disabled);assert.equal(h.select('one').props.value,'');
 assert.deepEqual(h.calls.at(-1),['clone_call_bind',{ownerPhone:accounts[0].phoneE164,appId:app.appId}]);assert.equal(h.calls.length,2);
 finish();await settle();h.render();assert.equal(h.select('one').props.value,app.appId);
 h.select('one').props.onChange({target:{value:''}});finish();await settle();h.render();assert.equal(h.select('one').props.value,'');assert.deepEqual(h.calls.at(-1),['clone_call_bind',{ownerPhone:accounts[0].phoneE164,appId:null}]);
});
test('a failed binding change preserves the saved client and can be retried',async()=>{
 let fail=true;const h=harness(async cmd=>{if(cmd==='clone_call_setup')return data();if(fail)throw new Error('Disk write failed');},DeviceCards,{accounts});await settle();h.render();
 h.select('one').props.onChange({target:{value:''}});await settle();h.render();assert.equal(h.select('one').props.value,app.appId);assert.deepEqual(h.toasts,[['Disk write failed','error']]);
 fail=false;h.select('one').props.onChange({target:{value:''}});await settle();h.render();assert.equal(h.select('one').props.value,'');assert.equal(h.toasts.length,1);
});
test('Devices refreshes missing clients, disables unknown identities, and keeps account bindings through reordering',async()=>{
 let setup={...data(),apps:[]};const h=harness(async()=>setup,DeviceCards,{accounts:[...accounts,{id:'unknown',label:'3'}]});await settle();h.render();
 assert.ok(h.select('unknown').props.disabled);assert.equal(h.select('one').props.value,app.appId);assert.ok(h.nodes().some(n=>n.type==='option'&&text(n)==='cloneCall.missing'));
 setup=data();h.button('cloneCall.refresh').props.onClick();h.render();await settle();h.render({accounts:[accounts[1],accounts[0]]});
 assert.equal(h.calls.length,2);assert.equal(h.select('one').props.value,app.appId);assert.equal(h.select('two').props.value,app2.appId);
});
test('late device discovery after unmount does not populate stale bindings',async()=>{
 let ready;const h=harness(async()=>new Promise(r=>ready=r),DeviceCards,{accounts});h.unmount();ready(data());await settle();h.render();assert.equal(h.select('one').props.value,'');
});
test('binding a client on one card disables it on the other, and unbinding releases it',async()=>{
 const h=harness(async cmd=>cmd==='clone_call_setup'?{apps:[app],bindings:{}}:undefined,DeviceCards,{accounts});await settle();h.render();
 h.select('one').props.onChange({target:{value:app.appId}});await settle();h.render();
 assert.equal(nodes(h.select('two')).find(n=>n.type==='option'&&n.props.value===app.appId).props.disabled,true);
 h.select('two').props.onChange({target:{value:app.appId}});await settle();assert.equal(h.calls.length,2);
 h.select('one').props.onChange({target:{value:''}});await settle();h.render();
 assert.equal(nodes(h.select('two')).find(n=>n.type==='option'&&n.props.value===app.appId).props.disabled,false);
 h.select('two').props.onChange({target:{value:app.appId}});await settle();h.render();
 assert.equal(h.select('one').props.value,'');assert.equal(h.select('two').props.value,app.appId);
 assert.deepEqual(h.calls.at(-1),['clone_call_bind',{ownerPhone:accounts[1].phoneE164,appId:app.appId}]);
});
test('hidden account tab cancels stale discovery and refreshes when reopened',async()=>{
 let ready;const h=harness(async()=>new Promise(r=>ready=r),DeviceCards,{accounts,enabled:false});assert.equal(h.calls.length,0);
 h.render({accounts});assert.equal(h.calls.length,1);h.render({accounts,enabled:false});ready(data());await settle();h.render();assert.equal(h.select('one').props.value,'');
 h.render({accounts});assert.equal(h.calls.length,2);ready(data());await settle();h.render();assert.equal(h.select('one').props.value,app.appId);
});
test('official WhatsApp can be bound on a card and used for calling from that account',async()=>{
 const official={appId:'5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App',name:'WhatsApp'};
 const setup={apps:[official],bindings:{},verified:{}};
 const handler=async(cmd,args)=>{
  if(cmd==='clone_call_setup')return setup;
  if(cmd==='clone_call_bind')setup.bindings[args.ownerPhone]=args.appId;
  if(cmd==='clone_call_verify')setup.verified[args.ownerPhone]=setup.bindings[args.ownerPhone];
 };
 const h=harness(handler,DeviceCards,{accounts});await settle();h.render();
 assert.ok(nodes(h.select('one')).some(n=>n.type==='option'&&n.props.value===official.appId));
 h.select('one').props.onChange({target:{value:official.appId}});await settle();h.render();
 assert.equal(h.select('one').props.value,official.appId);
 assert.equal(nodes(h.select('two')).find(n=>n.type==='option'&&n.props.value===official.appId).props.disabled,true);
 h.button('cloneCall.verify').props.onClick();await settle();h.render();
 h.unmount();
 const chatButton=harness(handler);chatButton.button('cloneCall.action').props.onClick();await settle();
 assert.equal(chatButton.calls.length,2);assert.equal(chatButton.calls[1][0],'clone_call_start');assert.equal(chatButton.calls[1][1].ownerPhone,accounts[0].phoneE164);assert.equal(chatButton.calls[1][1].recipientPhone,contact.phone);
});
test('cancelling call preparation or switching chats cancels only this request and suppresses late success',async()=>{
 for(const unmount of [false,true]){
  let finish;const h=harness(async cmd=>cmd==='clone_call_setup'?data():cmd==='clone_call_start'?new Promise(r=>finish=r):undefined);
  h.button('cloneCall.action').props.onClick();await settle();h.render();
  const requestId=h.calls[1][1].requestId;
  if(unmount)h.unmount();else h.button('cloneCall.cancel').props.onClick();
  await settle();assert.deepEqual(h.calls.at(-1),['clone_call_cancel',{requestId}]);finish();await settle();h.render();assert.equal(h.toasts.length,0);
 }
});
test('cancelling discovery never starts a late call or claims that it was cancelled on the network',async()=>{
 let ready;const h=harness(async()=>new Promise(r=>ready=r));h.button('cloneCall.action').props.onClick();h.render();h.button('cloneCall.cancel').props.onClick();ready(data());await settle();h.render();assert.equal(h.calls.length,1);assert.equal(h.toasts.length,0);assert.equal(h.button('cloneCall.action').props.disabled,false);
});

test('bound but unverified accounts cannot call and go to Devices without opening a client',async()=>{
 const h=harness(async()=>({...data(),verified:{}}));h.button('cloneCall.action').props.onClick();await settle();
 assert.deepEqual(h.calls,[['clone_call_setup',{}]]);assert.deepEqual(h.navigation,['phones']);assert.match(h.toasts[0][0],/verifyInDevices/);
});

test('device verification is explicit, unlocks only after success, and rebinding clears it',async()=>{
 let finish;const h=harness(async cmd=>cmd==='clone_call_setup'?{...data(),verified:{}}:cmd==='clone_call_verify'?new Promise(r=>finish=r):undefined,DeviceCards,{accounts});
 await settle();h.render();h.button('cloneCall.verify').props.onClick();h.render();
 assert.deepEqual(h.calls.at(-1),['clone_call_verify',{ownerPhone:accounts[0].phoneE164}]);
 assert.ok(!h.nodes().some(n=>text(n)==='cloneCall.verified'));finish();await settle();h.render();
 assert.ok(h.nodes().some(n=>text(n)==='cloneCall.verified'));
 h.select('one').props.onChange({target:{value:''}});await settle();h.render();
 assert.ok(!h.nodes().some(n=>text(n)==='cloneCall.verified'));
});

test('failed re-verification revokes the old verified indicator',async()=>{
 const h=harness(async cmd=>{if(cmd==='clone_call_setup')return data();throw Error('Wrong phone');},DeviceCards,{accounts:[accounts[0]]});
 await settle();h.render();assert.ok(h.nodes().some(n=>text(n)==='cloneCall.verified'));
 h.button('cloneCall.verify').props.onClick();await settle();h.render();
 assert.ok(!h.nodes().some(n=>text(n)==='cloneCall.verified'));assert.deepEqual(h.toasts,[['Wrong phone','error']]);
});
