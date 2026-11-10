import test from 'node:test';
import assert from 'node:assert/strict';
let sequence=0;
async function fixture(t){
 const values=new Map(),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
 const api=await import(`../src/lib/aiUsage.ts?test=${sequence++}`);
 return {api,values,storage,context:{provider:'custom',model:'test-model',endpoint:'https://test.invalid/v1?api_key=private-key',feature:'suggestion'},record:async(context,body)=>api.trackAiRequest(context,async observe=>{observe(body);return 'OK';})};
}
const usage=(input=1000,output=200,cached=100)=>({usage:{prompt_tokens:input,completion_tokens:output,total_tokens:input+output,prompt_tokens_details:{cached_tokens:cached}}});

test('usage parses compatible, Gemini thinking/cache and Ollama totals; missing or invalid values remain unknown',async t=>{
 const {api}=await fixture(t);
 assert.deepEqual(api.parseAiTokenUsage(usage(),'custom'),{input:1000,output:200,cached:100,total:1200});
 assert.deepEqual(api.parseAiTokenUsage({usageMetadata:{promptTokenCount:20,candidatesTokenCount:8,thoughtsTokenCount:10,cachedContentTokenCount:4,totalTokenCount:38}},'gemini'),{input:20,output:18,cached:4,total:38});
 assert.deepEqual(api.parseAiTokenUsage({prompt_eval_count:12,eval_count:3},'ollama'),{input:12,output:3,cached:0,total:15});
 for(const body of [{},usage(-1),usage(NaN),usage(1.5),usage(2,1,3),{usage:{total_tokens:10}}])assert.equal(api.parseAiTokenUsage(body,'custom'),null);
 assert.equal(api.parseAiTokenUsage({...usage(),usage:{...usage().usage,cost:0.25}},'custom').cost,undefined,'unknown providers cannot claim an amount is USD');
});

test('stream snapshots count once and persist only aggregate metadata, not keys or message content',async t=>{
 const h=await fixture(t);let updates=0;const unsubscribe=h.api.subscribeAiUsage(()=>updates++);
 await h.api.trackAiRequest(h.context,async observe=>{observe(usage(500,10));observe({...usage(),choices:[{message:{content:'private-chat-body'}}]});observe({choices:[]});return 'OK';});unsubscribe();
 const data=h.api.getAiUsageSnapshot(),row=data.buckets[0];assert.equal(row.requests,1);assert.equal(row.total,1200);assert.equal(updates,1);
 const stored=[...h.values.values()][0];assert.ok(!stored.includes('private-key'));assert.ok(!stored.includes('private-chat-body'));assert.ok(!stored.includes('test.invalid'));
 const reloaded=await import(`../src/lib/aiUsage.ts?reload=${sequence++}`);assert.equal(reloaded.getAiUsageSnapshot().buckets[0].total,1200);
});

test('cost estimates subtract cache hits, accept explicit free prices and never turn missing usage into free requests',async t=>{
 const h=await fixture(t);await h.record(h.context,usage());
 const row=h.api.getAiUsageSnapshot().buckets[0],key=h.api.usageRateKey(row);
 let sum=h.api.summarizeAiUsage([row],{});assert.equal(sum.priced,0);assert.equal(sum.unpriced,1);
 await h.api.saveAiUsageRate(key,{input:2,output:4,cached:0.2});
 sum=h.api.summarizeAiUsage([row],h.api.getAiUsageSnapshot().rates);assert.ok(Math.abs(sum.cost-0.00262)<1e-12);assert.equal(sum.priced,1);
 await h.record(h.context,{});sum=h.api.summarizeAiUsage(h.api.getAiUsageSnapshot().buckets,h.api.getAiUsageSnapshot().rates);assert.equal(sum.unknown,1);assert.equal(sum.priced,1);
 await h.api.saveAiUsageRate(key,{input:0,output:0,cached:0});assert.equal(h.api.summarizeAiUsage([row],h.api.getAiUsageSnapshot().rates).cost,0);
 await assert.rejects(h.api.saveAiUsageRate(key,{input:-1,output:0}));await assert.rejects(h.api.saveAiUsageRate(key,{input:Infinity,output:0}));
});

