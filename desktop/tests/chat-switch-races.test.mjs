import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real hooks and senders, with only React scheduling and external I/O controlled.
const mocks = {
  react: `export const useRef = value => globalThis.hooks.ref(value);
    export const useState = value => globalThis.hooks.state(value);
    export const useEffect = (fn, deps) => globalThis.hooks.effect(fn, deps);`,
  '@/store/appStore': 'export const useAppStore = { getState: () => globalThis.chatState };',
  '@/store/persist': 'export const persistChatDrafts = async () => { globalThis.draftPeriodicSaves = (globalThis.draftPeriodicSaves || 0) + 1; };',
  '@/lib/idb': `export const idbGet = async () => globalThis.readMediaDraft ? globalThis.readMediaDraft() : null;
    export const idbSet = async () => {}; export const idbDel = async () => {};
    export const idbDelPrefix = async () => 0; export const clearAppState = async () => {};
    export const loadAppState = async () => null; export const saveAppState = async () => {};`,
  '@/lib/speechToText': 'export const startVoiceInput = options => globalThis.startVoice(options);',
  '@/channels/mediaGate': 'export const gatedMediaSend = async (_input, send) => send();',
  '@/channels': `export const dispatchSendText = input => globalThis.sendText(input);
    export const sendRuntimeFromSettings = () => ({});`,
  '@/lib/accountHealth': 'export const computeAccountHealth = () => ({level: "green"});',
  '@/lib/baileys': `export const baileysPresence = async () => {};
    export const baileysMessageEdit = async () => ({});
    export const baileysSendDocument = (...args) => globalThis.sendMedia('file', args);
    export const baileysSendImage = (...args) => globalThis.sendMedia('image', args);
    export const baileysSendSticker = (...args) => globalThis.sendMedia('sticker', args);
    export const baileysSendVoice = (...args) => globalThis.sendMedia('audio', args);
    export const baileysSendGif = (...args) => globalThis.sendMedia('gif', args);`,
  '@/i18n': 'export const translateCurrent = key => key;',
};
const built = await build({
  stdin: { contents: `export { useComposerMedia } from './src/components/chat/useComposerMedia.ts';
    export { useComposerVoiceInput } from './src/components/chat/useComposerVoiceInput.ts';
    export { useTextSend } from './src/components/chat/useTextSend.ts';
    export { useComposerDraftAutosave } from './src/components/chat/useComposerDraftAutosave.ts';
    export { beginDataRestore } from './src/store/restoreGuard.ts';
    export { createMessageActionsSlice } from './src/store/messageActionsSlice.ts';
    export { useMediaSend } from './src/components/chat/useMediaSend.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  plugins: [{ name: 'controlled-io', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { useComposerMedia, useComposerVoiceInput, useComposerDraftAutosave, beginDataRestore, createMessageActionsSlice, useTextSend, useMediaSend } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function runtime() {
  const cells = [], effects = [];
  let cursor = 0;
  const hooks = {
    ref(value) { const i = cursor++; return cells[i] ??= { current: value }; },
    state(value) { const i = cursor++; cells[i] ??= { value: typeof value === 'function' ? value() : value };
      return [cells[i].value, next => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
    effect(fn, deps) { const i = cursor++, prev = cells[i];
      if (prev && deps?.every((d, n) => Object.is(d, prev.deps?.[n]))) return;
      cells[i] = { deps, cleanup: prev?.cleanup };
      effects.push(() => { cells[i].cleanup?.(); cells[i].cleanup = fn(); }); },
  };
  return {
    render(fn) { globalThis.hooks = hooks; cursor = 0; const result = fn(); while (effects.length) effects.shift()(); return result; },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const file = name => new File(['fixture'], name, { type: 'application/pdf' });

test('attachment batch stops at a chat switch and preserves unsent A attachments and all B attachments', async () => {
  const r = runtime(), pending = deferred(), calls = [], cleared = [];
  let key = 'batch-A', draft = 'A caption';
  const send = async f => { calls.push({ key, name: f.name }); return pending.promise; };
  const render = () => r.render(() => useComposerMedia({ chatKey: key, readDraft: () => draft,
    setDraftLocal: text => cleared.push(text), flushDraftNow: text => cleared.push(text), onError: assert.fail,
    onSendFile: send, onSendImage: send, onSendAudio: send, onSendSticker: send, onSendGif: send }));
  let ui = render(); ui.stageMedia([file('A1.pdf'), file('A2.pdf')]); ui = render();
  const run = ui.sendPendingMedia();
  key = 'batch-B'; draft = 'B draft'; ui = render(); ui = render();
  ui.stageMedia([file('B.pdf')]); ui = render();
  await ui.sendPendingMedia(); // Cannot start another batch while the old item is in flight.
  pending.resolve(true); await run; ui = render();
  assert.deepEqual(calls, [{ key: 'batch-A', name: 'A1.pdf' }]);
  assert.deepEqual(ui.pendingMedia.map(item => item.file.name), ['B.pdf']);
  assert.deepEqual(cleared, []);
  key = 'batch-A'; ui = render(); ui = render();
  assert.deepEqual(ui.pendingMedia.map(item => item.file.name), ['A2.pdf']);
  assert.equal(ui.mediaCaption, ''); // Caption already sent with A1.
  r.unmount();
});

function store() {
  const state = { selectedChatId: 'A', draftReply: 'old text', draftReplyByChatId: { A: 'old text', B: 'B draft' },
    settings: { blockSendWhenOverheated: false }, messages: [], contacts: [],
    setChatDraft(id, text) { this.draftReplyByChatId[id] = text; if (this.selectedChatId === id) this.draftReply = text; } };
  globalThis.chatState = state;
  return state;
}

test('real text send keeps original recipient/account and clears only the original unchanged draft', async () => {
  const r = runtime(), pending = deferred(), state = store(), sent = [];
  globalThis.sendText = input => { sent.push(input); return pending.promise; };
  let chat = 'A', liveDraft = 'old text';
  const render = () => r.render(() => useTextSend({ sending: false, guardBlockedSend: () => true,
    getDraft: () => liveDraft, selectedChatId: chat, chatAccountId: `account-${chat}`,
    activeContact: { id: `contact-${chat}`, phone: '+33600000000' }, activeChat: { id: chat },
    isBaileys: true, chatConnected: true, channelId: 'baileys', selectedPhoneId: null,
    chatMessages: [], replyTo: null, editingId: null, groupMembers: [], mentionTrackerRef: { current: [] },
    setSending() {}, stickToBottom() {}, updateContact() {}, enqueueOutgoingMessage: () => 'msg-A',
    patchMessage() {}, updateMessageDelivery() {}, setBaileysLoginOpen() {}, setDraftReply: assert.fail,
    setReplyTo() {}, pushToast() {}, setEditingId() {} }));
  const run = render().sendText();
  chat = state.selectedChatId = 'B'; liveDraft = state.draftReply = 'B draft'; render();
  pending.resolve({ ok: true, status: 'sent' }); await run;
  assert.equal(sent[0].accountId, 'account-A');
  assert.equal(sent[0].contactId, 'contact-A');
  assert.equal(state.draftReply, 'B draft');
  assert.equal(state.draftReplyByChatId.A, '');
  r.unmount();
});

for (const kind of ['file', 'image', 'audio', 'gif']) test(`${kind} read fixes caption/chat/account before a switch and keeps new input`, async () => {
  const originalReader = globalThis.FileReader;
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ duration: 30, remove() {}, set src(_url) { queueMicrotask(() => this.onloadedmetadata()); } }) };
  let reader;
  globalThis.FileReader = class { constructor() { reader = this; } readAsDataURL() {} };
  const r = runtime(), state = store(), messages = [], sends = [];
  globalThis.sendMedia = async (kind, args) => { sends.push({ kind, args }); return {}; };
  let chat = 'A', liveDraft = 'A caption';
  const render = () => r.render(() => useMediaSend({ chatId: chat, chatAccountId: `account-${chat}`, getDraft: () => liveDraft,
    sending: false, guardBlockedSend: () => true, stickToBottom() {}, resolveRecipient: () => ({ contact: { id: `contact-${chat}` }, recipient: '+33600000000' }),
    pushToast() {}, isBaileys: true, chatConnected: true, setBaileysLoginOpen() {}, setSending() {},
    enqueueOutgoingMessage: input => { messages.push(input); return 'file-A'; }, patchMessage() {}, updateMessageDelivery() {},
    setDraftReply: assert.fail, channelId: 'baileys', selectedPhoneId: null, openAndroidMediaShare: assert.fail, toStickerDataUrl: assert.fail }));
  try {
    const sender = render();
    const mime = { file: 'application/pdf', image: 'image/png', audio: 'audio/mp3', gif: 'image/gif' }[kind];
    const attachment = new File(['fixture'], `A.${kind}`, { type: mime });
    const run = kind === 'file' ? sender.sendFile(attachment)
      : kind === 'image' ? sender.sendImage(attachment)
      : kind === 'audio' ? sender.sendAudio(attachment, 'A caption') : sender.sendGif(attachment, 'A caption');
    chat = state.selectedChatId = 'B'; liveDraft = state.draftReply = 'B fresh text'; render();
    reader.result = `data:${mime};base64,Zml4dHVyZQ==`; reader.onload();
    await run;
    assert.equal(messages[0].chatId, 'A'); assert.equal(messages[0].accountId, 'account-A');
    assert.equal(messages[0].body, 'A caption');
    const sentAccount = kind === 'file' ? sends[0].args[3].accountId
      : kind === 'image' ? sends[0].args[3].accountId : kind === 'audio' ? sends[0].args[2].accountId : sends[0].args[3];
    assert.equal(sentAccount, 'account-A');
    assert.equal(state.draftReply, 'B fresh text');
  } finally { globalThis.FileReader = originalReader; globalThis.document = originalDocument; r.unmount(); }
});

test('changing only the sending account also stops a pending attachment batch', async () => {
  const r = runtime(), pending = deferred(), sent = [];
  let account = 'account-1';
  const send = async attachment => { sent.push({ account, name: attachment.name }); return pending.promise; };
  const render = () => r.render(() => useComposerMedia({ chatKey: 'same-chat', sendContextKey: account,
    readDraft: () => '', setDraftLocal: assert.fail, flushDraftNow: assert.fail, onError: assert.fail,
    onSendFile: send, onSendImage: send, onSendAudio: send, onSendSticker: send, onSendGif: send }));
  let ui = render(); ui.stageMedia([file('1.pdf'), file('2.pdf')]); ui = render();
  const run = ui.sendPendingMedia(); account = 'account-2'; render();
  pending.resolve(true); await run; ui = render();
  assert.deepEqual(sent, [{ account: 'account-1', name: '1.pdf' }]);
  assert.deepEqual(ui.pendingMedia.map(item => item.file.name), ['2.pdf']);
  r.unmount();
});

test('voice startup and final transcription arriving after reset cannot fill a new chat', async () => {
  const r = runtime(), started = deferred(), stopped = deferred(), writes = [];
  let callbacks, cancelled = 0;
  globalThis.startVoice = options => { callbacks = options; return started.promise; };
  const render = () => r.render(() => useComposerVoiceInput({ editingId: null, fullSettings: () => ({}),
    pushToast: assert.fail, setDraftLocal: text => writes.push(text), flushDraftNow: text => writes.push(text), focusTextarea() {} }));
  let ui = render(); const run = ui.handleToggleVoiceInput(); ui.resetVoiceInput();
  callbacks.onInterim('old interim'); callbacks.onError('old error');
  started.resolve({ cancel: () => cancelled++, engine: 'browser', languageLabel: 'English', stop: () => stopped.promise });
  await run; assert.equal(cancelled, 1); assert.deepEqual(writes, []);
  globalThis.startVoice = async () => ({ cancel() {}, engine: 'ai', languageLabel: 'English', stop: () => stopped.promise });
  ui = render(); await ui.handleToggleVoiceInput(); ui = render();
  const finishing = ui.handleFinishVoiceInput(); ui.resetVoiceInput();
  stopped.resolve({ text: 'old final' }); await finishing;
  assert.deepEqual(writes, []); r.unmount();
});

test('sticker success followed by caption attachment failure preserves the unsent caption and allows retry', async () => {
  const r = runtime(), cleared = [], captions = [];
  let fail = true;
  const send = async (_file, caption) => { captions.push(caption); return !fail; };
  const render = () => r.render(() => useComposerMedia({ chatKey: 'sticker-failure', readDraft: () => 'unsent caption',
    setDraftLocal: text => cleared.push(text), flushDraftNow: text => cleared.push(text), onError: assert.fail,
    onSendFile: send, onSendImage: send, onSendAudio: send, onSendSticker: async () => true, onSendGif: send }));
  try {
    let ui = render(); ui.stageMedia([new File(['fixture'], 'sticker.webp', { type: 'image/webp' })], 'sticker');
    ui.stageMedia([file('caption.pdf')]); ui = render();
    await ui.sendPendingMedia(); ui = render();
    assert.deepEqual(cleared, []);
    assert.equal(ui.mediaCaption, 'unsent caption');
    assert.deepEqual(ui.pendingMedia.map(item => item.file.name), ['caption.pdf']);
    fail = false; await ui.sendPendingMedia(); ui = render();
    assert.deepEqual(captions, ['unsent caption', 'unsent caption']);
    assert.equal(ui.pendingMedia.length, 0);
    assert.deepEqual(cleared, ['', '']);
  } finally { r.unmount(); }
});

test('attachment exceptions release the batch lock without losing files or caption', async () => {
  const r = runtime(), errors = [];
  let fail = true;
  const send = async () => { if (fail) throw new Error('controlled failure'); return true; };
  const render = () => r.render(() => useComposerMedia({ chatKey: 'batch-exception', readDraft: () => 'caption',
    setDraftLocal() {}, flushDraftNow() {}, onError: message => errors.push(message),
    onSendFile: send, onSendImage: send, onSendAudio: send, onSendSticker: send, onSendGif: send }));
  try {
    let ui = render(); ui.stageMedia([file('retry.pdf')]); ui = render();
    await ui.sendPendingMedia(); ui = render();
    assert.deepEqual(errors, ['controlled failure']);
    assert.equal(ui.mediaSendingIndex, -1); assert.equal(ui.pendingMedia.length, 1);
    assert.equal(ui.mediaCaption, 'caption');
    fail = false; await ui.sendPendingMedia(); ui = render();
    assert.equal(ui.pendingMedia.length, 0);
  } finally { r.unmount(); }
});

test('rapid A to B to A preserves newly added attachments and does not resume an old batch', async () => {
  const r = runtime(), pending = deferred(), calls = [], cleared = [];
  let key = 'rapid-A', draft = 'old caption';
  const send = async f => { calls.push(f.name); return pending.promise; };
  const render = () => r.render(() => useComposerMedia({ chatKey: key, readDraft: () => draft,
    setDraftLocal: text => cleared.push(text), flushDraftNow: text => cleared.push(text), onError: assert.fail,
    onSendFile: send, onSendImage: send, onSendAudio: send, onSendSticker: send, onSendGif: send }));
  try {
    let ui = render(); ui.stageMedia([file('original-1.pdf'), file('original-2.pdf')]); ui = render();
    const run = ui.sendPendingMedia(); key = 'rapid-B'; render(); render();
    key = 'rapid-A'; draft = 'new caption'; ui = render(); ui = render();
    ui.stageMedia([file('added.pdf')]); ui.setMediaCaption(draft); render();
    pending.resolve(true); await run; ui = render();
    assert.deepEqual(calls, ['original-1.pdf']);
    assert.deepEqual(ui.pendingMedia.map(item => item.file.name), ['original-2.pdf', 'added.pdf']);
    assert.equal(ui.mediaCaption, 'new caption'); assert.deepEqual(cleared, []);
  } finally { r.unmount(); }
});

test('unmount during an in-flight attachment stops subsequent sends and preserves the unsent attachment on remount', async () => {
  const r = runtime(), pending = deferred(), calls = [];
  const options = { chatKey: 'unmount-batch', readDraft: () => '', setDraftLocal: assert.fail, flushDraftNow: assert.fail,
    onError: assert.fail, onSendFile: async f => { calls.push(f.name); return pending.promise; },
    onSendImage: assert.fail, onSendAudio: assert.fail, onSendSticker: assert.fail, onSendGif: assert.fail };
  let ui = r.render(() => useComposerMedia(options)); ui.stageMedia([file('in-flight.pdf'), file('remaining.pdf')]);
  ui = r.render(() => useComposerMedia(options)); const run = ui.sendPendingMedia(); r.unmount();
  pending.resolve(true); await run;
  const remounted = runtime();
  try {
    ui = remounted.render(() => useComposerMedia(options));
    assert.deepEqual(calls, ['in-flight.pdf']);
    assert.deepEqual(ui.pendingMedia.map(item => item.file.name), ['remaining.pdf']);
  } finally { remounted.unmount(); }
});

for (const edited of [false, true]) test(`restored attachment caption ${edited ? 'preserves a newly typed draft' : 'is visible in the composer'}`, async () => {
  const r = runtime(), pending = deferred(), writes = [];
  let draft = '';
  globalThis.readMediaDraft = () => pending.promise;
  const options = { chatKey: `disk-caption-${edited}`, readDraft: () => draft,
    setDraftLocal: text => { draft = text; writes.push(text); }, flushDraftNow: text => writes.push(text),
    onError: assert.fail, onSendFile: assert.fail, onSendImage: assert.fail, onSendAudio: assert.fail,
    onSendSticker: assert.fail, onSendGif: assert.fail };
  try {
    r.render(() => useComposerMedia(options));
    if (edited) draft = 'new input';
    pending.resolve({ caption: 'saved caption', items: [{ id: 'saved-file', kind: 'file', name: 'saved.pdf', type: 'application/pdf', blob: file('saved.pdf') }] });
    await new Promise(resolve => setImmediate(resolve));
    const ui = r.render(() => useComposerMedia(options));
    assert.equal(ui.pendingMedia[0].file.name, 'saved.pdf');
    assert.equal(draft, edited ? 'new input' : 'saved caption');
    assert.equal(ui.mediaCaption, draft);
    assert.deepEqual(writes, edited ? [] : ['saved caption', 'saved caption']);
  } finally { delete globalThis.readMediaDraft; r.unmount(); }
});

test('draft autosave coalesces typing and flushes the originating chat before a switch or exit snapshot', () => {
  const original = { window: globalThis.window, document: globalThis.document, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Map(), writes = [], r = runtime(); let id = 0, chat = 'A', draft = 'first';
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget(); globalThis.document.hidden = false;
  globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 400); timers.set(++id, fn); return id; };
  globalThis.clearTimeout = timer => timers.delete(timer);
  globalThis.chatState = { chats: [{ id: 'A' }, { id: 'B' }], setChatDraft: (key, text) => writes.push([key, text]) };
  const render = () => r.render(() => useComposerDraftAutosave(chat, () => draft));
  try {
    let ui = render(); ui.scheduleDraftSave(); draft = 'latest A'; ui.scheduleDraftSave();
    assert.equal(timers.size, 1); const callback = [...timers.values()][0]; timers.clear(); callback();
    assert.deepEqual(writes, [['A', 'latest A']]);
    draft = 'not yet saved A'; ui.scheduleDraftSave(); chat = 'B'; ui = render();
    assert.equal(timers.size, 0); assert.deepEqual(writes.at(-1), ['A', 'not yet saved A']);
    draft = 'latest B'; ui.scheduleDraftSave(); window.dispatchEvent(new Event('wap:flush-chat-drafts'));
    assert.equal(timers.size, 0); assert.deepEqual(writes.at(-1), ['B', 'latest B']);
    ui.scheduleDraftSave(); ui.cancelDraftSave(); assert.equal(timers.size, 0);
  } finally { r.unmount(); Object.assign(globalThis, original); }
});

test('draft cleanup during restore or after a chat deletion cannot resurrect cleared drafts', () => {
  const original = { window: globalThis.window, document: globalThis.document };
  const writes = []; globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  globalThis.chatState = { chats: [{ id: 'A' }], setChatDraft: (...args) => writes.push(args) };
  try {
    let r = runtime(); r.render(() => useComposerDraftAutosave('A', () => 'old draft'));
    const finish = beginDataRestore(); try { r.unmount(); } finally { finish(); }
    assert.deepEqual(writes, []);
    r = runtime(); r.render(() => useComposerDraftAutosave('A', () => 'deleted draft'));
    globalThis.chatState.chats = []; r.unmount(); assert.deepEqual(writes, []);
  } finally { Object.assign(globalThis, original); }
});

test('actual optimistic enqueue preserves the draft until the sender decides its outcome', () => {
  let state = { hydrated: false, selectedChatId: 'A', selectedContactId: 'c', chats: [{ id: 'A', contactId: 'c', accountId: 'wa-a', unread: 0 }],
    contacts: [{ id: 'c', accountId: 'wa-a' }], messages: [], settings: {}, draftReply: '报价', draftReplyByChatId: { A: '报价', B: 'Devis' },
    recomputeStats() {}, logActivity() {} };
  const actions = createMessageActionsSlice({ get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } });
  const id = actions.enqueueOutgoingMessage({ chatId: 'A', contactId: 'c', body: '报价', deliveryStatus: 'pending' });
  assert.ok(id); assert.equal(state.messages[0].deliveryStatus, 'pending');
  assert.equal(state.draftReply, '报价'); assert.deepEqual(state.draftReplyByChatId, { A: '报价', B: 'Devis' });
});

for (const [outcome, result, expectedDraft] of [
  ['rejected', { ok: false, status: 'failed', error: 'rejected', message: 'controlled rejection' }, 'old text'],
  ['unsupported', { ok: false, status: 'unsupported', message: 'controlled unsupported' }, 'old text'],
  ['unknown delivery', { ok: false, status: 'failed', error: 'baileys_delivery_unknown', message: 'controlled unknown' }, 'old text'],
  ['retry queue', { ok: false, status: 'queued', error: 'rate_limited', message: 'controlled queue' }, ''],
]) test(`text outcome ${outcome} gives draft ownership to the correct place`, async () => {
  const r = runtime(), state = store(), updates = [];
  globalThis.sendText = async () => result;
  try {
    const sender = r.render(() => useTextSend({ sending: false, guardBlockedSend: () => true,
      getDraft: () => 'old text', selectedChatId: 'A', chatAccountId: 'account-A',
      activeContact: { id: 'contact-A', phone: '+33600000000' }, activeChat: { id: 'A' },
      isBaileys: true, chatConnected: true, channelId: 'baileys', selectedPhoneId: null,
      chatMessages: [], replyTo: null, editingId: null, groupMembers: [], mentionTrackerRef: { current: [] },
      setSending() {}, stickToBottom() {}, updateContact() {}, enqueueOutgoingMessage: () => 'msg-A',
      patchMessage() {}, updateMessageDelivery: (_id, patch) => updates.push(patch), setBaileysLoginOpen() {}, setDraftReply: assert.fail,
      setReplyTo() {}, pushToast() {}, setEditingId() {} }));
    await sender.sendText();
    assert.equal(state.draftReplyByChatId.A || '', expectedDraft); assert.equal(state.draftReplyByChatId.B, 'B draft');
    assert.equal(updates.at(-1).deliveryStatus, outcome === 'retry queue' ? 'queued' : 'failed');
  } finally { r.unmount(); }
});

test('continuous typing still checkpoints at five seconds and completed restore invalidates the old editor', async () => {
  const original = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const intervals = new Map(), writes = [], r = runtime(); let seq = 0, draft = 'continuous input';
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  globalThis.setInterval = (fn, ms) => { assert.equal(ms, 5000); intervals.set(++seq, fn); return seq; };
  globalThis.clearInterval = id => intervals.delete(id);
  globalThis.draftPeriodicSaves = 0;
  globalThis.chatState = { chats: [{ id: 'A' }], setChatDraft: (...args) => writes.push(args) };
  try {
    const ui = r.render(() => useComposerDraftAutosave('A', () => draft));
    ui.scheduleDraftSave(); draft = 'latest while typing'; ui.scheduleDraftSave();
    const tick = [...intervals.values()][0]; tick(); await Promise.resolve();
    assert.deepEqual(writes, [['A', 'latest while typing']]); assert.equal(globalThis.draftPeriodicSaves, 1);
    const finish = beginDataRestore(); finish();
    tick(); window.dispatchEvent(new Event('wap:flush-chat-drafts'));
    assert.equal(writes.length, 1); assert.equal(globalThis.draftPeriodicSaves, 1);
    draft = 'new input after restore'; ui.scheduleDraftSave(); tick(); await Promise.resolve();
    assert.deepEqual(writes.at(-1), ['A', 'new input after restore']); assert.equal(globalThis.draftPeriodicSaves, 2);
    const finishAgain = beginDataRestore(); finishAgain(); r.unmount();
    assert.equal(writes.length, 2); assert.equal(intervals.size, 0);
  } finally { r.unmount(); Object.assign(globalThis, original); }
});
