import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAiTimeContext,resolveAiTimeZones} from '../src/lib/aiTimeContext.ts';
import {generateSuggestions,getSuggestionContextKey} from '../src/lib/aiSuggest.ts';
import {systemTimeZone,validTimeZone,timeZoneOptions} from '../src/lib/timeZone.ts';

const sender={aiTimeZone:'Europe/Paris'};
const contact={id:'c',name:'Customer',phone:'+243810000000',accountId:'a',tags:[],timeZone:'Asia/Tokyo'};
const now=Date.parse('2026-12-31T23:30:00Z');
test('runtime clock carries both local dates, weekdays, UTC offsets and real daylight-saving changes',()=>{
  const crossing=JSON.parse(buildAiTimeContext(contact,sender,now));
  assert.equal(crossing.currentUtc,'2026-12-31T23:30:00.000Z');
  assert.equal(crossing.sender.timeZone,'Europe/Paris');assert.equal(crossing.sender.source,'configured');
  assert.match(crossing.sender.dateTime,/2027-01-01/);assert.match(crossing.sender.dateTime,/00:30/);assert.match(crossing.sender.dateTime,/Friday/);
  assert.equal(crossing.recipient.source,'confirmed');assert.match(crossing.recipient.localTimes[0].dateTime,/08:30/);
  const winter=JSON.parse(buildAiTimeContext(contact,sender,Date.parse('2026-01-15T12:00:00Z')));
  const summer=JSON.parse(buildAiTimeContext(contact,sender,Date.parse('2026-07-15T12:00:00Z')));
  assert.match(winter.sender.dateTime,/13:00.*GMT\+01:00/);assert.match(summer.sender.dateTime,/14:00.*GMT\+02:00/);
  assert.match(winter.recipient.localTimes[0].dateTime,/21:00.*GMT\+09:00/);
  assert.match(summer.recipient.localTimes[0].dateTime,/21:00.*GMT\+09:00/);
});

test('confirmed zones override phone countries while estimates, ambiguous countries, LIDs and groups stay explicitly uncertain',()=>{
  const explicit=resolveAiTimeZones(contact,sender);assert.deepEqual(explicit.recipient.timeZones,['Asia/Tokyo']);
  const ambiguous=JSON.parse(buildAiTimeContext({...contact,timeZone:undefined},sender,now));
  assert.equal(ambiguous.recipient.source,'phone_country_estimate');assert.equal(ambiguous.recipient.country,'CD');
  assert.equal(ambiguous.recipient.timeZones.length,2);assert.deepEqual(ambiguous.recipient.localTimes,[]);
  const estimate=JSON.parse(buildAiTimeContext({...contact,phone:'+2250123456789',timeZone:undefined},sender,now));
  assert.equal(estimate.recipient.source,'phone_country_estimate');assert.equal(estimate.recipient.localTimes.length,1);
  for(const patch of [{phone:'123456@lid',timeZone:undefined},{phone:'',timeZone:'Invented/City'}]){
    const result=resolveAiTimeZones({...contact,...patch},sender);assert.equal(result.recipient.source,'unknown');assert.deepEqual(result.recipient.timeZones,[]);
  }
  for(const patch of [{isGroup:true},{channelAddress:'123@g.us'},{phone:'123@g.us'}]){
    const result=resolveAiTimeZones({...contact,...patch},sender);assert.equal(result.recipient.source,'group_unknown');assert.deepEqual(result.recipient.timeZones,[]);
  }
  const computer=resolveAiTimeZones(undefined,{aiTimeZone:'Invalid/Zone'}).sender;
  assert.equal(computer.source,'computer');assert.equal(computer.timeZone,systemTimeZone());
  for(const invalid of [null,{},42,'','Bad/Zone','a'.repeat(100)])assert.equal(validTimeZone(invalid),undefined);
  assert.equal(validTimeZone(' Europe/Paris '),'Europe/Paris');
  assert.ok(timeZoneOptions().includes('Europe/Paris'));assert.ok(timeZoneOptions().includes('Asia/Tokyo'));
});

test('every model receives the live clock for suggestions, automatic replies and selected-message replies, while identity keys remain stable',async t=>{
  let clock=now;t.mock.method(Date,'now',()=>clock);
  const recent=[{id:'m',chatId:'chat',contactId:'c',direction:'in',body:'What time is it there?',sentAt:'2026-01-01T00:00:00Z'}];
  const base={...sender,aiModel:'test',geminiKey:'test',ollamaUrl:'http://127.0.0.1:11434',customAiKey:'test',customAiBaseUrl:'https://example.invalid/v1',customAiModel:'test'};
  for(const provider of ['custom','gemini','ollama'])for(const options of [{},{auto:true},{replyTo:recent[0]}]){
    let payload;
    const mocked=t.mock.method(globalThis,'fetch',async(_url,opts)=>{
      payload=JSON.parse(opts.body);const output='[{"text":"A natural reply"}]';
      return Response.json(provider==='gemini'?{candidates:[{content:{parts:[{text:output}]}}]}:provider==='ollama'?{message:{content:output}}:{choices:[{message:{content:output}}]});
    });
    const settings={...base,aiProvider:provider},result=await generateSuggestions(contact,recent,settings,options);assert.equal(result.fallback,false);
    const system=provider==='gemini'?payload.systemInstruction.parts[0].text:payload.messages[0].content;
    const user=provider==='gemini'?payload.contents[0].parts[0].text:payload.messages[1].content;
    const runtime=JSON.parse(user.split('Runtime clock (program-provided; current at generation):\n')[1].split('\n')[0]);
    assert.equal(runtime.currentUtc,new Date(clock).toISOString());assert.equal(runtime.recipient.localTimes[0].timeZone,'Asia/Tokyo');
    assert.match(system,/Message timestamps are historical/);assert.match(system,/phone-country estimate is not a verified current location/);assert.match(system,/group members may live in different zones/);
    const key=getSuggestionContextKey(contact,recent,settings,'a',options);clock+=60000;
    assert.equal(getSuggestionContextKey(contact,recent,settings,'a',options),key,'ticking clocks cannot invalidate a request or queued reply hash');
    assert.notEqual(getSuggestionContextKey({...contact,timeZone:'Europe/London'},recent,settings,'a',options),key);
    assert.notEqual(getSuggestionContextKey(contact,recent,{...settings,aiTimeZone:'America/New_York'},'a',options),key);
    mocked.mock.restore();
  }
});