test('provider-reported USD cost takes priority and rejected output still counts received tokens',async t=>{
 const h=await fixture(t),context={...h.context,provider:'openrouter'};
 await assert.rejects(h.api.trackAiRequest(context,async observe=>{observe({usage:{...usage().usage,cost:0.001}});throw Error('invalid output');}));
 const data=h.api.getAiUsageSnapshot(),row=data.buckets[0];const sum=h.api.summarizeAiUsage([row],{[h.api.usageRateKey(row)]:{input:500,output:500}});
 assert.equal(sum.cost,0.001);assert.equal(sum.priced,1);assert.equal(sum.failed,1);assert.equal(sum.unknown,0);
 await assert.rejects(h.api.trackAiRequest(context,async()=>{throw Error('aborted');}));assert.equal(h.api.getAiUsageSnapshot().buckets[0].unknown,1);
});

test('feature and endpoint grouping stay separate, and saving failures cannot break generation',async t=>{
 const h=await fixture(t);for(const feature of ['suggestion','autoReply','outreach','translation','insight','transcription','context'])await h.record({...h.context,feature},usage());
 await h.record({...h.context,endpoint:'https://other.invalid'},usage());assert.equal(h.api.getAiUsageSnapshot().buckets.length,8);
 h.storage.setItem=()=>{throw Error('disk full');};assert.equal(await h.record(h.context,usage()),'OK');assert.equal(h.api.getAiUsageSnapshot().error,true);
});

test('unsupported streaming retries count both attempts and preserve the successful usage',async t=>{
 const h=await fixture(t),{generateSuggestions}=await import('../src/lib/aiSuggest.ts');let attempts=0;
 t.mock.method(globalThis,'fetch',async()=>++attempts===1?Response.json({error:{message:'stream_options unsupported'}},{status:400}):Response.json({...usage(),choices:[{message:{content:'[{"text":"Hello"}]'}}]}));
 const result=await generateSuggestions(undefined,[],{aiProvider:'custom',customAiModel:'test',customAiKey:'test-key',customAiBaseUrl:'https://test.invalid/v1',aiSystemPrompt:'Say hello'},{onProgress(){}});
 assert.equal(result.fallback,false);assert.equal(attempts,2);const data=h.api.getAiUsageSnapshot();assert.equal(data.buckets[0].requests,2);assert.equal(data.buckets[0].failed,1);assert.equal(data.buckets[0].unknown,1);assert.equal(data.buckets[0].total,1200);
});

test('retention stays bounded and malformed persisted counters are surfaced instead of reset silently',async t=>{
 const h=await fixture(t);await h.record(h.context,usage());const key=[...h.values.keys()][0],base=h.api.getAiUsageSnapshot().buckets[0];
 h.values.set(key,JSON.stringify({buckets:[{...base,day:'2000-01-01'},...Array.from({length:5999},(_,i)=>({...base,model:'model-'+i}))],rates:{},since:new Date().toISOString()}));
 await h.record(h.context,usage());assert.equal(h.api.getAiUsageSnapshot().buckets.length,6000);assert.ok(!h.api.getAiUsageSnapshot().buckets.some(row=>row.day==='2000-01-01'));
 await h.record({...h.context,model:'additional-model'},usage());assert.equal(h.api.getAiUsageSnapshot().buckets.length,6000);assert.equal(h.api.getAiUsageSnapshot().limited,true);
 h.values.set(key,JSON.stringify({buckets:[{...base,requests:-1}],rates:{}}));assert.equal(await h.record(h.context,usage()),'OK');assert.equal(h.api.getAiUsageSnapshot().error,true);assert.equal(JSON.parse(h.values.get(key)).buckets[0].requests,-1);
});
