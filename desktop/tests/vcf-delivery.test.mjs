import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createBaileysRequestHandler } from '../baileys-bridge/httpServer.mjs';
import { buildContactsVcf } from '../src/lib/contactVcf.ts';
import { parseContactVcard } from '../baileys-bridge/contactVcard.mjs';
import { openMediaInNewTab } from '../src/components/chat/messageMediaUtils.ts';

async function send(payload) {
  let status, body, content;
  const req = Object.assign(Readable.from([JSON.stringify({phoneE164: '+12025550101', ...payload})]), {
    method: 'POST', url: '/send', headers: {'x-wap-token': 'test-token'},
  });
  const res = {setHeader() {}, writeHead(code) {status = code;}, end(data) {body = JSON.parse(data);}};
  await createBaileysRequestHandler({
    token: 'test-token', port: 0, connection: 'connected',
    resolveSendJid: async () => '12025550101@s.whatsapp.net',
    socket: {sendMessage: async (_jid, value) => {content = value; return {key: {id: 'sent'}};}},
  })(req, res);
  assert.equal(status, 200, JSON.stringify(body));
  return content;
}

test('generated multi-contact VCF stays a UTF-8 file with Android MIME instead of a native contact card', async () => {
  const contacts = [{name: 'Nathalie Mère Exemple', phone: '+12025550101'}, {name: '中文测试', phone: '+12025550102'}];
  const text = buildContactsVcf(contacts, {prefix: '', suffix: '', lastFour: false});
  for (const mimetype of ['text/vcard;charset=utf-8', 'text/x-vcard', 'application/octet-stream']) {
    const content = await send({fileName: 'contacts.vcf', mediaType: 'document', mimetype,
      fileDataUrl: `data:${mimetype};base64,${Buffer.from(text, 'utf8').toString('base64')}`});
    assert.equal(content.fileName, 'contacts.vcf');
    assert.equal(content.mimetype, 'text/x-vcard');
    assert.equal(content.contactVcard, false);
    assert.equal(content.contacts, undefined);
    assert.equal(content.document.toString('utf8'), text, 'transport preserves every byte of the generated VCF');
    const cards = text.match(/BEGIN:VCARD\r\n[\s\S]*?END:VCARD\r\n/g);
    assert.deepEqual(cards.map(card => parseContactVcard(card)), contacts.map(c => ({displayName: c.name, phoneE164: c.phone})));
  }
});

test('the explicit single-contact action still sends a native WhatsApp contact card', async () => {
  const content = await send({mediaType: 'contact', contactName: 'Example', contactPhone: '+12025550102'});
  assert.equal(content.document, undefined);
  assert.equal(content.contacts.contacts.length, 1);
  assert.match(content.contacts.contacts[0].vcard, /TEL;.*:\+12025550102/);
});

test('saving VCF preserves its extension without opening a text viewer or fetching under desktop CSP', async () => {
  const original = {document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch};
  const downloads = [];
  globalThis.document = {body: {appendChild() {}}, createElement: () => ({
    click() {downloads.push({name: this.download, url: this.href});}, remove() {},
  })};
  globalThis.window = {open() {assert.fail('VCF must not open a browser text viewer');}};
  globalThis.fetch = () => {assert.fail('VCF download must not depend on CSP-blocked data/blob fetch');};
  try {
    const data = 'data:text/x-vcard;base64,QkVHSU46VkNBUkQ=';
    await openMediaInNewTab(data, 'text/x-vcard', 'contacts.vcf');
    await openMediaInNewTab('blob:cached-vcf', 'text/vcard');
    await openMediaInNewTab('https://example.com/contacts', 'application/octet-stream', 'export.VCF');
    assert.deepEqual(downloads.map(d => d.name), ['contacts.vcf', 'contacts.vcf', 'export.VCF']);
    assert.equal(downloads[0].url, data);
    await assert.rejects(openMediaInNewTab('javascript:alert(1)', 'text/x-vcard', 'contacts.vcf'));
  } finally {Object.assign(globalThis, original);}
});
