import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = buildSync({ stdin: { contents: `
export { normalizeLoadedSettings } from './src/store/settingsDefaults';
export { getOpenAiCompatibleConfig, hasAiCredentials } from './src/lib/aiProviders';
export { resolveTranslationConfig } from './src/lib/translationConfig';
export { resolveTranscriptionConfig } from './src/lib/transcriptionConfig';
export { isChatModel } from './src/lib/modelCapabilities';
export { isRetiredAiEndpoint } from './src/lib/retiredAiServices';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', alias: { '@': root + 'src' }, write: false });
const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

test('old providers and restored credentials are disabled without selecting another paid service', () => {
  for (const aiProvider of ['deepseek', 'qwen', 'zhipu']) {
    const settings = api.normalizeLoadedSettings({ aiProvider, aiReplyMode: 'auto', aiAutoFollowUpEnabled: true,
      deepseekKey: 'old-key', qwenKey: 'old-key', zhipuKey: 'old-key', translationProvider: aiProvider, translationApiKey: 'old-key' });
    assert.equal(settings.aiProvider, 'mock');
    assert.equal(settings.aiReplyMode, 'semi');
    assert.equal(settings.aiAutoReplyPaused, true);
    assert.equal(settings.aiAutoFollowUpEnabled, false);
    assert.equal(settings.translationProvider, 'mock');
    assert.equal(settings.translationApiKey, '');
    for (const key of ['deepseekKey', 'qwenKey', 'zhipuKey']) assert.equal(Object.hasOwn(settings, key), false);
    assert.equal(api.getOpenAiCompatibleConfig({ aiProvider }), null);
  }
});

test('old custom endpoints are rejected in chat, translation and transcription including subdomains', () => {
  for (const host of ['api.deepseek.com', 'dashscope.aliyuncs.com', 'open.bigmodel.cn', 'api.moonshot.cn', 'api.siliconflow.cn', 'sub.api.deepseek.com', 'API.DEEPSEEK.COM.', 'other.cn']) {
    const endpoint = `https://${host}/v1`;
    assert.equal(api.getOpenAiCompatibleConfig({ aiProvider: 'custom', customAiBaseUrl: endpoint, customAiKey: 'key', customAiModel: 'model' }), null);
    assert.equal(api.resolveTranslationConfig({ translationProvider: 'custom', translationBaseUrl: endpoint, translationApiKey: 'key' }).provider, 'mock');
    assert.equal(api.resolveTranscriptionConfig({ transcriptionProvider: 'custom', transcriptionBaseUrl: endpoint, transcriptionApiKey: 'key' }).provider, 'none');
    const settings = api.normalizeLoadedSettings({ aiProvider: 'custom', customAiBaseUrl: endpoint, customAiKey: 'key', customAiModel: 'model' });
    assert.equal(settings.customAiBaseUrl, '');
    assert.equal(settings.customAiKey, '');
    assert.equal(settings.aiProvider, 'mock');
  }
});

test('retired models are unavailable through model aggregators while other providers and Muse remain usable', () => {
  for (const aiModel of ['deepseek-ai/DeepSeek-V3', 'qwen/qwen3-32b', 'z-ai/glm-4.5', 'moonshotai/kimi-k2']) {
    assert.equal(api.isChatModel(aiModel), false);
    assert.equal(api.getOpenAiCompatibleConfig({ aiProvider: 'openrouter', aiModel, openrouterKey: 'key' }), null);
  }
  assert.equal(api.isChatModel('openai/gpt-4o-mini'), true);
  assert.equal(api.getOpenAiCompatibleConfig({ aiProvider: 'openai', openaiKey: 'key' }).apiKey, 'key');
  assert.equal(api.isRetiredAiEndpoint('https://deepseek.com.example.org'), false);
  assert.equal(api.resolveTranslationConfig({ aiProvider: 'openai', openaiKey: 'key', customAiBaseUrl: 'https://api.deepseek.com/v1' }).provider, 'openai');
  assert.equal(api.normalizeLoadedSettings({ aiProvider: 'muse', aiModel: 'deepseek-chat' }).aiProvider, 'muse');
});

test('Android repositories contain only official endpoints', async () => {
  const settings = await readFile(new URL('../../android/settings.gradle.kts', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /aliyun|taobao|npmmirror/i);
  assert.match(settings, /google\(\)/);
  assert.match(settings, /mavenCentral\(\)/);
  assert.match(settings, /gradlePluginPortal\(\)/);
});
