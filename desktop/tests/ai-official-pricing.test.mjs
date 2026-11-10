import test from 'node:test';
import assert from 'node:assert/strict';
import {officialAiPriceInfo,officialAiUsageRate,AI_PRICE_CHECKED_AT} from '../src/lib/aiPricing.ts';
import {summarizeAiUsage,parseAiTokenUsage,trackAiRequest,getAiUsageSnapshot,usageRateKey,saveAiUsageRate,clearAiUsageRate} from '../src/lib/aiUsage.ts';
const row=(patch={})=>({day:'2026-11-06',provider:'openai',model:'gpt-5.6-luna',service:'openai:fixture',feature:'suggestion',requests:1,failed:0,unknown:0,input:1000,output:200,cached:100,total:1200,reportedCost:0,reportedRequests:0,unpricedInput:1000,unpricedOutput:200,unpricedCached:100,...patch});

test('Luna automatically matches official USD prices, including cache writes and the long-context tier',()=>{
 const rate=officialAiPriceInfo('openai','gpt-5.6-luna');assert.equal(rate.input,0.20);assert.equal(rate.output,1.20);assert.equal(rate.cached,0.02);assert.equal(rate.cacheWrite,0.25);assert.equal(rate.checkedAt,AI_PRICE_CHECKED_AT);assert.match(rate.source,/^https:\/\/developers\.openai\.com\//);
 const sum=summarizeAiUsage([row({unpricedCacheWrite:200})],{});
 assert.equal(sum.priced,1);assert.equal(sum.unpriced,0);assert.ok(Math.abs(sum.cost-0.000432)<1e-12,'ordinary input, cache reads, cache writes and output are each counted once');
 assert.equal(officialAiUsageRate(row({longContext:true})).input,0.40);assert.equal(officialAiUsageRate(row({longContext:true})).output,1.80);assert.equal(officialAiUsageRate(row({longContext:true})).cached,0.04);
});

test('prices are channel-specific and unknown models, special tiers and audio billing are not guessed',()=>{
 for(const patch of [{provider:'custom'},{provider:'openrouter'},{provider:'gemini'},{model:'unlisted-model'},{model:'ft:gpt-4o-mini:company'},{billingTier:'priority'},{billingTier:'flex'},{feature:'transcription'}])assert.equal(officialAiUsageRate(row(patch)),undefined);
 for(const [provider,model]of [['constructor','name'],['openai','__proto__'],['__proto__','constructor']])assert.equal(officialAiPriceInfo(provider,model),undefined);
 assert.equal(officialAiPriceInfo('openai','gpt-4o-mini-2024-07-18').input,0.15);
 assert.equal(officialAiPriceInfo('openai','gpt-4o-2024-05-13'),undefined,'do not apply the newer GPT-4o price to an older snapshot');
 assert.equal(officialAiPriceInfo('vertex','gemini-2.5-flash').input,0.30);assert.equal(officialAiPriceInfo('groq','openai/gpt-oss-20b').input,0.075);
 assert.equal(officialAiUsageRate(row({provider:'vertex',model:'gemini-2.0-flash'})),undefined,'unknown caching prices are not treated as standard input prices');
});

test('provider costs win over estimates, optional custom prices can be removed, and unknown usage remains unknown',async()=>{
 const sample=row(),key=usageRateKey(sample);assert.ok(summarizeAiUsage([sample],{}).priced);
 await saveAiUsageRate(key,{input:0,output:0,cached:0,cacheWrite:0});let data=getAiUsageSnapshot();assert.equal(summarizeAiUsage([sample],data.rates).cost,0);
 await clearAiUsageRate(key);data=getAiUsageSnapshot();assert.ok(summarizeAiUsage([sample],data.rates).cost>0);
 const provider=row({reportedCost:0.123,reportedRequests:1,unpricedInput:0,unpricedOutput:0,unpricedCached:0});assert.equal(summarizeAiUsage([provider],{}).cost,0.123);
 const unknown=row({input:0,output:0,cached:0,total:0,unknown:1,unpricedInput:0,unpricedOutput:0,unpricedCached:0});const total=summarizeAiUsage([unknown],{});assert.equal(total.priced,0);assert.equal(total.unknown,1);
});

test('recording separates each requests context tier so many short calls cannot become a long call',async()=>{
 const context={provider:'openai',model:'gpt-5.6-luna',feature:'outreach',endpoint:'https://fixture.invalid/context-tier'};
 for(const input of [200_000,200_000,200_000,300_000])await trackAiRequest(context,async observe=>{observe({usage:{prompt_tokens:input,completion_tokens:1000,total_tokens:input+1000},service_tier:'default'});});
 const rows=getAiUsageSnapshot().buckets.filter(value=>value.feature==='outreach');assert.equal(rows.length,2);assert.equal(rows.find(value=>value.longContext===false).requests,3);assert.equal(rows.find(value=>value.longContext===true).requests,1);
 assert.ok(Math.abs(summarizeAiUsage(rows,{}).cost-0.2454)<1e-12);
 const legacy=row({requests:3,input:600_000,unpricedInput:600_000});assert.equal(officialAiUsageRate(legacy),undefined,'legacy aggregates with ambiguous request sizes remain unpriced');
});

test('cache-write and tier metadata are validated, and Gemini long-context pricing includes thinking output',()=>{
 const input={usage:{prompt_tokens:1000,completion_tokens:200,total_tokens:1200,prompt_tokens_details:{cached_tokens:100,cache_write_tokens:200}},service_tier:'default'};
 assert.equal(parseAiTokenUsage(input,'openai').cacheWrite,200);assert.equal(parseAiTokenUsage(input,'openai').billingTier,'default');
 assert.equal(parseAiTokenUsage({...input,service_tier:''},'openai').billingTier,undefined);
 for(const writes of [-1,1.5,901])assert.equal(parseAiTokenUsage({...input,usage:{...input.usage,prompt_tokens_details:{cached_tokens:100,cache_write_tokens:writes}}},'openai'),null);
 const rate=officialAiUsageRate(row({provider:'vertex',model:'gemini-2.5-pro',longContext:true}));assert.equal(rate.input,2.50);assert.equal(rate.output,15);assert.equal(rate.cached,0.25);
 assert.equal(parseAiTokenUsage({usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,thoughtsTokenCount:2,totalTokenCount:15,trafficType:'ON_DEMAND'}},'vertex').output,5);
});
