import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
async function bundle(contents, mocks) {
  const built = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, write: false, platform: 'browser', format: 'esm', alias: { '@': sourceRoot },
    plugins: [{ name: 'voice-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
}

const { transcribeVoice } = await bundle(`export { transcribeVoice } from './src/lib/transcribeVoice.ts';`, {
  './localSpeech': `export const findReadyLocalModel = async () => null;`,
  '@/lib/mediaBlob': `export const mediaUrlToBlob = async () => new Blob(['fixture'], { type: 'audio/webm' });`,
});
const { startVoiceInput, useComposerVoiceInput, useMessageActions } = await bundle(`
  export { startVoiceInput } from './src/lib/speechToText.ts';
  export { useComposerVoiceInput } from './src/components/chat/useComposerVoiceInput.ts';
  export { useMessageActions } from './src/components/chat/useMessageActions.ts';`, {
  react: `export const useRef = value => globalThis.voiceHooks.ref(value);
    export const useState = value => globalThis.voiceHooks.state(value);
    export const useEffect = (fn, deps) => globalThis.voiceHooks.effect(fn, deps);
    export const useCallback = fn => fn;`,
  '@/store/appStore': `export const useAppStore = { getState: () => globalThis.voiceState };`,
  '@/lib/transcribeVoice': `export const transcribeVoice = (...args) => globalThis.voiceResult(...args);`,
  '@/lib/voiceRecord': `export const startVoiceRecording = async () => globalThis.voiceRecording;`,
  '@/lib/translateDraft': `export const resolveMyLang = () => 'fr';
    export const translateDraftText = async (...args) => { globalThis.voiceTranslations.push(args); return { text: 'bonjour', targetLang: 'fr', fallback: false }; };`,
});

function runtime() {
  const cells = [], effects = []; let cursor = 0;
  const hooks = {
    ref(value) { return cells[cursor++] ??= { current: value }; },
    state(value) { const i = cursor++; cells[i] ??= { value };
      return [cells[i].value, next => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
    effect(fn, deps) { const i = cursor++, prev = cells[i];
      if (prev && deps.every((d, n) => Object.is(d, prev.deps[n]))) return;
      cells[i] = { deps, cleanup: prev?.cleanup };
      effects.push(() => { cells[i].cleanup?.(); cells[i].cleanup = fn(); }); },
  };
  return {
    render(fn) { globalThis.voiceHooks = hooks; cursor = 0; const result = fn(); while (effects.length) effects.shift()(); return result; },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}
function fixture(engine = 'ai') {
  const r = runtime(), toasts = [], writes = [];
  let draft = '原有报价草稿';
  const options = { editingId: null, fullSettings: () => ({ voiceInputEngine: engine, voiceInputLang: 'fr' }),
    readDraft: () => draft, setDraftLocal: text => { draft = text; writes.push(['local', text]); },
    flushDraftNow: text => { draft = text; writes.push(['flush', text]); },
    pushToast: (...args) => toasts.push(args), focusTextarea() {} };
  globalThis.voiceRecording = { stop: async () => ({ dataUrl: 'data:audio/webm;base64,ZmFrZQ==', mimeType: 'audio/webm' }), cancel() {} };
  return { render: () => r.render(() => useComposerVoiceInput(options)), unmount: () => r.unmount(), toasts, writes,
    get draft() { return draft; }, set draft(text) { draft = text; } };
}

test('real transcription returns empty text and an error for missing credentials and rejected or empty cloud responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const missing = await transcribeVoice('fixture', 'audio/webm', { aiProvider: 'ollama' });
    assert.equal(missing.text, ''); assert.equal(missing.fallback, true); assert.match(missing.error, /单独配置语音转写/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 });
    const failed = await transcribeVoice('fixture', 'audio/webm', { aiProvider: 'openai', openaiKey: 'fixture-only' });
    assert.equal(failed.text, ''); assert.match(failed.error, /401.*invalid key/);
    globalThis.fetch = async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 });
    const empty = await transcribeVoice('fixture', 'audio/webm', { aiProvider: 'openai', openaiKey: 'fixture-only' });
    assert.equal(empty.text, ''); assert.match(empty.error, /空转写/);
    globalThis.fetch = async () => new Response(JSON.stringify({ text: '  true transcript  ' }), { status: 200 });
    const success = await transcribeVoice('fixture', 'audio/webm', { aiProvider: 'openai', openaiKey: 'fixture-only' });
    assert.equal(success.text, 'true transcript'); assert.equal(success.fallback, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('incoming cloud audio omits dictation language and cancellation aborts the request without a fallback',async()=>{
 const original=globalThis.fetch;let request,started=false;
 try{
  globalThis.fetch=async(_url,options)=>{request=options;return new Response(JSON.stringify({text:'bonjour'}),{status:200});};
  const settings={transcriptionProvider:'custom',transcriptionApiKey:'fixture',transcriptionBaseUrl:'https://example.invalid/v1',transcriptionModel:'test',voiceInputLang:'zh'};
  await transcribeVoice('audio','audio/ogg',settings,{language:''});assert.equal(request.body.has('language'),false);
  await transcribeVoice('audio','audio/ogg',settings);assert.equal(request.body.get('language'),'zh');
  const controller=new AbortController();globalThis.fetch=(_url,options)=>{request=options;started=true;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
  const cancelled=transcribeVoice('audio','audio/ogg',settings,{signal:controller.signal,language:''});while(!started)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(cancelled,/abort/i);assert.equal(request.signal.aborted,true);
  await new Promise(resolve=>setImmediate(resolve));globalThis.fetch=async()=>new Response(JSON.stringify({text:'retry succeeds'}),{status:200});
  assert.equal((await transcribeVoice('audio','audio/ogg',settings,{language:''})).text,'retry succeeds');
 }finally{globalThis.fetch=original;}
});

for (const result of [
  { text: '【转写失败】旧服务占位', fallback: true, error: 'controlled failure' },
  { text: '', fallback: false },
  { text: 'invalid partial result', fallback: false, error: 'controlled failure' },
]) test(`message transcription preserves previous transcript and translation on ${JSON.stringify(result)}`, async () => {
  const r = runtime(), patches = [], toasts = [];
  globalThis.voiceState = { messages: [{ id: 'voice-A', mediaUrl: 'fixture', transcript: '已有真实转写', translation: 'existing translation' }], settings: {} };
  globalThis.voiceResult = async () => result; globalThis.voiceTranslations = [];
  try {
    const render = () => r.render(() => useMessageActions({ patchMessage: (...args) => patches.push(args), pushToast: (...args) => toasts.push(args) }));
    await render().transcribe('voice-A');
    assert.deepEqual(patches, []); assert.deepEqual(globalThis.voiceTranslations, []);
    assert.equal(toasts.length, 1); assert.equal(toasts[0][1], 'error'); assert.equal(render().transcribingId, null);
  } finally { r.unmount(); }
});

test('message transcription reports exceptions and still permits a successful retry', async () => {
  const r = runtime(), patches = [], toasts = [];
  globalThis.voiceState = { messages: [{ id: 'voice-A', mediaUrl: 'fixture', transcript: 'keep' }], settings: {} };
  globalThis.voiceTranslations = []; globalThis.voiceResult = async () => { throw new Error('controlled rejection'); };
  try {
    const render = () => r.render(() => useMessageActions({ patchMessage: (...args) => patches.push(args), pushToast: (...args) => toasts.push(args) }));
    await render().transcribe('voice-A'); assert.deepEqual(patches, []); assert.equal(render().transcribingId, null);
    assert.equal(toasts[0][1], 'error');
    globalThis.voiceResult = async () => ({ text: '  genuine transcript  ', fallback: false });
    await render().transcribe('voice-A');
    assert.deepEqual(patches, [['voice-A', { transcript: 'genuine transcript', translation: 'bonjour', translationLang: 'fr' }]]);
    assert.equal(toasts.at(-1)[1], 'success');
  } finally { r.unmount(); }
});

for (const result of [
  { text: 'legacy failure placeholder', fallback: true, error: 'controlled failure' },
  { text: '', fallback: false },
  { text: 'bad text', fallback: false, error: 'controlled failure' },
]) test(`AI service and composer preserve the draft and report one error on ${JSON.stringify(result)}`, async () => {
  const f = fixture(); globalThis.voiceResult = async () => result;
  try {
    await f.render().handleToggleVoiceInput(); await f.render().handleFinishVoiceInput();
    assert.equal(f.draft, '原有报价草稿'); assert.deepEqual(f.writes, []);
    assert.equal(f.toasts.length, 1); assert.equal(f.toasts[0][1], 'error');
    assert.equal(f.render().voiceInputOpen, false); assert.equal(f.render().voiceInputBusy, false);
  } finally { f.unmount(); }
});

test('AI input does not overwrite text edited while transcription was running', async () => {
  const f = fixture(); let release;
  globalThis.voiceResult = () => new Promise(resolve => { release = resolve; });
  try {
    await f.render().handleToggleVoiceInput(); const run = f.render().handleFinishVoiceInput();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    f.draft = '新输入报价'; release({ text: 'spoken text', fallback: false }); await run;
    assert.equal(f.draft, '新输入报价'); assert.deepEqual(f.writes, []); assert.match(f.toasts[0][0], /草稿已修改/);
  } finally { f.unmount(); }
});

test('successful AI input updates the visible editor before saving the recognized draft', async () => {
  const f = fixture(); globalThis.voiceResult = async () => ({text: '  真实语音报价  ', fallback: false});
  try {
    await f.render().handleToggleVoiceInput(); await f.render().handleFinishVoiceInput();
    assert.deepEqual(f.writes, [['local', '真实语音报价'], ['flush', '真实语音报价']]);
    assert.equal(f.draft, '真实语音报价'); assert.deepEqual(f.toasts, []);
  } finally { f.unmount(); }
});

test('cancelling an AI service suppresses late failure callbacks, and switching the composer rejects its late result', async () => {
  let release; const errors = [];
  globalThis.voiceRecording = { stop: async () => ({ dataUrl: 'fixture', mimeType: 'audio/webm' }), cancel() {} };
  globalThis.voiceResult = () => new Promise(resolve => { release = resolve; });
  const session = await startVoiceInput({ settings: { voiceInputEngine: 'ai' }, onError: text => errors.push(text) });
  const stop = session.stop(); while (!release) await new Promise(resolve => setImmediate(resolve));
  session.cancel(); release({ text: 'old failure', fallback: true, error: 'late failure' });
  assert.equal((await stop).text, ''); assert.deepEqual(errors, []);
  const f = fixture(); release = undefined;
  try {
    await f.render().handleToggleVoiceInput(); const run = f.render().handleFinishVoiceInput();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    f.render().resetVoiceInput(); f.draft = '会话 B 草稿';
    release({ text: '会话 A 迟到转写', fallback: false }); await run;
    assert.equal(f.draft, '会话 B 草稿'); assert.deepEqual(f.writes, []); assert.deepEqual(f.toasts, []);
  } finally { f.unmount(); }
});

function browserFixture(onStart) {
  const originalWindow = globalThis.window; let recognition;
  globalThis.window = { setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {},
    SpeechRecognition: class {
      constructor() { recognition = this; this.starts = 0; this.aborts = 0; }
      start() { this.starts++; onStart?.(this); }
      stop() {}
      abort() { this.aborts++; }
    } };
  const f = fixture('browser');
  return { f, get recognition() { return recognition; }, cleanup() { f.unmount(); globalThis.window = originalWindow; },
    interim(text) { recognition.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] }); } };
}

for(const original of ['', '原有报价草稿']) test(`second speech click stops and saves recognized text without cancelling (original=${JSON.stringify(original)})`,async()=>{
 const b=browserFixture();b.f.draft=original;let stops=0;
 try{
 const button=b.f.render().handleToggleVoiceInput;
 const starting=button();await button();await starting;
 assert.equal(b.recognition.starts,1,'rapid startup clicks must not start another recognition');
 b.interim('Bonjour, ma sœur');assert.equal(b.f.draft,'Bonjour, ma sœur');
 b.recognition.stop=()=>{stops++;b.interim('Bonjour, ma sœur. À bientôt !');};
 const stopping=button();await button();await stopping;
 assert.equal(stops,1);assert.equal(b.recognition.aborts,0);assert.equal(b.f.draft,'Bonjour, ma sœur. À bientôt !');
 assert.deepEqual(b.f.writes.at(-1),['flush','Bonjour, ma sœur. À bientôt !']);assert.equal(b.f.render().voiceInputOpen,false);assert.equal(b.f.render().voiceInputBusy,false);assert.deepEqual(b.f.toasts,[]);
 }finally{b.cleanup();}
});

test('second click finishes AI input and repeated clicks cannot restart it while transcription is pending',async()=>{
 const f=fixture();let release,stops=0,cancels=0;
 globalThis.voiceRecording={stop:async()=>{stops++;return {dataUrl:'fixture',mimeType:'audio/webm'};},cancel:()=>cancels++};
 globalThis.voiceResult=()=>new Promise(resolve=>{release=resolve;});
 try{
 await f.render().handleToggleVoiceInput();const button=f.render().handleToggleVoiceInput;const finishing=button();
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 await button();await f.render().handleToggleVoiceInput();assert.equal(f.render().voiceInputBusy,true);assert.equal(f.draft,'原有报价草稿');
 release({text:'Bonjour, ma sœur',fallback:false});await finishing;
 assert.equal(stops,1);assert.equal(cancels,0);assert.equal(f.draft,'Bonjour, ma sœur');assert.equal(f.render().voiceInputOpen,false);assert.deepEqual(f.toasts,[]);
 }finally{f.unmount();}
});

test('browser recognition failure restores the original draft and reports once despite duplicate error events and stop', async () => {
  const b = browserFixture();
  try {
    await b.f.render().handleToggleVoiceInput(); b.interim('临时识别'); assert.equal(b.f.draft, '临时识别');
    b.recognition.onerror({ error: 'network' }); b.recognition.onerror({ error: 'network' });
    assert.equal(b.f.draft, '原有报价草稿');
    assert.equal(b.f.render().voiceInputOpen, false);
    assert.equal(b.f.render().voiceInputBusy, false);
    assert.equal(b.f.render().voiceInputEngineLabel, '');
    assert.ok(b.recognition.aborts > 0);
    assert.match(b.f.toasts[0][0], /语音服务连接失败.*AI 转写/);
    await b.f.render().handleFinishVoiceInput();
    assert.equal(b.f.draft, '原有报价草稿'); assert.equal(b.f.toasts.length, 1); assert.equal(b.f.toasts[0][1], 'error');
    const failed = b.recognition;
    await b.f.render().handleToggleVoiceInput();
    assert.notEqual(b.recognition, failed);
    assert.equal(b.f.render().voiceInputOpen, true);
    failed.onerror({ error: 'network' });
    assert.equal(b.f.render().voiceInputOpen, true);
    b.interim('重新识别');
    await b.f.render().handleFinishVoiceInput();
    assert.equal(b.f.draft, '重新识别'); assert.equal(b.f.toasts.length, 1);
  } finally { b.cleanup(); }
});

test('an error during browser startup cannot leave a failed session listening', async () => {
  const b = browserFixture(recognition => recognition.onerror({ error: 'network' }));
  try {
    await b.f.render().handleToggleVoiceInput();
    assert.equal(b.f.render().voiceInputOpen, false);
    assert.equal(b.f.render().voiceInputBusy, false);
    assert.equal(b.f.render().voiceInputEngineLabel, '');
    assert.equal(b.f.draft, '原有报价草稿'); assert.equal(b.f.toasts.length, 1);
    assert.ok(b.recognition.aborts > 0);
  } finally { b.cleanup(); }
});

test('a pending browser restart does not run after an error', async () => {
  const b = browserFixture();
  try {
    await b.f.render().handleToggleVoiceInput();
    b.recognition.onend();
    b.recognition.onerror({ error: 'network' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.recognition.starts, 1);
    assert.equal(b.f.render().voiceInputOpen, false); assert.equal(b.f.toasts.length, 1);
  } finally { b.cleanup(); }
});

test('a failed browser restart closes the listening state and restores the draft', async () => {
  const b = browserFixture(recognition => { if (recognition.starts > 1) throw new Error('restart unavailable'); });
  try {
    await b.f.render().handleToggleVoiceInput(); b.interim('临时识别'); b.recognition.onend();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.f.render().voiceInputOpen, false);
    assert.equal(b.f.render().voiceInputBusy, false);
    assert.equal(b.f.draft, '原有报价草稿'); assert.equal(b.f.toasts.length, 1);
    assert.match(b.f.toasts[0][0], /已中断/);
  } finally { b.cleanup(); }
});

for (const error of [true, false]) test(`browser ${error ? 'failure' : 'success'} preserves manual edits during recognition`, async () => {
  const b = browserFixture();
  try {
    await b.f.render().handleToggleVoiceInput(); b.interim('临时识别'); b.f.draft = '手工补充';
    b.interim('更多临时识别'); assert.equal(b.f.draft, '手工补充');
    if (error) b.recognition.onerror({ error: 'network' });
    await b.f.render().handleFinishVoiceInput(); assert.equal(b.f.draft, '手工补充');
    assert.equal(b.f.toasts.length, 1);
  } finally { b.cleanup(); }
});

test('browser manual cancellation restores its draft while a chat reset cannot copy the previous draft into the new chat', async () => {
  const b = browserFixture();
  try {
    await b.f.render().handleToggleVoiceInput(); b.interim('临时识别'); b.f.render().handleCancelVoiceInput();
    assert.equal(b.f.draft, '原有报价草稿'); assert.deepEqual(b.f.toasts, []);
    await b.f.render().handleToggleVoiceInput(); b.interim('相同文本'); b.f.draft = '相同文本';
    b.f.render().resetVoiceInput(); assert.equal(b.f.draft, '相同文本');
  } finally { b.cleanup(); }
});
