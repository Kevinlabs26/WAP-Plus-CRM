import test from 'node:test';
import assert from 'node:assert/strict';
import {chatCompletionOptions} from '../src/lib/aiProviders.ts';
import {generateSuggestions} from '../src/lib/aiSuggest.ts';
import {generateCustomerInsight} from '../src/lib/aiCustomerCard.ts';
import {translateDraftText} from '../src/lib/translateDraft.ts';

const settings={aiProvider:'openai',openaiKey:'fixture-only',aiModel:'gpt-5.6-luna',aiSystemPrompt:'Reply naturally.'};
test('OpenAI uses the current token parameter and Luna keeps its reply budget out of reasoning',()=>{
 assert.deepEqual(chatCompletionOptions('openai','gpt-5.6-luna',0.3,160),{temperature:0.3,reasoning_effort:'none',max_completion_tokens:160});
 assert.deepEqual(chatCompletionOptions('openai','gpt-4o-mini',0.7,300),{temperature:0.7,max_completion_tokens:300});
 for(const model of ['o3','o4-mini','gpt-5','gpt-6-astra']){
  const params=chatCompletionOptions('openai',model,0.3,160);assert.equal(params.max_completion_tokens,160);assert.equal(params.temperature,undefined);assert.equal(params.reasoning_effort,undefined);
 }
 for(const provider of ['groq','deepseek','qwen','zhipu','openrouter','custom'])assert.deepEqual(chatCompletionOptions(provider,'test',0.7,300),{temperature:0.7,max_tokens:300});
});

test('manual suggestions, selected replies, auto replies and outreach all send accepted OpenAI parameters',async t=>{
 const bodies=[];t.mock.method(globalThis,'fetch',async(_url,opts)=>{const body=JSON.parse(opts.body);bodies.push(body);assert.equal(body.max_tokens,undefined);assert.equal(body.reasoning_effort,'none');return Response.json({choices:[{message:{content:'[{"text":"Hello"}]'}}]});});
 for(const opts of [{},{count:1},{auto:true},{auto:true,outreach:'Say hello'},{replyTo:{id:'in',chatId:'chat',direction:'in',body:'Hello',sentAt:new Date().toISOString()}}]){const result=await generateSuggestions(undefined,[],settings,opts);assert.equal(result.fallback,false);assert.equal(result.source,'openai');}
 assert.deepEqual(bodies.map(body=>body.max_completion_tokens),[1536,512,512,512,512]);
});

test('OpenAI streaming retains its first suggestion and final usage with the new limit parameter',async t=>{
 let body;t.mock.method(globalThis,'fetch',async(_url,opts)=>{body=JSON.parse(opts.body);return new Response('data: {"choices":[{"index":0,"delta":{"content":"[{\\"text\\":\\"Hello\\"}]"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});});
 const updates=[],result=await generateSuggestions(undefined,[],settings,{count:1,onProgress:value=>updates.push(value)});
 assert.equal(result.fallback,false);assert.equal(updates[0].suggestions[0].text,'Hello');assert.equal(body.max_completion_tokens,512);assert.deepEqual(body.stream_options,{include_usage:true});
});

test('Luna customer analysis and independent translation share the same compatible sampling options',async t=>{
 const bodies=[];t.mock.method(globalThis,'fetch',async(_url,opts)=>{const body=JSON.parse(opts.body);bodies.push(body);const content=body.temperature===0.4?JSON.stringify({summary:'A friendly greeting',intent:'Greeting',nextStep:'Reply',risks:[]}):'Bonjour !';return Response.json({choices:[{message:{content}}]});});
 const insight=await generateCustomerInsight(undefined,[],settings);assert.equal(insight.fallback,false);
 const translation=await translateDraftText('你好','fr',{...settings,translateService:'ai',translationProvider:'openai',translationApiKey:'independent-test',translationModel:'gpt-5.6-luna'});assert.equal(translation.fallback,false);assert.equal(translation.text,'Bonjour !');
 assert.equal(bodies.length,2);assert.ok(bodies.every(body=>body.reasoning_effort==='none'&&body.max_tokens===undefined));
});
