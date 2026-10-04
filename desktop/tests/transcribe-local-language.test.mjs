import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/transcribeVoice.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'local-transcription-boundary', setup(b) {
    b.onResolve({ filter: /^\.\/localSpeech$/ }, () => ({ path: 'localSpeech', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      export const findReadyLocalModel = async () => ({ name: 'whisper-tiny', ready: true });
      export const localTranscribe = async opts => { globalThis.localTranscriptionOptions = opts; return globalThis.localTranscriptionHook ? globalThis.localTranscriptionHook() : 'bonjour'; };
    ` }));
  } }],
});
const { transcribeVoice } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('concurrent requests are rejected before decoding or uploading, and failures release the slot', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let release;
  globalThis.localTranscriptionHook = () => new Promise(resolve => { release = resolve; });
  try {
    const first = transcribeVoice('data:audio/ogg;base64,SGVsbG8=', 'audio/ogg', {});
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const second = await transcribeVoice('data:audio/ogg;base64,SGVsbG8=', 'audio/ogg', {});
    assert.equal(second.source, 'mock');
    assert.match(second.error, /正在转写/);
    release('done');
    assert.equal((await first).source, 'local');
    globalThis.localTranscriptionHook = () => { throw new Error('failed inference'); };
    const settings = { aiProvider: 'ollama' };
    assert.equal((await transcribeVoice('data:audio/ogg;base64,SGVsbG8=', 'audio/ogg', settings)).fallback, true);
    delete globalThis.localTranscriptionHook;
    assert.equal((await transcribeVoice('data:audio/ogg;base64,SGVsbG8=', 'audio/ogg', settings)).source, 'local');
  } finally { delete globalThis.localTranscriptionHook; console.warn = originalWarn; }
});

test('local transcription receives the selected language and stays offline', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw new Error('local transcription must not upload audio'); };
    for (const [selected, expected] of [['fr', 'fr'], ['ZH', 'zh'], ['', undefined], ['invalid', undefined]]) {
      const result = await transcribeVoice('data:audio/ogg;base64,SGVsbG8=', 'audio/ogg', { voiceInputLang: selected });
      assert.equal(result.source, 'local');
      assert.equal(result.fallback, false);
      assert.equal(globalThis.localTranscriptionOptions.language, expected);
      assert.equal(globalThis.localTranscriptionOptions.model, 'whisper-tiny');
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localTranscriptionOptions;
  }
});
