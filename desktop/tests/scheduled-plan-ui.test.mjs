import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks={
 react:'export const useState=i=>globalThis.planHooks.state(i);export const useRef=i=>globalThis.planHooks.ref(i);export const useMemo=f=>f();export const useEffect=()=>{};',
 'react/jsx-runtime':'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
 '@/components/ui/primitives':'export const Input="input",Button="button",Textarea="textarea";',
 '@/store/appStore':'export const useAppStore=f=>f(globalThis.planState);useAppStore.getState=()=>globalThis.planState;useAppStore.setState=patch=>Object.assign(globalThis.planState,patch);export const flushPersist=async()=>{if(globalThis.planState.failPersist)throw Error("disk full");globalThis.planState.persisted++;};',
 '@/i18n':'export const useI18n=()=>({t:(k,p)=>k+(p?JSON.stringify(p):""),locale:"en"});export const translateCurrent=k=>k;',
};
const built=await build({stdin:{contents:`export {ScheduledPlanDialog} from './src/components/chat/ScheduledPlanDialog.tsx';export {ScheduledPlansPanel} from './src/components/settings/ScheduledPlansPanel.tsx';export {saveScheduledPlan} from './src/lib/scheduledPlanActions.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'plan-ui-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ScheduledPlanDialog,ScheduledPlansPanel,saveScheduledPlan}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=scheduled-plan-ui-test-bundle.js').toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const media={dataUrl:'data:image/png;base64,AA==',mimeType:'image/png',fileName:'template.png',kind:'image',size:1};
const future=()=>new Date(Date.now()+3600000).toISOString();
function fixture(){
 const state={hydrated:true,uiReady:true,persisted:0,chats:[{id:'one',contactId:'c1',accountId:'a'},{id:'two',contactId:'c2',accountId:'a'}],contacts:[{id:'c1',name:'One',phone:'',channelAddress:'12345@g.us',accountId:'a'},{id:'c2',name:'Two',phone:'+12025550123',accountId:'a'}],settings:{waAccounts:[{id:'a',label:'Account A'}],quickReplies:[{id:'template',title:'Welcome',body:'Original template',category:'other',media:{...media}}],scheduledPlans:[],chatFolderClones:[],chatFolders:[{id:'root',chatIds:['one'],scope:{type:'account',accountId:'a'}},{id:'child',parentId:'root',chatIds:['two'],scope:{type:'account',accountId:'a'}}]},
  updateSettings(patch){state.settings={...state.settings,...patch};},pushToast(){},requestConfirm:async()=>true};
 state.broadcastCampaigns=[];globalThis.planState=state;return state;
}
function harness(component,props={}){
 const state=fixture();let slots=[],cursor=0,tree,closed=0;
 globalThis.planHooks={state(i){const at=cursor++;if(!(at in slots))slots[at]=typeof i==='function'?i():i;return [slots[at],v=>{slots[at]=typeof v==='function'?v(slots[at]):v;}];},ref(i){const at=cursor++;return slots[at]??(slots[at]={current:i});}};
 const h={state,get closed(){return closed;},render(){cursor=0;tree=component({...props,onClose(){closed++;}});return tree;},nodes:()=>nodes(tree),
 find(label){return h.nodes().find(n=>n.props.children===label||n.props['aria-label']===label);},
 async click(label){const n=h.find(label);assert.ok(n,'missing '+label);assert.ok(!n.props.disabled,'disabled '+label);await n.props.onClick();for(let i=0;i<12;i++)await Promise.resolve();h.render();},
 async submit(){h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});for(let i=0;i<12;i++)await Promise.resolve();h.render();},
 };h.render();return h;
}

test('folder schedule selects only its own chats, can explicitly include children, and previews a frozen template',async()=>{
 const h=harness(ScheduledPlanDialog,{folderId:'root'});
 const checked=()=>h.nodes().filter(n=>n.props.type==='checkbox'&&n.props.checked).length;
 assert.equal(checked(),2,'one recipient plus the select-page checkbox');
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'template'}});h.render();
 h.nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'Edited just for this plan'}});
 h.find('planQueue.includeChildren').props.onChange({target:{checked:true}});h.render();
 assert.equal(checked(),4,'child toggle, select-page, and both recipients');
 await h.submit();assert.ok(h.find('planQueue.confirm'));assert.equal(h.state.settings.scheduledPlans.length,0,'preview does not schedule');
 await h.submit();assert.equal(h.closed,1);assert.equal(h.state.persisted,1);
 const p=h.state.settings.scheduledPlans[0];assert.equal(p.items.length,2);assert.equal(p.items[0].recipient,'12345@g.us');
 assert.equal(p.text,'Edited just for this plan');assert.equal(p.media.fileName,'template.png');assert.equal(p.status,'pending');
 h.state.settings.quickReplies[0].body='CHANGED TEMPLATE';h.state.settings.quickReplies[0].media.fileName='changed.png';
 assert.equal(p.text,'Edited just for this plan');assert.equal(p.media.fileName,'template.png');
});

test('folder bulk send previews without sending and queues immediately only after explicit confirmation',async()=>{
 const h=harness(ScheduledPlanDialog,{folderId:'root',initialStartNow:true});
 assert.equal(h.nodes().some(n=>n.props['aria-label']==='planQueue.startTime'),false);
 assert.equal(h.state.settings.scheduledPlans.length,0);
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'template'}});h.render();
 await h.submit();assert.ok(h.find('planQueue.confirmBulk'));assert.equal(h.state.settings.scheduledPlans.length,0);
 const before=Date.now();await h.submit();const p=h.state.settings.scheduledPlans[0];
 assert.equal(p.status,'pending');assert.ok(Date.parse(p.dueAt)>=before&&Date.parse(p.dueAt)<=Date.now());
 assert.equal(p.gapSec,30);assert.equal(p.items.length,1);assert.equal(p.items[0].chatId,'one');
 assert.equal(p.media.fileName,'template.png');assert.equal(h.closed,1);
});

test('folder bulk can switch to scheduled mode without changing recipients, media or pacing protection',async()=>{
 const h=harness(ScheduledPlanDialog,{folderId:'root',initialStartNow:true});
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'template'}});h.render();
 await h.click('scheduled.title');assert.ok(h.nodes().some(n=>n.props.type==='datetime-local'));
 await h.submit();assert.ok(h.find('planQueue.confirm'));await h.submit();
 assert.ok(Date.parse(h.state.settings.scheduledPlans[0].dueAt)>Date.now());
 assert.equal(h.state.settings.scheduledPlans[0].items[0].chatId,'one');assert.equal(h.state.settings.scheduledPlans[0].gapSec,30);
});

test('invalid pace, changed target ownership and persistence failures cannot create runnable plans',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});
 const base={title:'test',text:'text',dueAt:future(),timeZone:'Europe/Paris',gapSec:30,items:[{id:'one',chatId:'one',contactId:'c1',contactName:'One',recipient:'12345@g.us',accountId:'a',status:'pending'}]};
 await assert.rejects(saveScheduledPlan({...base,gapSec:0}),/invalidTime/);
 await assert.rejects(saveScheduledPlan({...base,items:[{...base.items[0],accountId:'b'}]}),/targetsChanged/);
 assert.equal(h.state.settings.scheduledPlans.length,0);
 h.state.failPersist=true;await assert.rejects(saveScheduledPlan(base),/disk full/);assert.equal(h.state.settings.scheduledPlans.length,0);
 h.state.failPersist=false;h.state.hydrated=false;await assert.rejects(saveScheduledPlan(base),/restoring/);
});

test('native time and number edits committed on submit are used in both preview and saved plan',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'template'}});h.render();
 const chosenTime=new Date(Date.now()+86400000).toISOString().slice(0,16);
 h.nodes().find(n=>n.props.type==='datetime-local').props.ref.current={value:chosenTime};
 h.nodes().find(n=>n.props.type==='number').props.ref.current={value:'45'};
 await h.submit();await h.submit();
 assert.equal(h.state.settings.scheduledPlans[0].dueAt,new Date(chosenTime).toISOString());assert.equal(h.state.settings.scheduledPlans[0].gapSec,45);
});

test('choosing a template cancels a stale attachment read rather than overwriting the template attachment',()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});const original=globalThis.FileReader;let reader;
 globalThis.FileReader=class{constructor(){reader=this;}readAsDataURL(){}abort(){}};
 try{
 h.nodes().find(n=>n.props.type==='file').props.onChange({target:{files:[{name:'stale.png',type:'image/png',size:1}]},currentTarget:{value:''}});h.render();
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'template'}});h.render();
 reader.result='data:image/png;base64,AA==';reader.onload();h.render();
 assert.ok(h.nodes().some(n=>n.props.alt==='template.png'));assert.equal(h.nodes().some(n=>n.props.alt==='stale.png'),false);
 }finally{globalThis.FileReader=original;}
});

test('plan management pauses and resumes without retrying uncertain items, and cancellation keeps sent history',async()=>{
 const h=harness(ScheduledPlansPanel);const p={id:'plan',title:'Plan',text:'Body',dueAt:future(),createdAt:future(),startedAt:future(),gapSec:30,status:'running',items:[
 {id:'one',chatId:'one',accountId:'a',contactName:'One',status:'sent'},
 {id:'unknown',chatId:'unknown',accountId:'a',contactName:'Unknown',status:'unknown'},
 {id:'two',chatId:'two',accountId:'a',contactName:'Two',status:'pending'}]};h.state.settings.scheduledPlans=[p];h.render();
 await h.click('planQueue.pause');assert.equal(h.state.settings.scheduledPlans[0].status,'paused');
 await h.click('planQueue.resume');assert.equal(h.state.settings.scheduledPlans[0].status,'running');
 assert.equal(h.state.settings.scheduledPlans[0].items[1].status,'unknown');
 await h.click('planQueue.cancel');assert.equal(h.state.settings.scheduledPlans[0].status,'cancelled');
 assert.deepEqual(h.state.settings.scheduledPlans[0].items.map(i=>i.status),['sent','unknown','cancelled']);
});

test('item removal and explicit retry affect only the reviewed item',async()=>{
 const h=harness(ScheduledPlansPanel);h.state.settings.scheduledPlans=[{id:'plan',title:'Plan',text:'Body',dueAt:future(),createdAt:future(),gapSec:30,status:'paused',items:[
 {id:'one',chatId:'one',accountId:'a',contactName:'One',status:'unknown',messageId:'old'},
 {id:'two',chatId:'two',accountId:'a',contactName:'Two',status:'pending'}]}];h.render();
 await h.click('planQueue.details');await h.click('planQueue.removeTarget');
 assert.equal(h.state.settings.scheduledPlans[0].items[1].status,'cancelled');
 await h.click('planQueue.reviewRetry');assert.equal(h.state.settings.scheduledPlans[0].items[0].status,'pending');
 assert.equal(h.state.settings.scheduledPlans[0].items[0].messageId,undefined);assert.equal(h.state.settings.scheduledPlans[0].status,'paused');
});

test('rescheduling a paused plan keeps its sent items and queues only remaining work at the new time',async()=>{
 const h=harness(ScheduledPlansPanel);h.state.settings.scheduledPlans=[{id:'plan',title:'Plan',text:'Frozen',dueAt:future(),createdAt:future(),startedAt:future(),gapSec:30,status:'paused',items:[{id:'one',status:'sent'},{id:'two',status:'pending'}]}];h.render();
 await h.click('scheduled.replan');const value=new Date(Date.now()+86400000).toISOString().slice(0,16);
 h.nodes().find(n=>n.props.type==='datetime-local').props.onInput({currentTarget:{value}});h.render();
 await h.click('dialog.save');const p=h.state.settings.scheduledPlans[0];
 assert.equal(p.dueAt,new Date(value).toISOString());assert.equal(p.status,'pending');assert.equal(p.startedAt,undefined);
 assert.deepEqual(p.items.map(i=>i.status),['sent','pending']);assert.equal(p.text,'Frozen');
});

test('sequence editor preserves text, order and gaps through preview and save',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});
 h.nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'first'}});h.render();
 await h.click('planQueue.addStep');
 h.find('planQueue.stepText{"number":2}').props.onChange({target:{value:'second'}});h.render();
 h.find('planQueue.stepGap{"number":2}').props.onInput({currentTarget:{value:'45'}});h.render();
 await h.click('planQueue.moveUp');
 assert.equal(h.nodes().find(n=>n.type==='textarea').props.value,'second');
 await h.submit();await h.submit();
 const p=h.state.settings.scheduledPlans[0];assert.equal(p.text,'second');assert.equal(p.gapSec,45);assert.equal(p.steps[0].text,'first');assert.equal(p.steps[0].gapSec,30);
});

test('a duplicate requires an additional visible confirmation and newly added conflicts are rechecked',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});
 h.nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'same'}});h.render();
 const base={id:'existing',title:'Existing',text:'same',dueAt:future(),createdAt:future(),timeZone:'Europe/Paris',gapSec:30,status:'pending',items:[{id:'one',chatId:'one',contactId:'c1',accountId:'a',recipient:'12345@g.us',status:'pending'}]};
 h.state.settings.scheduledPlans=[base];
 await h.submit();await h.submit();assert.equal(h.closed,0);assert.equal(h.state.settings.scheduledPlans.length,1);assert.ok(h.find('planQueue.confirmDuplicate'));
 h.state.settings.scheduledPlans.push({...base,id:'arrived-during-review'});
 await h.submit();assert.equal(h.closed,0);assert.equal(h.state.settings.scheduledPlans.length,2);
 await h.submit();assert.equal(h.closed,1);assert.equal(h.state.settings.scheduledPlans.length,3);
});

test('native audio with text is previewed and saved as separate ordered messages',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});
 h.state.settings.quickReplies[0].media={...media,kind:'audio',mimeType:'audio/mpeg',dataUrl:'data:audio/mpeg;base64,AA=='};
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'template'}});h.render();
 const label=h.nodes().find(n=>Array.isArray(n.props.children)&&n.props.children.includes('planQueue.nativeMedia'));
 nodes(label).find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();
 await h.submit();assert.ok(h.nodes().some(n=>Array.isArray(n.props.children)&&n.props.children.includes('planQueue.stepNumber{"number":2}')));
 await h.submit();const p=h.state.settings.scheduledPlans[0];assert.equal(p.media,undefined);assert.equal(p.text,'Original template');assert.equal(p.steps[0].text,'');assert.equal(p.steps[0].media.kind,'audio');assert.equal(p.nativeMedia,true);
});

test('deadlines and quiet hours are persisted and invalid deadlines cannot be submitted',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one'],initialStartNow:true});
 h.nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'message'}});h.render();
 const deadline=new Date(Date.now()+86400000).toISOString().slice(0,16);
 h.nodes().find(n=>n.props.type==='datetime-local').props.onInput({currentTarget:{value:deadline}});
 const quietLabel=h.nodes().find(n=>Array.isArray(n.props.children)&&n.props.children.includes('planQueue.quietHours'));
 nodes(quietLabel).find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();
 await h.submit();await h.submit();const p=h.state.settings.scheduledPlans[0];assert.equal(p.endAt,new Date(deadline).toISOString());assert.deepEqual(p.quietHours,{start:'22:00',end:'08:00'});
});

test('reusing an existing sequence copies content without copying its recipient progress',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});
 h.state.settings.scheduledPlans=[{id:'template-plan',title:'Sequence',text:'first',steps:[{text:'second'}],status:'done',nativeMedia:true}];
 h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'plan:template-plan'}});h.render();await h.submit();await h.submit();
 const p=h.state.settings.scheduledPlans[1];assert.equal(p.text,'first');assert.equal(p.steps[0].text,'second');assert.equal(p.items[0].stepIndex,0);assert.equal(p.status,'pending');
});

test('a late confirmed receipt advances a reviewed unknown step instead of re-sending it',async()=>{
 const h=harness(ScheduledPlansPanel);h.state.messages=[{id:'late-receipt',accountId:'a',deliveryStatus:'delivered'}];
 h.state.settings.scheduledPlans=[{id:'plan',title:'Plan',text:'first',steps:[{text:'second'}],dueAt:future(),createdAt:future(),gapSec:30,status:'paused',items:[{id:'one',accountId:'a',contactName:'One',status:'unknown',messageId:'late-receipt',stepIndex:0}]}];h.render();
 await h.click('planQueue.details');await h.click('planQueue.reviewRetry');const i=h.state.settings.scheduledPlans[0].items[0];assert.equal(i.stepIndex,1);assert.equal(i.status,'pending');assert.deepEqual(i.messageIds,['late-receipt']);assert.equal(i.messageId,undefined);assert.equal(h.state.settings.scheduledPlans[0].status,'paused');
});

test('invalid step intervals, excessive sequences and invalid deadlines are rejected by save boundaries',async()=>{
 const h=harness(ScheduledPlanDialog,{chatIds:['one']});const base={title:'test',text:'text',dueAt:future(),timeZone:'Europe/Paris',gapSec:30,items:[{id:'one',chatId:'one',contactId:'c1',accountId:'a',recipient:'12345@g.us'}]};
 await assert.rejects(saveScheduledPlan({...base,steps:[{text:'second',gapSec:1}]}),/invalidContent/);
 await assert.rejects(saveScheduledPlan({...base,steps:Array.from({length:20},()=>({text:'step'}))}),/invalidContent/);
 await assert.rejects(saveScheduledPlan({...base,endAt:new Date(Date.now()).toISOString()}),/invalidDeadline/);
 await assert.rejects(saveScheduledPlan({...base,quietHours:{start:'22:00',end:'22:00'}}),/invalidTime/);
 assert.equal(h.state.settings.scheduledPlans.length,0);
});

test('moving a plan to the front preserves its timing, cooldown and step progress',async()=>{
 const h=harness(ScheduledPlansPanel);const date=future();
 h.state.settings.scheduledPlans=['a','b'].map(id=>({id,title:id,text:'first',dueAt:date,createdAt:date,timeZone:'Europe/Paris',status:'pending',gapSec:30,cooldownUntil:date,steps:[{text:'second'}],items:[{id,accountId:'a',status:'pending',stepIndex:1,messageIds:['already-sent']}]}));h.render();
 const buttons=h.nodes().filter(n=>n.props.children==='planQueue.prioritize');await buttons[1].props.onClick();for(let i=0;i<12;i++)await Promise.resolve();h.render();
 const p=h.state.settings.scheduledPlans[1];assert.equal(p.priority,1);assert.equal(p.dueAt,date);assert.equal(p.cooldownUntil,date);assert.equal(p.items[0].stepIndex,1);assert.deepEqual(p.items[0].messageIds,['already-sent']);
});

test('a cancelled plan with an unknown in-flight result stays visible for review without reactivating it',async()=>{
 const h=harness(ScheduledPlansPanel);h.state.settings.scheduledPlans=[{id:'cancelled',title:'Cancelled',text:'text',dueAt:future(),createdAt:future(),gapSec:30,status:'cancelled',error:'planQueue.cancelledUnknown',items:[{id:'one',accountId:'a',contactName:'One',status:'unknown',messageId:'inflight'}]}];h.render();
 await h.click('settingsScheduled.filter.failed');assert.ok(h.find('planQueue.cancelledUnknown'));
 await h.click('planQueue.details');assert.equal(h.find('planQueue.reviewRetry'),undefined);assert.equal(h.find('planQueue.resume'),undefined);assert.equal(h.state.settings.scheduledPlans[0].status,'cancelled');
});
