import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({stdin:{contents:`export * from './src/lib/vertexAi.ts';export * from './src/lib/aiProviders.ts';export * from './src/lib/gemini.ts';export {generateSuggestions,getSuggestionContextKey} from './src/lib/aiSuggest.ts';export {generateCustomerInsight} from './src/lib/aiCustomerCard.ts';export {getTranslationContextKey} from './src/lib/translateDraft.ts';`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':root+'src'},plugins:[{name:'native-auth',setup(b){b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'native',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const invoke=(...args)=>globalThis.vertexInvoke(...args);'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=vertex-ai-test.js').toString('base64'));
const settings={aiProvider:'vertex',vertexProjectId:'sample-project',vertexLocation:'global',vertexCredentialId:'a'.repeat(64),aiModel:'configured-gemini',geminiKey:'unused-ai-studio-key',aiSystemPrompt:'Be helpful.'};

test('Vertex endpoint validates resource components and handles regional and global hosts',()=>{
 assert.equal(api.vertexBaseUrl(settings),'https://aiplatform.googleapis.com/v1/projects/sample-project/locations/global/publishers/google/models');
 assert.match(api.vertexBaseUrl({...settings,vertexLocation:'europe-west4'}),/^https:\/\/europe-west4-aiplatform.googleapis.com/);
 for(const patch of [{vertexProjectId:'../leak'},{vertexLocation:'attacker.invalid/path'},{vertexLocation:'global?key=x'}])assert.throws(()=>api.vertexBaseUrl({...settings,...patch}));
 assert.equal(api.hasAiCredentials(settings),true);assert.equal(api.hasAiCredentials({...settings,vertexCredentialId:''}),false);assert.equal(api.hasAiCredentials({...settings,aiModel:''}),false);
});

test('Vertex generation uses a short-lived native token and the existing Gemini request format',async t=>{
 const calls=[];globalThis.vertexInvoke=async(command,args)=>{calls.push({command,args});return 'short-lived-test-token';};t.after(()=>delete globalThis.vertexInvoke);
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  assert.match(url,/aiplatform\.googleapis\.com\/v1\/projects\/sample-project\/locations\/global\/publishers\/google\/models\/configured-gemini:generateContent$/);
  assert.equal(opts.headers.Authorization,'Bearer short-lived-test-token');assert.equal(opts.headers['x-goog-api-key'],undefined);assert.ok(!opts.body.includes('unused-ai-studio-key'));
  return Response.json({candidates:[{content:{parts:[{text:'[{"text":"Hello"}]'}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:5,totalTokenCount:25}});
 });
 for(const opts of [{},{auto:true},{auto:true,outreach:'Start a friendly conversation.'}]){const result=await api.generateSuggestions(undefined,[],settings,opts);assert.equal(result.source,'vertex');assert.equal(result.fallback,false);assert.equal(result.suggestions[0].text,'Hello');}
 assert.equal(calls.length,3);assert.ok(calls.every(call=>call.command==='vertex_ai_access_token'&&call.args.expectedCredentialId===settings.vertexCredentialId));
});

test('Vertex streaming preserves early suggestions and native authorization errors fail closed',async t=>{
 globalThis.vertexInvoke=async()=> 'test-token';t.after(()=>delete globalThis.vertexInvoke);
 t.mock.method(globalThis,'fetch',async(url)=>{assert.match(url,/:streamGenerateContent\?alt=sse$/);return new Response('data: {"candidates":[{"content":{"parts":[{"text":"[{\\"text\\":\\"Hello\\"}]"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2,"totalTokenCount":12}}\n\n');});
 const updates=[],result=await api.generateSuggestions(undefined,[],settings,{count:1,onProgress:value=>updates.push(value)});assert.equal(result.fallback,false);assert.equal(updates[0].source,'vertex');assert.equal(updates[0].suggestions[0].text,'Hello');
 globalThis.vertexInvoke=async()=>{throw Error('credentials changed');};t.mock.method(globalThis,'fetch',async()=>{throw Error('must not reach inference');});
 const failed=await api.generateSuggestions(undefined,[],settings);assert.equal(failed.fallback,true);assert.deepEqual(failed.suggestions,[]);assert.match(failed.error,/credentials changed/);
});

test('changing the Vertex project, region or credential invalidates reply context without including secrets',()=>{
 const original=api.getSuggestionContextKey(undefined,[],settings);
 for(const patch of [{vertexProjectId:'other-project'},{vertexLocation:'us-central1'},{vertexCredentialId:'b'.repeat(64)}])assert.notEqual(api.getSuggestionContextKey(undefined,[],{...settings,...patch}),original);
 assert.ok(!original.includes('unused-ai-studio-key'));
 const translation={...settings,translationProvider:'vertex',translationModel:settings.aiModel,translateService:'ai'};
 const originalTranslation=api.getTranslationContextKey('Bonjour','zh',translation);
 for(const patch of [{vertexProjectId:'other-project'},{vertexLocation:'us-central1'},{vertexCredentialId:'b'.repeat(64)}])assert.notEqual(api.getTranslationContextKey('Bonjour','zh',{...translation,...patch}),originalTranslation);
});
