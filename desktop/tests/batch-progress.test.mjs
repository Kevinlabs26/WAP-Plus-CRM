import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const out=await build({entryPoints:[fileURLToPath(new URL('../src/lib/scheduledPlanProgress.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {planItemReceipt,estimatePlanMinutes}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text+'\n//# sourceURL=batch-progress-test.js').toString('base64'));

test('a sequence is delivered or read only when every step has that receipt',()=>{
 const item={status:'sent',messageIds:['first','second']};const messages=new Map([['first',{deliveryStatus:'read'}],['second',{deliveryStatus:'sent'}]]);
 assert.equal(planItemReceipt(item,messages),'submitted');messages.get('second').deliveryStatus='delivered';assert.equal(planItemReceipt(item,messages),'delivered');
 messages.get('second').deliveryStatus='played';assert.equal(planItemReceipt(item,messages),'read');messages.delete('second');assert.equal(planItemReceipt(item,messages),'submitted');
 assert.equal(planItemReceipt({...item,status:'unknown'},messages),'submitted');
});

test('estimates include sequence steps, preceding tasks, legacy broadcasts and hourly quotas',()=>{
 const now=Date.now();const task=(id,count,extra={})=>({id,title:id,createdAt:new Date(now).toISOString(),dueAt:new Date(now).toISOString(),status:'running',gapSec:30,text:'one',items:Array.from({length:count},(_,i)=>({id:String(i),accountId:'estimate',status:'pending'})),...extra});
 const config={rateLimits:{perPhonePerMinute:8,perPhonePerHour:80,minIntervalSec:4}};
 const p=task('b',100);assert.ok(estimatePlanMinutes(p,[p],[],config,now)>=60);
 const small=task('b',1);assert.equal(estimatePlanMinutes(small,[small],[],config,now),1);
 const earlier=task('a',50);assert.ok(estimatePlanMinutes(small,[earlier,small],[],config,now)>=25);
 const legacy={id:'old',accountId:'estimate',status:'running',extraGapSec:30,items:Array.from({length:40},()=>({status:'pending'}))};
 assert.ok(estimatePlanMinutes(small,[small],[legacy],config,now)>=20);
 const sequence=task('b',50,{steps:[{text:'two'},{text:'three'}]});assert.ok(estimatePlanMinutes(sequence,[sequence],[],config,now)>=75);
});
