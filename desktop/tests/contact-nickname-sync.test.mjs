import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createContactStore } from '../baileys-bridge/contactStore.mjs';
import { createMessageIngest } from '../baileys-bridge/messageIngest.mjs';

const phone = '+12025550100', pn = '12025550100@s.whatsapp.net', lid = '100000000000001@lid';
const bridge = contacts => createContactStore({ contacts, getSocket: () => null, isSelfJid: () => false });

test('merging phone and LID aliases never replaces a known nickname with a numeric alias', async () => {
  const contacts = new Map([
    [pn, { jid: pn, phoneE164: phone, displayName: phone }],
    [lid, { jid: lid, phoneE164: phone, displayName: 'Peer Nickname' }],
  ]);
  const store = bridge(contacts);
  store.upsertContact(lid, '', phone);
  assert.equal(contacts.get(lid).displayName, 'Peer Nickname');
  assert.equal(contacts.get(pn).displayName, 'Peer Nickname');
  store.rememberLidPn(lid, pn);
  await store.enrichContact(lid, '', pn);
  assert.equal(contacts.get(lid).displayName, 'Peer Nickname');
  assert.equal(contacts.get(pn).displayName, 'Peer Nickname');
});

test('inbound business/profile names survive numeric pushName fields; outbound self names never become customer names', () => {
  const contacts = new Map(), store = bridge(contacts);
  const { ingestMessage } = createMessageIngest({ ...store, contacts, messages: new Map(), isSelfJid: () => false,
    rememberRawWa() {}, rememberRawMedia() {}, mediaToDataUrl: async () => '',
    enrichContact: async () => null, enqueueAvatar() {}, push() {}, timestamp: () => 1_700_000_000_000 });
  const message = { key: { id: 'in', remoteJid: pn, fromMe: false }, pushName: phone,
    verifiedBizName: 'Example Shop', message: { conversation: 'Hello' } };
  assert.equal(ingestMessage(message).displayName, 'Example Shop');
  assert.equal(ingestMessage({ ...message, key: { ...message.key, id: 'out', fromMe: true }, pushName: 'My Account', verifiedBizName: 'My Business' }).displayName, 'Example Shop');
});

const built = await build({ stdin: { contents: 'export {ensureIngestContact} from "./src/store/contactIngest.ts"; export {applyMessagesSync} from "./src/store/messagesIngest.ts";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'browser', write: false,
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } });
const { ensureIngestContact, applyMessagesSync } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('profile sync upgrades number placeholders without overwriting existing local customer names or other accounts', () => {
  const bag = { contacts: [
    { id: 'manual', accountId: 'a', phone, name: 'Local Customer Note', tags: [], stage: 'new' },
    { id: 'numeric', accountId: 'b', phone, name: phone, tags: [], stage: 'new' },
  ], chats: [
    { id: 'chat-a', contactId: 'manual', accountId: 'a', contactName: 'Local Customer Note' },
    { id: 'chat-b', contactId: 'numeric', accountId: 'b', contactName: phone },
  ], messages: [], nextSelectedChatId: null, nextSelectedContactId: null };
  const item = { jid: pn, phoneE164: phone, displayName: phone, pushName: 'Peer Nickname' };
  ensureIngestContact(bag, item, 'b', '');
  assert.equal(bag.contacts.find(c => c.id === 'numeric').name, 'Peer Nickname');
  assert.equal(bag.chats.find(c => c.id === 'chat-b').contactName, 'Peer Nickname');
  ensureIngestContact(bag, item, 'a', '');
  assert.equal(bag.contacts.find(c => c.id === 'manual').name, 'Local Customer Note');
  assert.equal(bag.chats.find(c => c.id === 'chat-a').contactName, 'Local Customer Note');
  applyMessagesSync({ bag, deviceId: 'a', selfName: '', payload: { live: true },
    items: [{ ...item, id: 'message-1', direction: 'in', body: 'Hello', sentAt: '2026-10-26T12:00:00Z' }] });
  assert.ok(bag.chats.filter(chat => chat.contactId === 'manual').every(chat => chat.contactName === 'Local Customer Note'));
});
