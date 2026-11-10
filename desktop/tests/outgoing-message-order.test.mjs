import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  './persist': 'export const persist = () => {}; export const scheduleStatsRecompute = () => {};',
  '@/lib/storage': 'export const getMessageFromDb = async () => null; export const searchMessagesInDb = async () => null; export const clearStoredChatMessages = async () => {};',
  '@/lib/mediaCache': 'export const cacheMediaUrl = async () => {}; export const dropMediaCache = async () => {};',
};
const built = await build({
  stdin: { contents: `export {createMessageActionsSlice} from './src/store/messageActionsSlice.ts';
    export {applyMessagesSync} from './src/store/messagesIngest.ts';
    export {updateMessageIndex} from './src/store/messageIndex.ts';
    export {cleanHydratedMessages} from './src/store/hydrateMessageCleanup.ts';export {lastContactedAccounts,recipientKey} from './src/lib/scheduledPlans.ts';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  plugins: [{ name: 'outgoing-order-io', setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: mocks[a.path] }));
  } }],
});
const {createMessageActionsSlice, applyMessagesSync, updateMessageIndex, cleanHydratedMessages,lastContactedAccounts,recipientKey} = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
);
const now = Date.parse('2026-11-06T12:00:00.125Z');
const peer = { jid: '12025550123@s.whatsapp.net', phoneE164: '+12025550123', displayName: 'Example' };

function fixture(inboundAt) {
  let state = { contacts: [], chats: [], messages: [], messagesByChatId: {}, settings: {waAccounts: []},
    logActivity() {}, recomputeStats() {} };
  const refreshIndex = () => { state.messagesByChatId = updateMessageIndex(state.messages, state.messagesByChatId); };
  const sync = items => {
    const bag = { contacts: state.contacts, chats: state.chats, messages: [...state.messages],
      nextSelectedChatId: state.selectedChatId, nextSelectedContactId: state.selectedContactId };
    applyMessagesSync({bag, items: items.map(m => ({...peer, ...m})), deviceId: 'a', selfName: '', payload: {live: false, source: 'snapshot'}});
    Object.assign(state, {contacts: bag.contacts, chats: bag.chats, messages: bag.messages}); refreshIndex();
  };
  Object.assign(state, createMessageActionsSlice({get: () => state, set: patch => {
    state = {...state, ...(typeof patch === 'function' ? patch(state) : patch)}; refreshIndex();
  }}));
  sync([{id: 'incoming', body: 'Question', direction: 'in', sentAt: new Date(inboundAt).toISOString()}]);
  state.selectedChatId = state.chats[0].id; state.selectedContactId = state.contacts[0].id;
  return {get state() {return state;}, sync, refreshIndex,
    thread: () => state.messagesByChatId[state.selectedChatId],
    enqueue: input => state.enqueueOutgoingMessage({accountId: 'a', body: 'Answer', ...input})};
}

test('new replies stay below received messages before echo, after clock correction and after restoring history', t => {
  t.mock.method(Date, 'now', () => now);
  for (const skew of [0, 500, 5000, 3_600_000]) for (const mediaType of [undefined, 'image', 'audio']) {
    const h = fixture(now + skew), target = h.thread()[0];
    const id = h.enqueue({mediaType});
    h.state.patchMessage(id, {quoted: {id: target.id, body: target.body, fromMe: false}});
    assert.equal(h.thread().at(-1).id, id, 'optimistic reply must start below its target');
    assert.equal(Date.parse(h.thread().at(-1).sentAt), now, 'display ordering must not invent a future sending time');
    assert.ok(Date.parse(h.thread().at(-1).displayOrderAt) > Date.parse(target.sentAt));
    h.state.updateMessageDelivery(id, {deliveryStatus: 'sent', waMessageId: 'reply', sentAt: new Date(now - 125).toISOString()});
    assert.equal(h.state.chats.find(c=>c.id===target.chatId).replyPendingSince,'','successful replies clear the original pending question even with clock skew');
    assert.equal(h.thread().at(-1).id, id, 'send acknowledgement must not move the reply upward');
    h.sync([{id: 'reply', body: 'Answer', direction: 'out', mediaType, sentAt: new Date(now - 125).toISOString()}]);
    assert.deepEqual(h.thread().map(m => m.id), [target.id, id]);
    assert.equal(h.state.messages.length, 2, 'echo must merge into the original optimistic bubble');
    assert.equal(h.thread().at(-1).sentAt, new Date(now - 125).toISOString(), 'keep the actual protocol timestamp');
    const restored = cleanHydratedMessages(JSON.parse(JSON.stringify(h.state.messages)));
    assert.deepEqual(updateMessageIndex(restored, {})[target.chatId].map(m => m.id), [target.id, id]);
  }
});

test('rapid replies have stable order and other conversations or accounts cannot advance their clock', t => {
  t.mock.method(Date, 'now', () => now);
  const h = fixture(now - 1000), target = h.thread()[0];
  h.state.messages.push({...target, id: 'foreign-chat', chatId: 'other', sentAt: new Date(now + 60_000).toISOString()},
    {...target, id: 'foreign-account', accountId: 'b', sentAt: new Date(now + 120_000).toISOString()});
  const first = h.enqueue({}), second = h.enqueue({});
  const a = h.thread().find(m => m.id === first), b = h.thread().find(m => m.id === second);
  assert.equal(Date.parse(a.sentAt), now);
  assert.equal(Date.parse(b.sentAt), now);
  assert.equal(Date.parse(b.displayOrderAt), now + 1);
  assert.ok(h.thread().indexOf(a) < h.thread().indexOf(b));
});

test('a queued reply accepts a genuinely later protocol time after reconnecting', t => {
  t.mock.method(Date, 'now', () => now);
  const h = fixture(now + 5000), id = h.enqueue({deliveryStatus: 'queued'});
  h.state.updateMessageDelivery(id, {waMessageId: 'queued-reply'});
  const later = new Date(now + 600_000).toISOString();
  h.sync([{id: 'queued-reply', body: 'Answer', direction: 'out', sentAt: later}]);
  assert.equal(h.thread().at(-1).id, id);
  assert.equal(h.thread().at(-1).sentAt, later);
});

test('successful sender metadata survives cold memory and ignores failed, queued and uncertain delivery',t=>{
 t.mock.method(Date,'now',()=>now);const h=fixture(now-1000),id=h.enqueue({deliveryStatus:'queued'});
 assert.equal(h.state.chats[0].lastSuccessfulOutgoing,undefined);
 h.state.updateMessageDelivery(id,{deliveryStatus:'failed'});assert.equal(h.state.chats[0].lastSuccessfulOutgoing,undefined);
 h.state.updateMessageDelivery(id,{deliveryStatus:'sent',deliveryUncertain:true});assert.equal(h.state.chats[0].lastSuccessfulOutgoing,undefined);
 h.state.updateMessageDelivery(id,{deliveryStatus:'sent',deliveryUncertain:false});
 assert.equal(h.state.chats[0].lastSuccessfulOutgoing.accountId,'a');assert.equal(h.state.chats[0].lastSuccessfulOutgoing.at,new Date(now).toISOString());
 h.state.messages=[];h.refreshIndex();assert.equal(lastContactedAccounts(h.state.chats,h.state.contacts,[]).get(recipientKey('',peer.phoneE164)),'a');
});

test('first conversation survives reply echoes, old history imports and memory eviction', t => {
 t.mock.method(Date,'now',()=>now);
 const h=fixture(now-1000),firstAt=new Date(now-1000).toISOString();
 assert.deepEqual(h.state.chats[0].firstConversationMessage,{at:firstAt,direction:'in'});
 const id=h.enqueue({deliveryStatus:'queued'});
 h.state.updateMessageDelivery(id,{deliveryStatus:'sent',waMessageId:'reply'});
 h.sync([{id:'reply',body:'Answer',direction:'out',sentAt:new Date(now).toISOString()}]);
 assert.equal(h.state.chats[0].firstConversationMessage.at,firstAt);
 const older='2026-08-01T08:00:00.000Z';
 h.sync([{id:'older-out',body:'Hello earlier',direction:'out',sentAt:older}]);
 assert.deepEqual(h.state.chats[0].firstConversationMessage,{at:older,direction:'out'});
 h.state.messages=[];h.refreshIndex();
 h.sync([{id:'returning-in',body:'Hello again',direction:'in',sentAt:new Date(now+1000).toISOString()}]);
 assert.deepEqual(h.state.chats[0].firstConversationMessage,{at:older,direction:'out'});
});
