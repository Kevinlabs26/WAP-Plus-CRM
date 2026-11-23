import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/localSpeech.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'speech-boundary-mocks', setup(b) {
    b.onResolve({ filter: /^(@tauri-apps\/api\/(core|event)|@\/lib\/mediaBlob)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.endsWith('/core')
      ? 'export const invoke = (...args) => globalThis.speechInvoke(...args);'
      : args.path.endsWith('/event')
        ? 'export const listen = (...args) => globalThis.speechListen(...args);'
        : 'export const mediaUrlToBlob = () => { throw new Error("not used"); };' }));
  } }],
});
const { downloadSpeechModel, SPEECH_MODEL_PRESETS } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('Tiny and Base download through native IPC, report only their own progress and expose failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('WebView attempted to download a model');
  try {
    for (const preset of SPEECH_MODEL_PRESETS) {
      const progress = [];
      let onEvent;
      let cleanup = 0;
      globalThis.speechListen = async (name, handler) => {
        assert.equal(name, 'speech-model-download-progress');
        onEvent = handler;
        return () => cleanup++;
      };
      globalThis.speechInvoke = async (command, args) => {
        assert.equal(command, 'download_speech_model');
        assert.deepEqual(args, { name: preset.id });
        onEvent({ payload: { model: 'other-model', received: 10, total: 100 } });
        onEvent({ payload: { model: preset.id, received: 25, total: 100 } });
        return 'installed';
      };
      const report = (...bytes) => progress.push(bytes);
      assert.equal(await downloadSpeechModel(preset, report), 'installed');
      assert.deepEqual(progress, [[25, 100]]);
      assert.equal(cleanup, 1);
      globalThis.speechInvoke = async () => { throw '模型下载失败：HTTP 503'; };
      await assert.rejects(downloadSpeechModel(preset, report), /HTTP 503/);
      assert.equal(cleanup, 2);
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.speechListen;
    delete globalThis.speechInvoke;
  }
});
