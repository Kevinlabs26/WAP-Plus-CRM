import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/localSpeech.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'speech-boundary-mocks', setup(b) {
    b.onResolve({ filter: /^(@tauri-apps\/api\/core|@\/lib\/mediaBlob)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('core')
      ? 'export const invoke = (...args) => globalThis.speechInvocations.push(args);'
      : 'export const mediaUrlToBlob = () => { throw new Error("not used"); };' }));
  } }],
});
const { downloadSpeechModel, SPEECH_MODEL_PRESETS } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('model download bounds advertised and streamed sizes before IPC, with or without progress', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const advertised of [0, 512 * 1024 * 1024 + 1]) {
      for (const progress of [undefined, () => {}]) {
        globalThis.speechInvocations = [];
        let cancelled = false;
        const reader = { read: async () => ({ done: false, value: { byteLength: 512 * 1024 * 1024 + 1 } }), cancel: async () => { cancelled = true; }, releaseLock() {} };
        globalThis.fetch = async (_url, options) => {
          assert.ok(options.signal instanceof AbortSignal);
          return { ok: true, headers: new Headers({ 'content-length': String(advertised) }), body: { getReader: () => reader, cancel: reader.cancel } };
        };
        await assert.rejects(downloadSpeechModel(SPEECH_MODEL_PRESETS[0], progress), /512 MiB/);
        assert.equal(cancelled, true);
        assert.deepEqual(globalThis.speechInvocations, []);
      }
    }
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
    await downloadSpeechModel(SPEECH_MODEL_PRESETS[0]);
    assert.deepEqual(Array.from(new Uint8Array(globalThis.speechInvocations[0][1])), [1, 2, 3]);
    assert.equal(globalThis.speechInvocations[0][0], 'save_speech_model');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.speechInvocations;
  }
});
