import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { translate } from '../src/i18n/core.ts';

const mocks={
  "./SettingsLocalSpeechPanel":"export const SettingsLocalSpeechPanel=()=>null;",
  react:'export const useState=v=>[typeof v==="function"?v():v,()=>{}];export const useRef=v=>({current:v});export const useEffect=()=>{};export const useCallback=f=>f;',
  'react/jsx-runtime':'export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment="fragment";',
  '@/store/appStore':'export const useAppStore=f=>f(globalThis.speechState);useAppStore.getState=()=>globalThis.speechState;',
  '@/components/ui/primitives':'export const Input="input",SectionLabel="h4";',
  '@/i18n':'export const useI18n=()=>({t:(key,params)=>globalThis.speechTranslate(key,params)});',
  './localSpeech':'export const findReadyLocalModel=async()=>globalThis.speechLocal?{name:"local"}:null;export const localTranscribe=async()=>"local transcript";',
  '@/lib/mediaBlob':'export const mediaUrlToBlob=async()=>new Blob(["audio"],{type:"audio/ogg"});',
  './gemini.ts':'export const GEMINI_DEFAULT_MODEL="gemini-default";export const geminiGenerate=async()=>"unused";export const geminiTranscribeAudio=async opts=>{globalThis.speechGemini=opts;return "gemini transcript";};',
  '@/lib/storage':'export const getStorageEngine=()=>"sqlite"; export const canPersistRowDeltas=()=>false;export const saveSecureSecrets=async s=>{globalThis.speechSaves.push(s);await globalThis.speechSaveWait?.();return !globalThis.speechSaveFail;};export const loadSecureSecrets=async()=>globalThis.speechSecrets;export const loadAppState=async()=>globalThis.speechSnapshot;export const saveAppState=async()=>{};export const clearAppState=async()=>{};export const registerChatMessageReplacements=()=>{};',
  './persist':'export const persist=()=>{};export const flushPersist=async get=>{globalThis.speechFlushed=get().settings;};export const primePersistBaseline=()=>{};export const buildPersistSlice=s=>s;',
  './exportDataActions':'export const exportBackup=()=>{};export const exportContactsCsv=()=>{};',
  '@/channels/sendGate':'export const waitForPendingSends=async()=>{};',
  '@/lib/mediaCache':'export const cacheMediaUrl=async()=>{};export const readMediaCache=async()=>null;export const dropMediaCache=async()=>{};',
};
const built=await build({stdin:{contents:`export * from './src/lib/transcriptionConfig.ts';export * from './src/lib/translationConfig.ts';export {translateDraftText,getTranslationContextKey} from './src/lib/translateDraft.ts';export {listProviderModels} from './src/lib/listModels.ts';export {SettingsTranslationPanel} from './src/components/settings/SettingsTranslationPanel.tsx';export {defaultSettings,normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {transcribeVoice} from './src/lib/transcribeVoice.ts';export {useMessageActions} from './src/components/chat/useMessageActions.ts';export {SettingsAiPanel,AiServiceFields} from './src/components/settings/SettingsAiPanel.tsx';export {SettingsSpeechPanel} from './src/components/settings/SettingsSpeechPanel.tsx';export {createSettingsActionsSlice} from './src/store/settingsActionsSlice.ts';export {createBootSlice} from './src/store/bootSlice.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},
  bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},
  plugins:[{name:'speech-config-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}],
});
const mod=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree?.props?[tree,...nodes(tree.props.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree?.props?text(tree.props.children):typeof tree==='string'||typeof tree==='number'?String(tree):'';
const field=(tree,label)=>nodes(nodes(tree).find(n=>n.type==='label'&&text(n).startsWith(label))).find(n=>n.type==='input'||n.type==='select');

function fixture(settings={}) {
  const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldLog=console.info;
  globalThis.window={setTimeout:()=>0};console.info=()=>{};
  globalThis.speechSaves=[];globalThis.speechSaveFail=false;globalThis.speechLocal=false;globalThis.speechSnapshot=null;globalThis.speechSecrets=null;globalThis.speechFlushed=null;globalThis.speechGemini=null;
  globalThis.speechTranslate=(key,params)=>translate('zh-CN',key,params);
  globalThis.speechState={settings:{...mod.defaultSettings,...settings},contacts:[],chats:[],messages:[],phones:[],followUps:[],activities:[],broadcastCampaigns:[],stats:{},recomputeStats(){},pushToast(){}};
  const ctx={get:()=>speechState,set:patch=>Object.assign(speechState,typeof patch==='function'?patch(speechState):patch)};
  Object.assign(speechState,mod.createSettingsActionsSlice(ctx),mod.createBootSlice(ctx));
  const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({text:'speech transcript'}),{status:200});};
  return{ctx,requests,render:()=>[mod.SettingsAiPanel(),mod.AiServiceFields({settings:speechState.settings,updateSettings:speechState.updateSettings})],close(){globalThis.fetch=oldFetch;globalThis.window=oldWindow;console.info=oldLog;for(const key of ['speechState','speechSaves','speechSaveFail','speechLocal','speechSnapshot','speechSecrets','speechFlushed','speechGemini','speechTranslate'])delete globalThis[key];}};
}

test('legacy providers migrate once; later text provider/model/key changes cannot change the speech config',()=>{
  for(const provider of ['openai','groq','gemini','custom']) {
    const old={aiProvider:provider,openaiKey:'oa',groqKey:'gq',geminiKey:'gm',customAiKey:'custom-key',customAiBaseUrl:'http://127.0.0.1:9100/v1/',customAiModel:'text',customWhisperModel:'speech',aiModel:'gemini-audio'};
    const migrated=mod.normalizeLoadedSettings(old),original=mod.resolveTranscriptionConfig(migrated);
    assert.equal(original.provider,provider);assert.ok(original.apiKey);assert.ok(original.model);
    const changed=mod.normalizeLoadedSettings({...migrated,aiProvider:'mock',openaiKey:'changed',customAiBaseUrl:'https://text-changed.invalid',customWhisperModel:'changed',aiModel:'text-model'});
    assert.deepEqual(mod.resolveTranscriptionConfig(changed),original);
    if(provider==='custom')assert.equal(original.baseUrl,'http://127.0.0.1:9100/v1');
  }
  for(const provider of ['ollama','deepseek','mock'])assert.equal(mod.normalizeLoadedSettings({aiProvider:provider}).transcriptionProvider,'none');
  assert.equal(mod.normalizeLoadedSettings({transcriptionProvider:'constructor'}).transcriptionProvider,'none');
});

test('custom audio requests use only the speech endpoint, key and model, retaining language selection',async()=>{
  const ui=fixture({aiProvider:'custom',customAiBaseUrl:'https://text.invalid/v1',customAiKey:'text-key',customAiModel:'text-model',
    transcriptionProvider:'custom',transcriptionBaseUrl:'http://127.0.0.1:9200/v1',transcriptionApiKey:'speech-key',transcriptionModel:'speech-model',voiceInputLang:'fr'});
  try {
    const result=await mod.transcribeVoice('audio','audio/ogg',speechState.settings);assert.equal(result.text,'speech transcript');assert.equal(result.source,'custom');
    const request=ui.requests[0];assert.equal(request.url,'http://127.0.0.1:9200/v1/audio/transcriptions');assert.equal(request.options.headers.Authorization,'Bearer speech-key');
    assert.equal(request.options.body.get('model'),'speech-model');assert.equal(request.options.body.get('language'),'fr');assert.equal(request.options.body.get('file').name,'voice.ogg');
    speechState.updateSettings({aiProvider:'ollama',customAiKey:'another-text-key'});await mod.transcribeVoice('audio','audio/ogg',speechState.settings);
    assert.equal(ui.requests[1].url,request.url);assert.equal(ui.requests[1].options.headers.Authorization,'Bearer speech-key');
  }finally{ui.close();}
});

test('Gemini receives its independent key/model; local-only mode never uploads audio even with valid text credentials',async()=>{
  const ui=fixture({aiProvider:'custom',customAiKey:'text-key',customAiBaseUrl:'https://text.invalid',transcriptionProvider:'gemini',transcriptionApiKey:'speech-key',transcriptionModel:'audio-model'});
  const oldReader=globalThis.FileReader;
  globalThis.FileReader=class{readAsDataURL(){this.result='data:audio/ogg;base64,YXVkaW8=';this.onload();}};
  try {
    assert.equal((await mod.transcribeVoice('audio','audio/ogg',speechState.settings)).source,'gemini');assert.equal(speechGemini.apiKey,'speech-key');assert.equal(speechGemini.model,'audio-model');
    speechState.updateSettings({transcriptionProvider:'none'});let result=await mod.transcribeVoice('audio','audio/ogg',speechState.settings);assert.equal(result.text,'');assert.match(result.error,/单独配置/);assert.equal(ui.requests.length,0);
    globalThis.speechLocal=true;result=await mod.transcribeVoice('audio','audio/ogg',speechState.settings);assert.equal(result.source,'local');assert.equal(result.text,'local transcript');assert.equal(ui.requests.length,0);
  }finally{globalThis.FileReader=oldReader;ui.close();}
});

test('a received voice message transcribes with the speech service, then translates with the text service',async()=>{
  const ui=fixture({aiProvider:'custom',customAiBaseUrl:'https://reply.invalid/v1',customAiKey:'reply-key',customAiModel:'reply-model',translationProvider:'custom',translationBaseUrl:'https://text.invalid/v1',translationApiKey:'text-key',translationModel:'text-model',translateService:'ai',myLang:'zh',
    transcriptionProvider:'custom',transcriptionBaseUrl:'https://speech.invalid/v1',transcriptionApiKey:'speech-key',transcriptionModel:'speech-model'});
  try {
    const requests=[],patches=[],toasts=[];speechState.messages=[{id:'voice',mediaUrl:'audio',mediaMime:'audio/ogg'}];
    globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.includes('/audio/transcriptions')
      ?{text:'Bonjour, la quantité de cette commande est confirmée.'}:{choices:[{message:{content:'这笔订单的数量已经确认。'}}]}),{status:200});};
    await mod.useMessageActions({patchMessage:(...args)=>patches.push(args),pushToast:(...args)=>toasts.push(args)}).transcribe('voice');
    assert.equal(requests.length,2);assert.equal(requests[0].url,'https://speech.invalid/v1/audio/transcriptions');assert.equal(requests[0].options.headers.Authorization,'Bearer speech-key');
    assert.equal(requests[1].url,'https://text.invalid/v1/chat/completions');assert.equal(requests[1].options.headers.Authorization,'Bearer text-key');assert.equal(JSON.parse(requests[1].options.body).model,'text-model');
    assert.equal(patches[0][1].transcript,'Bonjour, la quantité de cette commande est confirmée.');assert.equal(patches[0][1].translation,'这笔订单的数量已经确认。');assert.equal(patches[0][1].translationLang,'zh');assert.equal(toasts.at(-1)[1],'success');
  }finally{ui.close();}
});

test('missing speech credentials and invalid endpoint protocols fail without uploading or borrowing text credentials',async()=>{
  const ui=fixture({aiProvider:'openai',openaiKey:'text-key',transcriptionProvider:'custom',transcriptionBaseUrl:'https://speech.invalid/v1',transcriptionModel:'speech'});
  try {
    assert.match((await mod.transcribeVoice('audio','audio/ogg',speechState.settings)).error,/语音转写服务缺少/);assert.equal(ui.requests.length,0);
    speechState.updateSettings({transcriptionApiKey:'speech-key',transcriptionBaseUrl:'file:///private'});
    assert.match((await mod.transcribeVoice('audio','audio/ogg',speechState.settings)).error,/HTTP/);assert.equal(ui.requests.length,0);
  }finally{ui.close();}
});

test('the settings page separates speech fields; changing text presets leaves speech intact and provider switching clears the old speech key',async()=>{
  const ui=fixture({aiProvider:'custom',customAiKey:'text-key',customAiBaseUrl:'https://text.invalid/v1',customAiModel:'text-model',transcriptionProvider:'custom',transcriptionApiKey:'speech-key',transcriptionBaseUrl:'https://speech.invalid/v1',transcriptionModel:'speech-model'});
  try {
    let tree=[ui.render(),mod.SettingsSpeechPanel()];assert.ok(text(tree).includes('语音转文字'));assert.ok(text(tree).includes('回复 AI'));assert.ok(!text(tree).includes('共用的模型服务'));
    const before=mod.resolveTranscriptionConfig(speechState.settings);field(tree,'常用预设').props.onChange({target:{value:'deepseek'}});assert.deepEqual(mod.resolveTranscriptionConfig(speechState.settings),before);
    field(tree,'语音转写模型').props.onChange({target:{value:'audio-updated'}});assert.equal(speechState.settings.customAiModel,'deepseek-chat');assert.equal(speechState.settings.transcriptionModel,'audio-updated');
    const secret=field(tree,'语音服务 API Key');assert.equal(secret.props.type,'password');
    secret.props.onChange({target:{value:'separate-key'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(speechSaves.at(-1).transcriptionApiKey,'separate-key');assert.equal(speechState.settings.customAiKey,'text-key');
    field(tree,'语音服务提供商').props.onChange({target:{value:'groq'}});tree=mod.SettingsSpeechPanel();assert.equal(speechState.settings.transcriptionApiKey,'');assert.equal(speechState.settings.transcriptionModel,'whisper-large-v3-turbo');assert.equal(field(tree,'语音服务 Base URL').props.value,'https://api.groq.com/openai/v1');await new Promise(resolve=>setImmediate(resolve));
  }finally{ui.close();}
});

test('speech connection settings collapse for built-in services and remain visible for custom endpoints',()=>{
  for(const provider of ['groq','openai','custom','gemini','none']) {
    const ui=fixture({transcriptionProvider:provider,transcriptionBaseUrl:'https://speech.invalid/v1'});
    try {
      const tree=mod.SettingsSpeechPanel(),details=nodes(tree).filter(n=>n.type==='details');
      assert.equal(details.length,['gemini','none'].includes(provider)?0:1);
      if(details.length){assert.equal(details[0].props.open,provider==='custom');assert.equal(field(tree,'语音服务 Base URL').props.value,'https://speech.invalid/v1');}
      assert.equal(speechSaves.length,0);
    }finally{ui.close();}
  }
});

test('boot securely copies the old speech key before persisting migrated config, and the config survives a restart',async()=>{
  const ui=fixture();try {
    speechSnapshot={phones:[],contacts:[],chats:[],messages:[],followUps:[],settings:{aiProvider:'custom',customAiBaseUrl:'https://old.invalid/v1',customAiModel:'text',customWhisperModel:'speech'}};
    speechSecrets={openaiKey:'',groqKey:'',geminiKey:'',deepseekKey:'',qwenKey:'',zhipuKey:'',openrouterKey:'',customAiKey:'old-key',transcriptionApiKey:'',bridgeToken:''};
    await speechState.hydrate();assert.equal(speechSaves.at(-1).transcriptionApiKey,'old-key');assert.equal(speechFlushed.transcriptionProvider,'custom');assert.equal(speechFlushed.transcriptionModel,'speech');
    speechSnapshot={...speechSnapshot,settings:{...speechFlushed,transcriptionApiKey:'',customAiKey:''}};speechSecrets=speechSaves.at(-1);speechSaves.length=0;
    await speechState.hydrate();assert.equal(speechState.settings.transcriptionApiKey,'old-key');assert.equal(speechState.settings.transcriptionModel,'speech');assert.equal(speechSaves.length,0);
  }finally{ui.close();}
});

test('failed speech-key migration stops hydration before saving the independent provider configuration',async()=>{
  const ui=fixture();try {
    speechSnapshot={phones:[],contacts:[],chats:[],messages:[],followUps:[],settings:{aiProvider:'openai'}};speechSecrets={openaiKey:'old-key',groqKey:'',transcriptionApiKey:''};speechSaveFail=true;
    await assert.rejects(speechState.hydrate(),/语音转写密钥安全迁移失败/);assert.equal(speechFlushed,null);assert.notEqual(speechState.hydrated,true);
  }finally{ui.close();}
});

test('legacy translation configuration migrates once, then ignores reply and speech changes',()=>{
  const migrated=mod.normalizeLoadedSettings({aiProvider:'custom',customAiKey:'legacy-key',customAiBaseUrl:'https://legacy.invalid/v1',customAiModel:'legacy-text'});
  assert.equal(migrated.translationProvider,'custom');assert.equal(migrated.translationApiKey,'legacy-key');
  assert.equal(migrated.translationBaseUrl,'https://legacy.invalid/v1');assert.equal(migrated.translationModel,'legacy-text');
  const changed=mod.normalizeLoadedSettings({...migrated,aiProvider:'gemini',geminiKey:'reply-key',aiModel:'reply-model',transcriptionApiKey:'new-speech-key'});
  assert.deepEqual(mod.resolveTranslationConfig(changed),mod.resolveTranslationConfig(migrated));
  assert.equal(mod.normalizeLoadedSettings({aiProvider:'groq',groqKey:'old-key',aiModel:'whisper-large-v3-turbo'}).translationModel,mod.GROQ_TRANSLATION_MODEL);
});

test('translation requests and caches use only the independent translation service',async()=>{
  const ui=fixture({aiProvider:'custom',customAiKey:'reply-key',customAiBaseUrl:'https://reply.invalid/v1',customAiModel:'reply-model',
    translationProvider:'groq',translationApiKey:'translation-key',translationModel:'openai/gpt-oss-20b',translateService:'ai',transcriptionApiKey:'speech-key'});
  try {
    const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({choices:[{message:{content:'明天见，我们会确认这笔订单。'}}]});};
    const source='Bonjour mon ami, nous confirmerons cette commande demain.';
    const key=mod.getTranslationContextKey(source,'zh',speechState.settings);
    const result=await mod.translateDraftText(source,'zh',speechState.settings);
    assert.equal(result.source,'groq');assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(calls[0].options.headers.Authorization,'Bearer translation-key');
    assert.equal(JSON.parse(calls[0].options.body).model,'openai/gpt-oss-20b');
    assert.equal(JSON.parse(calls[0].options.body).reasoning_effort,'low');assert.equal(JSON.parse(calls[0].options.body).include_reasoning,false);
    speechState.updateSettings({aiProvider:'gemini',geminiKey:'other-reply-key',aiModel:'other-reply-model',transcriptionModel:'other-speech-model'});
    assert.equal(mod.getTranslationContextKey(source,'zh',speechState.settings),key);
    await mod.translateDraftText(source,'zh',speechState.settings);assert.equal(calls.length,1);
    speechState.updateSettings({translationApiKey:''});
    assert.equal((await mod.translateDraftText(source+' Merci.','zh',speechState.settings)).fallback,true);assert.equal(calls.length,1,'never borrow a reply or speech key');
    await new Promise(resolve=>setImmediate(resolve));
  }finally{ui.close();}
});

test('translation controls persist their own key and provider changes clear only that key',async()=>{
  const ui=fixture({aiProvider:'custom',customAiKey:'reply-key',customAiModel:'reply-model',translationProvider:'groq',translationApiKey:'translation-key',transcriptionApiKey:'speech-key'});
  try {
    const panel=mod.SettingsTranslationPanel();const form=nodes(panel).find(node=>node.type===mod.AiServiceFields);
    const fields=mod.AiServiceFields(form.props);const secret=nodes(fields).find(node=>node.props?.label==='Groq API Key');
    field(secret.type(secret.props),'Groq API Key').props.onChange({target:{value:'translation-key-updated'}});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(speechSaves.at(-1).translationApiKey,'translation-key-updated');
    assert.equal(speechState.settings.customAiKey,'reply-key');assert.equal(speechState.settings.transcriptionApiKey,'speech-key');
    form.props.updateSettings({aiProvider:'gemini',aiModel:''});
    assert.equal(speechState.settings.translationProvider,'gemini');assert.equal(speechState.settings.translationApiKey,'');
    assert.equal(speechState.settings.aiProvider,'custom');assert.equal(speechState.settings.customAiModel,'reply-model');
    await new Promise(resolve=>setImmediate(resolve));
  }finally{ui.close();}
});

test('chat and transcription model lists exclude incompatible tasks',async()=>{
  const ui=fixture({groqKey:'models-key'});
  try {
    globalThis.fetch=async()=>Response.json({data:['openai/gpt-oss-20b','whisper-large-v3','whisper-large-v3-turbo','canopylabs/orpheus-v1-english','text-embedding-3-small','meta-llama/llama-prompt-guard-2-22m'].map(id=>({id}))});
    assert.deepEqual((await mod.listProviderModels('groq',speechState.settings)).map(m=>m.id),['openai/gpt-oss-20b']);
    assert.deepEqual((await mod.listProviderModels('groq',speechState.settings,'transcription')).map(m=>m.id),['whisper-large-v3','whisper-large-v3-turbo']);
  }finally{ui.close();}
});

test('cloud transcription skips an installed local model and uses only the speech key',async()=>{
  const ui=fixture({transcriptionProvider:'groq',transcriptionApiKey:'speech-key',transcriptionModel:'whisper-large-v3-turbo',transcriptionLocalFirst:false,groqKey:'reply-key',translationApiKey:'translation-key'});
  try {
    globalThis.speechLocal=true;
    const result=await mod.transcribeVoice('audio','audio/ogg',speechState.settings);
    assert.equal(result.source,'groq');assert.equal(ui.requests.length,1);
    assert.equal(ui.requests[0].options.headers.Authorization,'Bearer speech-key');
    assert.equal(ui.requests[0].options.body.get('model'),'whisper-large-v3-turbo');
  }finally{ui.close();}
});

test('a legacy translation key is saved securely during hydration before the independent settings persist',async()=>{
  const ui=fixture();try {
    speechSnapshot={phones:[],contacts:[],chats:[],messages:[],followUps:[],settings:{aiProvider:'groq',aiModel:'openai/gpt-oss-20b',transcriptionProvider:'none'}};
    speechSecrets={openaiKey:'',groqKey:'old-translation-key',transcriptionApiKey:'',translationApiKey:''};
    await speechState.hydrate();
    assert.equal(speechSaves.at(-1).translationApiKey,'old-translation-key');assert.equal(speechFlushed.translationProvider,'groq');
    assert.equal(speechState.settings.translationApiKey,'old-translation-key');
  }finally{ui.close();}
});

test('failed translation-only key migration does not persist a half-migrated configuration',async()=>{
  const ui=fixture();try {
    speechSnapshot={phones:[],contacts:[],chats:[],messages:[],followUps:[],settings:{aiProvider:'groq',transcriptionProvider:'none'}};
    speechSecrets={openaiKey:'',groqKey:'old-key',transcriptionApiKey:'',translationApiKey:''};speechSaveFail=true;
    await assert.rejects(speechState.hydrate(),/密钥安全迁移失败/);
    assert.equal(speechFlushed,null);assert.notEqual(speechState.hydrated,true);
  }finally{ui.close();}
});

test('failed secure writes can retry an unchanged key or retry explicitly without editing it',async()=>{
 const ui=fixture();
 try {
  speechSaveFail=true;
  speechState.updateSettings({openaiKey:'fictional-retry-key'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(speechState.secretSaveStatus,'failed');assert.equal(speechSaves.length,1);
  speechState.updateSettings({openaiKey:'fictional-retry-key'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(speechSaves.length,2);
  speechSaveFail=false;
  assert.equal(await speechState.retrySecretSave(),true);assert.equal(speechSaves.length,3);assert.equal(speechState.secretSaveStatus,'idle');
 }finally{ui.close();}
});

test('secure writes are serialized and a later edit wins when an earlier save is slow',async()=>{
 const ui=fixture();let release;
 globalThis.speechSaveWait=()=>new Promise(resolve=>{release=resolve;globalThis.speechSaveWait=undefined;});
 try {
  speechState.updateSettings({openaiKey:'fictional-first'});await new Promise(resolve=>setImmediate(resolve));
  speechState.updateSettings({openaiKey:'fictional-latest'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(speechSaves.length,1);assert.equal(speechState.secretSaveStatus,'saving');
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(speechSaves.length,2);assert.equal(speechSaves.at(-1).openaiKey,'fictional-latest');assert.equal(speechState.secretSaveStatus,'idle');
 }finally{delete globalThis.speechSaveWait;ui.close();}
});
