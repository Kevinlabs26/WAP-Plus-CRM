import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({stdin:{contents:`export * from './src/lib/scheduledPlans.ts';export * from './src/lib/scheduledPlanRunner.ts';export {normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {buildSettingsSafe,parseBackupJson} from './src/lib/exportData.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {createScheduledPlanRunner,normalizeScheduledPlans,scheduledPlanTargets,scheduledFolderChatIds,normalizeLoadedSettings,buildSettingsSafe,parseBackupJson,activePlanStep,inQuietHours,nextBatchTask}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=scheduled-plans-test-bundle.js').toString('base64'));
const origin=Date.parse('2026-10-31T10:00:00Z');
const iso=time=>new Date(time).toISOString();
const item=(id,accountId='a')=>({id,chatId:id,contactId:id,contactName:id,accountId,recipient:'12025'+id.replace(/\D/g,'').padStart(6,'0'),status:'pending'});
const plan=(id,items=[item('1'),item('2')],extra={})=>({id,title:id,text:'FROZEN TEXT',dueAt:iso(origin),createdAt:iso(origin-1000),timeZone:'Europe/Paris',gapSec:30,status:'pending',items,...extra});
function harness(plans,extra={}) {
 let time=origin,calls=[],persisted=[],finishes=[];
 const h={plans,advance(ms){time+=ms;},calls,persisted,finishes,
   options:{plans:()=>h.plans,ready:()=>true,now:()=>time,
    update:async(id,change)=>{h.plans=h.plans.map(p=>p.id===id?change(p):p);persisted.push(structuredClone(h.plans));},
    availability:()=> 'ready',enqueue:(_,i)=>'out-'+i.id,
    send:async(p,i,canSend)=>{assert.equal(canSend(),true);calls.push([p.id,i.id,time]);return {ok:true};},
    finish:(id,r)=>finishes.push([id,r]),...extra}};
 h.runner=createScheduledPlanRunner(h.options);return h;
}

test('each recipient finishes all ordered steps before the next, with a durable cursor and per-step cooldown',async()=>{
 let count=0;const sent=[];
 const h=harness([plan('sequence',undefined,{text:'intro',steps:[{text:'image',gapSec:45},{text:'closing'}]})],{
  enqueue:()=>`out-${++count}`,send:async(p,i)=>{sent.push([i.id,activePlanStep(p,i).text]);return {ok:true};}
 });
 await h.runner.tick();assert.equal(h.plans[0].items[0].stepIndex,1);assert.equal(h.plans[0].items[0].status,'pending');
 h.advance(30000);await h.runner.tick();h.advance(30000);await h.runner.tick();assert.equal(sent.length,2);
 h.advance(15000);await h.runner.tick();assert.equal(h.plans[0].items[0].status,'sent');
 h.advance(30000);await h.runner.tick();assert.deepEqual(sent,[['1','intro'],['1','image'],['1','closing'],['2','intro']]);
 assert.deepEqual(h.plans[0].items[0].messageIds,['out-1','out-2','out-3']);
});

test('an unknown middle step pauses without replaying already completed steps after restart',async()=>{
 let attempts=0;const h=harness([plan('sequence',[item('1')],{steps:[{text:'second'},{text:'last'}]})],{
 send:async()=>++attempts===1?{ok:true}:{ok:false,uncertain:true,message:'lost response'}
 });
 await h.runner.tick();h.advance(30000);await h.runner.tick();
 assert.equal(h.plans[0].status,'paused');assert.equal(h.plans[0].items[0].stepIndex,1);assert.equal(h.plans[0].items[0].status,'unknown');
 const restored=normalizeScheduledPlans(h.plans);assert.equal(restored[0].items[0].stepIndex,1);assert.equal(restored[0].steps.length,2);
 h.advance(60000);await h.runner.tick();assert.equal(attempts,2);
});

test('cancelling a sequence during its second request keeps the truthful result and cancels remaining steps',async()=>{
 let h,attempts=0;h=harness([plan('sequence',[item('1')],{steps:[{text:'second'},{text:'last'}]})],{
 send:async()=>{if(++attempts===2)h.plans[0].status='cancelled';return {ok:true};}
 });
 await h.runner.tick();h.advance(30000);await h.runner.tick();assert.equal(h.plans[0].items[0].stepIndex,2);
 assert.equal(h.plans[0].items[0].status,'cancelled');h.advance(30000);await h.runner.tick();assert.equal(attempts,2);
});

test('moving another task to the front cannot interleave the current recipient sequence',async()=>{
 const calls=[];const h=harness([plan('a',[item('1')],{status:'running',steps:[{text:'second'}]}),plan('b',[item('1')],{status:'running'})],{
 send:async(p,i)=>{calls.push([p.id,i.stepIndex||0]);return {ok:true};}
 });
 h.options.hasTurn=id=>nextBatchTask(h.plans,[],origin+calls.length*30000)===id;h.runner=createScheduledPlanRunner(h.options);
 await h.runner.tick();h.plans[1].priority=100;h.advance(30000);await h.runner.tick();h.advance(30000);await h.runner.tick();
 assert.deepEqual(calls,[['a',0],['a',1],['b',0]]);
});

test('an in-flight first step owns the batch turn against higher-priority legacy work',async()=>{
 let h,winner;h=harness([plan('a',[item('1')],{steps:[{text:'second'}]})],{send:async()=>{
 const legacy={id:'legacy',status:'running',priority:100,createdAt:iso(origin)};
 winner=nextBatchTask(h.plans,[legacy],origin);return {ok:true};
 }});await h.runner.tick();assert.equal(winner,'a');assert.equal(h.plans[0].items[0].stepIndex,1);
});

test('sequence ownership survives normal cooldowns but respects explicit pause and quiet hours',()=>{
 const a=plan('a',[{...item('1'),stepIndex:1}],{status:'running',steps:[{text:'second'}],nextAttemptAt:iso(origin+60000)});
 const b=plan('b',[item('2')],{status:'running',priority:100});
 assert.equal(nextBatchTask([a,b],[],origin),'a');a.status='paused';assert.equal(nextBatchTask([a,b],[],origin),'b');
 a.status='running';a.quietHours={start:'09:00',end:'11:00'};a.timeZone='UTC';assert.equal(nextBatchTask([a,b],[],origin),'b');
});

test('reconnection does not steal the turn from a sequence started during the offline wait',async()=>{
 let offline=false;const calls=[];
 const h=harness([plan('a',[item('1')],{steps:[{text:'a second'}]}),plan('b',[item('2','b')],{steps:[{text:'b second'}]})],{
 availability:i=>i.id==='1'&&offline?'offline':'ready',send:async(p,i)=>{calls.push([p.id,i.stepIndex||0]);return {ok:true};}
 });
 await h.runner.tick();offline=true;h.advance(30000);await h.runner.tick();await h.runner.tick();
 offline=false;h.advance(30000);await h.runner.tick();h.advance(30000);await h.runner.tick();
 assert.deepEqual(calls,[['a',0],['b',0],['b',1],['a',1]]);
});

test('a partially sent sequence in quiet hours allows another plan to run',async()=>{
 const h=harness([plan('a',[{...item('1'),stepIndex:1,sequenceActivityAt:iso(origin-60000)}],{status:'running',steps:[{text:'second'}],timeZone:'UTC',quietHours:{start:'09:00',end:'11:00'}}),plan('b',[item('2')])]);
 await h.runner.tick();await h.runner.tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'b');assert.equal(h.plans[0].items[0].stepIndex,1);
});

for(const throwing of [false,true])test(`cancellation preserves an unknown in-flight result (${throwing?'exception':'response'})`,async()=>{
 let h;h=harness([plan('a')],{send:async()=>{h.plans[0].status='cancelled';if(throwing)throw Error('response lost');return {ok:false,uncertain:true,message:'response lost'};}});
 await h.runner.tick();assert.equal(h.plans[0].status,'cancelled');assert.equal(h.plans[0].items[0].status,'unknown');assert.equal(h.finishes[0][1].uncertain,true);assert.equal(h.plans[0].error,'planQueue.cancelledUnknown');
 const restored=normalizeScheduledPlans(h.plans);assert.equal(restored[0].status,'cancelled');assert.equal(restored[0].items[0].status,'unknown');
});

test('offline and quiet-hour waits allow another eligible task to proceed while retaining order within a plan',async()=>{
 const h=harness([plan('a',[item('1')]),plan('b',[item('2')])],{availability:i=>i.id==='1'?'offline':'ready'});
 await h.runner.tick();await h.runner.tick();assert.equal(h.calls[0][0],'b');assert.equal(h.plans[0].items[0].status,'pending');
 const quiet=harness([plan('a',[item('1')],{timeZone:'UTC',quietHours:{start:'09:00',end:'11:00'}}),plan('b',[item('2')])]);
 await quiet.runner.tick();await quiet.runner.tick();assert.equal(quiet.calls[0][0],'b');
 quiet.advance(3600000);await quiet.runner.tick();assert.equal(quiet.calls[1][0],'a');
 assert.equal(inQuietHours({timeZone:'Europe/Paris',quietHours:{start:'22:00',end:'08:00'}},Date.parse('2026-10-31T22:00:00Z')),true);
 assert.equal(inQuietHours({timeZone:'UTC',quietHours:{start:'22:00',end:'08:00'}},Date.parse('2026-10-31T08:00:00Z')),false);
});

test('deadline stops waiting work and an in-flight result remains truthful after the deadline',async()=>{
 const expired=harness([plan('deadline',undefined,{endAt:iso(origin-1)})]);await expired.runner.tick();assert.equal(expired.calls.length,0);assert.equal(expired.plans[0].status,'expired');
 let h;h=harness([plan('deadline',undefined,{endAt:iso(origin+10000)})],{send:async()=>{h.advance(15000);return {ok:true};}});
 await h.runner.tick();assert.equal(h.plans[0].status,'expired');assert.equal(h.plans[0].items[0].status,'sent');assert.equal(h.plans[0].items[1].status,'pending');
 await h.runner.tick();assert.equal(h.finishes.length,1);
});

test('legacy and scheduled work share priority without bypassing due times or quiet hours',()=>{
 const p=plan('plan',undefined,{status:'running'}),legacy={id:'legacy',createdAt:iso(origin),startedAt:iso(origin),status:'running',priority:2};
 assert.equal(nextBatchTask([p],[legacy],origin),'legacy');
 p.priority=3;assert.equal(nextBatchTask([p],[legacy],origin),'plan');
 p.status='pending';p.dueAt=iso(origin+60000);assert.equal(nextBatchTask([p],[legacy],origin),'legacy');
 p.status='running';p.quietHours={start:'09:00',end:'12:00'};p.timeZone='UTC';assert.equal(nextBatchTask([p],[legacy],origin),'legacy');
});

test('invalid saved sequence cursors and time windows remain blocked after normalization',()=>{
 for(const extra of [{steps:[{text:'second'}],items:[{...item('1'),stepIndex:-1}]},{quietHours:{start:'22:00',end:'22:00'}},{endAt:'invalid date'}]){
 const restored=normalizeScheduledPlans([plan('invalid',undefined,extra)])[0];assert.equal(restored.status,'paused');assert.equal(restored.mediaUnavailable,true);
 }
});

test('the maximum 1000-recipient, 20-step sequence completes in order under simulated time', {timeout:15000},async()=>{
 const targets=Array.from({length:1000},(_,i)=>item(String(i)));
 let plans=[plan('scale',targets,{steps:Array.from({length:19},(_,i)=>({text:'step '+(i+2)}))})];
 let clock=origin,sends=0,finishes=0;
 const runner=createScheduledPlanRunner({plans:()=>plans,ready:()=>true,now:()=>clock,availability:()=> 'ready',
  update:async(id,change)=>{plans=plans.map(p=>p.id===id?change(p):p);},enqueue:()=>`message-${sends}`,
  send:async(_p,i)=>{assert.equal(i.id,String(Math.floor(sends/20)));assert.equal(i.stepIndex||0,sends%20);sends++;return {ok:true};},
  finish:()=>{finishes++;},
 });
 for(let i=0;i<20000;i++){await runner.tick();clock+=31000;}
 assert.equal(sends,20000);assert.equal(finishes,20000);assert.equal(plans[0].status,'done');
 assert.equal(plans[0].items.every(i=>i.status==='sent'&&i.stepIndex===20&&i.messageIds.length===20),true);
 assert.equal(new Set(plans[0].items.flatMap(i=>i.messageIds)).size,20000);
});

test('simultaneous plans share one ordered serial queue with gaps across plan boundaries',async()=>{
 const h=harness([plan('b',[item('3','b')]),plan('a')]);
 await Promise.all([h.runner.tick(),h.runner.tick(),h.runner.tick()]);
 assert.deepEqual(h.calls.map(c=>c.slice(0,2)),[['a','1']]);
 assert.equal(h.persisted.some(list=>list.find(p=>p.id==='a').items[0].status==='sending'),true);
 h.advance(29999);await h.runner.tick();assert.equal(h.calls.length,1);
 h.advance(1);await h.runner.tick();assert.equal(h.calls[1][1],'2');
 await h.runner.tick();assert.equal(h.calls.length,2);
 h.advance(30000);await h.runner.tick();assert.deepEqual(h.calls[2].slice(0,2),['b','3']);
});

test('normal queue waits over 15 minutes do not expire already admitted plans',async()=>{
 const h=harness([plan('a',[item('1')]),plan('b',[item('2')])]);await h.runner.tick();
 assert.equal(h.plans[1].status,'running');h.advance(60*60_000);await h.runner.tick();
 assert.equal(h.calls.length,2);assert.equal(h.plans[1].status,'done');
 const missed=harness([plan('missed')]);missed.advance(16*60_000);await missed.runner.tick();
 assert.equal(missed.calls.length,0);assert.equal(missed.plans[0].status,'expired');
});

test('cancel while persistence is pending prevents transmission and cannot reactivate cancelled work',async()=>{
 let release,entered;
 const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 const h=harness([plan('a')]);const update=h.options.update;
 h.options.update=async(id,change)=>{await update(id,change);if(h.plans[0].items[0].status==='sending'){entered();await wait;}};
 h.runner=createScheduledPlanRunner(h.options);const tick=h.runner.tick();await ready;
 h.plans[0]={...h.plans[0],status:'cancelled',items:h.plans[0].items.map(i=>i.status==='pending'?{...i,status:'cancelled'}:i)};
 release();await tick;assert.equal(h.calls.length,0);assert.equal(h.plans[0].items[0].status,'cancelled');
});

test('one in-flight request blocks further ticks and records successful in-flight sends after cancellation',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const h=harness([plan('a')],{send:async()=>{entered();await wait;return {ok:true};}});
 const tick=h.runner.tick();await ready;await h.runner.tick();
 h.plans[0]={...h.plans[0],status:'cancelled',items:h.plans[0].items.map(i=>i.status==='pending'?{...i,status:'cancelled'}:i)};
 release();await tick;
 assert.equal(h.plans[0].status,'cancelled');assert.deepEqual(h.plans[0].items.map(i=>i.status),['sent','cancelled']);
 assert.equal(h.finishes.length,1);
});

test('cooldown retries honor server delay and unknown results pause without auto retries',async()=>{
 let count=0;const h=harness([plan('a')],{send:async()=>++count===1?{ok:false,error:'rate_limited',retryAfterMs:120000}:{ok:false,uncertain:true,message:'unknown'}});
 await h.runner.tick();assert.equal(h.plans[0].items[0].status,'pending');
 h.advance(119999);await h.runner.tick();assert.equal(count,1);
 h.advance(1);await h.runner.tick();assert.equal(count,2);
 assert.equal(h.plans[0].status,'paused');assert.equal(h.plans[0].items[0].status,'unknown');
 h.advance(3600000);await h.runner.tick();assert.equal(count,2);
 h.plans[0]={...h.plans[0],status:'running'};await h.runner.tick();
 assert.equal(h.plans[0].items[0].status,'unknown','continuing never silently retries uncertain items');
});

test('offline and missing original account never fall back to another account',async()=>{
 let availability='offline';const h=harness([plan('a')],{availability:()=>availability});await h.runner.tick();
 assert.equal(h.calls.length,0);assert.equal(h.plans[0].error,'planQueue.offline');
 availability='missing';h.advance(5000);await h.runner.tick();assert.equal(h.calls.length,0);
 assert.equal(h.plans[0].status,'paused');assert.equal(h.plans[0].items[0].status,'failed');
});

test('a long offline wait requires confirmation even after the account reconnects',async()=>{
 let availability='offline';const h=harness([plan('a')],{availability:()=>availability});await h.runner.tick();
 h.advance(16*60_000);availability='ready';await h.runner.tick();
 assert.equal(h.calls.length,0);assert.equal(h.plans[0].status,'paused');assert.equal(h.plans[0].error,'planQueue.offlineExpired');
});

test('an unavailable attachment cannot silently become a text-only scheduled send',async()=>{
 const p=normalizeScheduledPlans([plan('a',[item('1')],{media:{dataUrl:'invalid'}})])[0];
 assert.equal(p.status,'paused');assert.equal(p.mediaUnavailable,true);
 const restored=normalizeScheduledPlans(JSON.parse(JSON.stringify([p])))[0];assert.equal(restored.mediaUnavailable,true);
 restored.status='running';const h=harness([restored]);await h.runner.tick();assert.equal(h.calls.length,0);assert.equal(h.plans[0].status,'paused');
});

test('failure to create an outgoing record pauses instead of retrying an invisible task forever',async()=>{
 const h=harness([plan('a')],{enqueue:()=>null});await h.runner.tick();
 assert.equal(h.calls.length,0);assert.equal(h.plans[0].status,'paused');assert.equal(h.plans[0].error,'planQueue.cannotQueue');
});

test('storage failure before sending stops transmission; restart never replays in-flight entries',async()=>{
 const h=harness([plan('a')]);const update=h.options.update;
 h.options.update=async(id,change)=>{await update(id,change);if(h.plans[0].items[0].status==='sending')throw Error('disk full');};
 h.runner=createScheduledPlanRunner(h.options);await h.runner.tick();assert.equal(h.calls.length,0);
 assert.equal(h.plans[0].status,'paused');assert.equal(h.plans[0].items[0].status,'unknown');
 const recovered=normalizeScheduledPlans([plan('a',[{...item('1'),status:'sent'},{...item('2'),status:'sending'},item('3')],{status:'running',cooldownUntil:iso(origin+30000)})]);
 assert.equal(recovered[0].status,'paused');assert.deepEqual(recovered[0].items.map(i=>i.status),['sent','unknown','pending']);
 assert.ok(Date.parse(recovered[0].cooldownUntil)>=origin+30000);
});

test('restart restores a fresh minimum cooldown for uncertain in-flight sends',()=>{
 const before=Date.now();
 const recovered=normalizeScheduledPlans([plan('a',[{...item('1'),status:'sending'}],{status:'running',cooldownUntil:iso(origin-100000)})]);
 assert.equal(recovered[0].status,'paused');assert.ok(Date.parse(recovered[0].cooldownUntil)>=before+30000);
});

test('group and folder targets deduplicate by original account and recipient and respect child scopes',()=>{
 const state={settings:{waAccounts:[{id:'a'},{id:'b'}],activeAccountId:'b',liveBaileysAccountId:'b',chatFolders:[
 {id:'root',chatIds:['chat1','clone'],scope:{type:'account',accountId:'a'}},
 {id:'child',parentId:'root',chatIds:['chat2'],scope:{type:'account',accountId:'a'}},
 {id:'other',parentId:'root',chatIds:['chat3'],scope:{type:'account',accountId:'b'}}],chatFolderClones:[{id:'x',folderId:'root',sourceChatId:'chat1'}]},
 contacts:[{id:'c1',accountId:'a',channelAddress:'12345@g.us',isGroup:true},{id:'c2',accountId:'a',phone:'+12025550123'},{id:'c3',accountId:'b',channelAddress:'12345@g.us',isGroup:true}],
 chats:[{id:'chat1',contactId:'c1',accountId:'a'},{id:'clone',contactId:'c1',accountId:'a'},{id:'chat2',contactId:'c2',accountId:'a'},{id:'chat3',contactId:'c3',accountId:'b'}]};
 assert.deepEqual(scheduledFolderChatIds(state.settings,'root',false),['chat1','clone']);
 assert.deepEqual(scheduledFolderChatIds(state.settings,'root',true),['chat1','clone','chat2']);
 const targets=scheduledPlanTargets(state);assert.equal(targets.length,3);assert.equal(targets[0].recipient,'12345@g.us');assert.equal(targets[0].accountId,'a');
 state.chats[0].accountId='b';assert.equal(scheduledPlanTargets(state,['chat1']).length,0,'mismatched owners are rejected');
});

test('backup preserves frozen plan content and attachment but cannot activate restored plans',()=>{
 const media={dataUrl:'data:image/png;base64,AA==',fileName:'frozen.png',mimeType:'image/png',kind:'image',size:1};
 const settings=normalizeLoadedSettings({scheduledPlans:[plan('a',[item('1')],{media})]});
 assert.equal(settings.scheduledPlans[0].media.fileName,'frozen.png');
 const restored=parseBackupJson({version:2,contacts:[{id:'a',name:'A',phone:'12025550123'}],settingsSafe:buildSettingsSafe(settings)});
 assert.equal(restored.settingsSafe.scheduledPlans[0].status,'paused');
 assert.equal(restored.settingsSafe.scheduledPlans[0].text,'FROZEN TEXT');
 assert.equal(restored.settingsSafe.scheduledPlans[0].media.dataUrl,media.dataUrl);
});
