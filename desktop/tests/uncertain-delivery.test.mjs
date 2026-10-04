import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  '@/store/appStore': `export const useAppStore = selector => selector(globalThis.deliveryState);
    useAppStore.getState = () => globalThis.deliveryState;`,
  '@/i18n': `export const translateCurrent = key => key; export const useI18n = () => ({t: key => key});`,
  '@/channels/mediaGate': 'export const gatedMediaSend = async (_input, send) => send();',
  '@/lib/baileys': `export const baileysFetchAvatar = async () => null;
    export const baileysSync = async () => {};
    export const baileysStatus = async () => ({connection: 'connected'});
    export const baileysSend = (...args) => globalThis.deliverySend(args);
    export const baileysSendDocument = (...args) => globalThis.deliverySend(args);
    export const baileysSendGif = (...args) => globalThis.deliverySend(args);
    export const baileysSendImage = (...args) => globalThis.deliverySend(args);
    export const baileysSendSticker = (...args) => globalThis.deliverySend(args);
    export const baileysSendVoice = (...args) => globalThis.deliverySend(args);`,
  './VoiceBubble': 'export const VoiceBubble = () => null;',
  './MessageMedia': 'export const MessageMedia = () => null;',
};
const built = await build({
  stdin: { contents: `export { retryMessage } from './src/components/chat/retryMessageAction.ts';
    export { isDeliveryUncertain, isRetryableOutgoing } from './src/store/outgoingRetry.ts';
    export { parseBackupJson, buildExportBundle } from './src/lib/exportData.ts';
    export { recoverInterruptedMessage } from './src/store/hydrateMessageCleanup.ts';
    export { baileysChannel } from './src/channels/baileys.ts';
    import { MessageBubble } from './src/components/chat/MessageBubble.tsx';
    import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    export const renderBubble = props => renderToStaticMarkup(createElement(MessageBubble, props));`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(new URL('../package.json', import.meta.url).href)});` },
  alias: { '@': fileURLToPath(new URL('../src/', import.meta.url)) },
  plugins: [{ name: 'controlled-delivery-io', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
let tested;
try {
  tested = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
} catch (error) {
  throw new Error(`Delivery test bundle could not load: ${error.message}`);
}
const { retryMessage, isDeliveryUncertain, isRetryableOutgoing, parseBackupJson, buildExportBundle, renderBubble, recoverInterruptedMessage, baileysChannel } = tested;
const message = extra => ({ id: 'm', chatId: 'a', direction: 'out', body: '报价', phoneE164: '+33600000000',
  accountId: 'original-account', sentAt: '2026-10-04T10:00:00Z', deliveryStatus: 'failed', deliveryUncertain: true, ...extra });
function setup(original, confirm) {
  const updates = [], prompts = [], sends = [];
  let current = original;
  globalThis.deliverySend = async args => { sends.push(args); return { id: 'wa-id' }; };
  const deps = { id: original.id, message: original, isBaileys: true, chatConnected: true, chatAccountId: 'selected-other-account',
    setMediaBusyId() {}, updateMessageDelivery: (_id, patch) => { updates.push(patch); current = {...current, ...patch}; },
    pushToast() {}, readMessage: () => current,
    requestConfirm: async prompt => { prompts.push(prompt); return confirm(); } };
  return { deps, updates, prompts, sends, setCurrent: next => { current = next; } };
}

test('unknown delivery survives backup roundtrip and cannot enter automatic retries even with a due retry time', () => {
  const original = message({ nextAttemptAt: '2000-01-01T00:00:00Z' });
  const backup = buildExportBundle({ phones: [], contacts: [], chats: [], messages: [original], followUps: [], activities: [], broadcastCampaigns: [], settings: {} });
  const restored = parseBackupJson(backup).messages[0];
  assert.equal(restored.deliveryUncertain, true); assert.equal(isRetryableOutgoing(restored), false);
  assert.equal(isRetryableOutgoing({...original, deliveryStatus: 'queued'}), false);
});

test('old localized snapshots still require checking; confirmed receipts never display uncertainty', () => {
  for (const lastError of ['baileys_delivery_unknown', '发送结果未知，请先核对', 'The send result is unknown. Check WhatsApp', 'Le résultat de l’envoi est inconnu. Vérifiez WhatsApp']) {
    const legacy = message({ deliveryUncertain: undefined, lastError });
    assert.equal(isDeliveryUncertain(legacy), true); assert.equal(isRetryableOutgoing({...legacy, nextAttemptAt: '2000-01-01'}), false);
  }
  for (const deliveryStatus of ['sent', 'server', 'delivered', 'read', 'played', 'local'])
    assert.equal(isDeliveryUncertain(message({deliveryStatus})), false);
});

test('a checked retry interrupted during sending requires checking again after restart', () => {
  const recovered = recoverInterruptedMessage(message({deliveryStatus: 'pending', deliveryUncertain: false}));
  assert.equal(recovered.deliveryStatus, 'failed'); assert.equal(recovered.deliveryUncertain, true);
  assert.equal(isDeliveryUncertain(recovered), true); assert.equal(isRetryableOutgoing(recovered), false);
});

test('cancelling the unknown-result prompt does not change or send the message', async () => {
  const run = setup(message(), () => false); await retryMessage(run.deps);
  assert.equal(run.prompts.length, 1); assert.equal(run.prompts[0].description, 'runtime.verifyResendDescription');
  assert.deepEqual(run.updates, []); assert.deepEqual(run.sends, []);
});

test('checking an unknown text message explicitly hands it to the queue once', async () => {
  const run = setup(message(), () => true); await retryMessage(run.deps);
  assert.equal(run.prompts.length, 1); assert.equal(run.updates.length, 1);
  assert.equal(run.updates[0].deliveryStatus, 'queued'); assert.equal(run.updates[0].deliveryUncertain, false);
  assert.equal(isRetryableOutgoing({...message(), ...run.updates[0]}), true);
});

for (const change of ['receipt', 'deletion', 'body', 'recipient', 'account', 'media']) test(`a ${change} during confirmation cancels the stale retry`, async () => {
  let release;
  const run = setup(message(), () => new Promise(resolve => { release = resolve; }));
  const pending = retryMessage(run.deps);
  run.setCurrent(change === 'deletion' ? undefined : message({
    ...(change === 'receipt' ? {deliveryStatus: 'delivered'} : {}),
    ...(change === 'body' ? {body: 'edited'} : {}),
    ...(change === 'recipient' ? {phoneE164: '+33999999999'} : {}),
    ...(change === 'account' ? {accountId: 'changed'} : {}),
    ...(change === 'media' ? {mediaUrl: 'data:image/png;base64,new'} : {}),
  }));
  release(true); await pending; assert.deepEqual(run.updates, []); assert.deepEqual(run.sends, []);
});

test('a definite failure retains direct retry without confirmation', async () => {
  const run = setup(message({deliveryUncertain: false, lastError: 'rejected'}), assert.fail);
  await retryMessage(run.deps); assert.deepEqual(run.prompts, []); assert.equal(run.updates[0].deliveryStatus, 'queued');
});

test('an unknown media retry is confirmed and uses the original account', async () => {
  const run = setup(message({mediaType: 'image', mediaUrl: 'data:image/png;base64,fixture'}), () => true);
  await retryMessage(run.deps); assert.equal(run.prompts.length, 1); assert.equal(run.sends.length, 1);
  assert.equal(run.sends[0][3].accountId, 'original-account'); assert.equal(run.updates.at(-1).deliveryStatus, 'sent');
});

test('a media retry that loses its transport result requires checking again', async () => {
  const run = setup(message({mediaType: 'image', mediaUrl: 'data:image/png;base64,fixture'}), () => true);
  globalThis.deliverySend = async () => { throw Object.assign(new Error('signal timed out'), {deliveryUncertain: true}); };
  await retryMessage(run.deps);
  assert.equal(run.updates.at(-1).deliveryStatus, 'failed');
  assert.equal(run.updates.at(-1).deliveryUncertain, true);
  assert.equal(isRetryableOutgoing({...message(), ...run.updates.at(-1)}), false);
});

test('the text channel preserves structured uncertainty for failed or incomplete responses', async () => {
  for (const reason of ['Baileys HTTP 500', 'Baileys 发送响应未确认成功', 'Unexpected end of JSON input']) {
    globalThis.deliverySend = async () => { throw Object.assign(new Error(reason), {deliveryUncertain: true}); };
    const result = await baileysChannel.sendText({text: '报价', phoneE164: '+33600000000'});
    assert.equal(result.ok, false); assert.equal(result.status, 'failed');
    assert.equal(result.error, 'baileys_delivery_unknown');
  }
});

test('actual message bubble distinguishes an unknown result from a definite failure', () => {
  globalThis.deliveryState = { settings: { waAccounts: [] }, contacts: [], chats: [], messages: [] };
  const props = { onRetry() {}, onOpenMenu() {}, onReloadMedia() {}, onPreview() {} };
  const unknown = renderBubble({...props, m: message()});
  assert.match(unknown, /messageBubble.deliveryUncertain/); assert.match(unknown, /messageBubble.verifyRetry/);
  assert.doesNotMatch(unknown, /messageBubble.failed/);
  const definite = renderBubble({...props, m: message({deliveryUncertain: false})});
  assert.match(definite, /messageBubble.failed/); assert.match(definite, /messageBubble.retry/);
});
