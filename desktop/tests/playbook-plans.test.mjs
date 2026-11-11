import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledPlaybook,normalizePlaybookPlans,normalizePlaybookSchedule} from '../src/lib/playbookPlans.ts';
import {resolvePlaybook,playbookBindingKey} from '../src/lib/aiPlaybooks.ts';
const plans=[{id:'welcome',name:'Welcome',days:['one','two','three']},{id:'invite',name:'Invite',days:['three','one']}];
const schedule={planId:'welcome',startDate:'2026-11-11',timeZone:'Europe/Paris',switchTime:'09:00'};
test('plans follow each folder start date and timezone, skip missed days and hold the final day',()=>{
 assert.equal(scheduledPlaybook(plans,schedule,Date.parse('2026-11-11T07:59:00Z')).id,'off');
 assert.equal(scheduledPlaybook(plans,schedule,Date.parse('2026-11-11T08:00:00Z')).id,'one');
 assert.equal(scheduledPlaybook(plans,schedule,Date.parse('2026-11-12T08:00:00Z')).id,'two');
 assert.equal(scheduledPlaybook(plans,{...schedule,startDate:'2026-11-13'},Date.parse('2026-11-12T08:00:00Z')).id,'off');
 const final=scheduledPlaybook(plans,schedule,Date.parse('2026-11-20T08:00:00Z'));assert.equal(final.id,'three');assert.equal(final.ended,true);assert.equal(final.next,'');
});
test('calendar-day transitions survive DST and a repeated hour never rolls a plan backwards',()=>{
 const spring={...schedule,startDate:'2026-03-28'};
 assert.equal(scheduledPlaybook(plans,spring,Date.parse('2026-03-29T07:00:00Z')).day,2);
 const fall={...schedule,startDate:'2026-10-24',switchTime:'02:30'};
 for(const instant of ['2026-10-25T00:29:00Z','2026-10-25T00:30:00Z','2026-10-25T01:10:00Z','2026-10-25T01:30:00Z']){
  assert.equal(scheduledPlaybook(plans,fall,Date.parse(instant)).day,instant.includes('00:29')?1:2,instant);
 }
});
test('malformed schedules and missing plans fail closed; invalid plans cannot enter the library',()=>{
 for(const invalid of [{planId:'missing'},{startDate:'2026-02-30'},{timeZone:'bad/zone'},{switchTime:'24:00'}])assert.ok(scheduledPlaybook(plans,{...schedule,...invalid}).error);
 assert.deepEqual(normalizePlaybookPlans([...plans,{id:'bad',name:'Bad',days:['']},plans[0]]),plans);
 assert.ok(scheduledPlaybook(plans,normalizePlaybookSchedule({})).error);
});
test('folder plans inherit while individual and child fixed bindings take precedence',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-12T08:00:00Z'));
 const books=['one','two','three'].map(id=>({id,name:id,sourceName:id+'.md',content:'',summary:'Rules for '+id}));
 const settings={aiPlaybooks:books,aiPlaybookPlans:plans,chatFolders:[{id:'parent',chatIds:[],scope:{type:'all'},aiPlaybookSchedule:schedule},{id:'child',parentId:'parent',chatIds:['chat'],scope:{type:'all'}}]};
 const result=resolvePlaybook(settings,'a','chat');assert.equal(result.id,'two');assert.equal(result.plan.day,2);assert.match(result.prompt,/Welcome/);assert.doesNotMatch(result.prompt,/Rules for one/);
 settings.aiPlaybookBindings={[playbookBindingKey('a','chat')]:'one'};assert.equal(resolvePlaybook(settings,'a','chat').id,'one');
 settings.aiPlaybookBindings={};settings.chatFolders[1].aiPlaybookId='off';assert.equal(resolvePlaybook(settings,'a','chat').id,'off');
 settings.chatFolders[1].aiPlaybookId='';settings.aiPlaybooks=settings.aiPlaybooks.filter(b=>b.id!=='two');assert.ok(resolvePlaybook(settings,'a','chat').error);
});
