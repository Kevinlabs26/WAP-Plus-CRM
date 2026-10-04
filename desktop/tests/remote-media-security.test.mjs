import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createCipheriv } from 'node:crypto';
import { getMediaKeys } from 'baileys';
import { isPublicAddress, validateRemoteMediaUrl, downloadRemoteMedia } from '../baileys-bridge/remoteMedia.mjs';
import { downloadSafeMediaMessage, createMediaDownloader } from '../baileys-bridge/mediaDownload.mjs';
import { readBoundedStream } from '../baileys-bridge/httpUtil.mjs';
import { createBaileysRequestHandler } from '../baileys-bridge/httpServer.mjs';

function mockNetwork(t, replies, addresses = [{ address: '8.8.8.8', family: 4 }]) {
  const requests = [];
  const originalLookup = dns.lookup;
  const originalRequest = https.request;
  t.after(() => { dns.lookup = originalLookup; https.request = originalRequest; });
  dns.lookup = async () => addresses;
  https.request = (url, options, callback) => {
    assert.equal(options.agent, false);
    assert.notEqual(options.rejectUnauthorized, false);
    options.lookup(url.hostname, { all: true }, (error, pinned) => {
      assert.equal(error, null);
      assert.equal(pinned.length, 1);
      assert(isPublicAddress(pinned[0].address));
    });
    assert.equal(options.servername, url.hostname);
    requests.push(url.href);
    const reply = replies.shift();
    assert(reply, 'unexpected request');
    const response = Readable.from([reply.body || Buffer.from('ok')]);
    response.statusCode = reply.status || 200;
    response.headers = reply.headers || {};
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => callback(response));
    return request;
  };
  return requests;
}

test('media rejects local, special, mapped IPs, unsafe schemes, credentials and ports', () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '100.64.0.1',
    '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
    '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1', '3fff::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700::1111']) assert(isPublicAddress(address));
  for (const url of ['http://example.com/a', 'https://127.1/a', 'https://0x7f000001/a',
    'https://2130706433/a', 'https://[::ffff:127.0.0.1]/a', 'https://user:pass@example.com/a',
    'https://example.com:8443/a', 'https://localhost/a', 'file:///secret', 'data:text/plain,secret']) {
    assert.throws(() => validateRemoteMediaUrl(url), error => error.status === 400);
  }
});

test('media validates every redirect and pins DNS results to TLS', async t => {
  const requests = mockNetwork(t, [{ status: 302, headers: { location: 'https://127.0.0.1/private' } }]);
  await assert.rejects(downloadRemoteMedia('https://media.example/a', 20), error => error.status === 400);
  assert.equal(requests.length, 1);
});

test('mixed public/private DNS is rejected before making a request', async t => {
  const requests = mockNetwork(t, [], [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  await assert.rejects(downloadRemoteMedia('https://media.example/a', 20));
  assert.equal(requests.length, 0);
});

test('media follows public redirects, bounds bytes and catches DNS rebinding on the next hop', async t => {
  const requests = mockNetwork(t, [
    { status: 302, headers: { location: '/final' } }, { body: Buffer.from('image'), headers: { 'content-type': 'image/png' } },
    { body: Buffer.alloc(30) }, { status: 302, headers: { location: '/private' } },
  ]);
  assert.deepEqual(await downloadRemoteMedia('https://media.example/a', 20), { buffer: Buffer.from('image'), contentType: 'image/png' });
  await assert.rejects(downloadRemoteMedia('https://media.example/large', 20), /media too large/);
  let lookups = 0;
  dns.lookup = async () => [{ address: ++lookups === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
  await assert.rejects(downloadRemoteMedia('https://media.example/rebind', 20));
  assert.equal(requests.length, 4);
});

test('inbound ciphertext is downloaded safely then decrypted by the original SDK in memory', async t => {
  const mediaKey = Buffer.alloc(32, 7);
  const { cipherKey, iv } = await getMediaKeys(mediaKey, 'image');
  const plain = Buffer.from('bounded image bytes');
  const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), Buffer.alloc(10)]);
  const requests = mockNetwork(t, [{ body: encrypted }]);
  const message = { message: { imageMessage: { mediaKey, directPath: '/media', url: 'https://mmg.whatsapp.net/old' } } };
  const stream = await downloadSafeMediaMessage(message, 100);
  assert.deepEqual(await readBoundedStream(stream, 100), plain);
  assert.equal(message.message.imageMessage.url, 'https://mmg.whatsapp.net/old');
  assert.deepEqual(requests, ['https://mmg.whatsapp.net/media']);
  await assert.rejects(downloadSafeMediaMessage({ message: { imageMessage: { mediaKey, url: 'https://attacker.example/a' } } }, 100));
  assert.equal(requests.length, 1);
});

test('reupload URL is checked again instead of letting SDK fetch it directly', async t => {
  const requests = mockNetwork(t, [{ status: 404 }]);
  let retries = 0;
  const downloader = createMediaDownloader({ getConnection: () => 'connected', getSocket: () => ({
    updateMediaMessage: async () => { retries++; return { message: { imageMessage: { url: 'https://127.0.0.1/private' } } }; },
  }) });
  assert.equal(await downloader.mediaToDataUrl({ message: { imageMessage: { url: 'https://mmg.whatsapp.net/a' } } }, 'image'), '');
  assert.equal(retries, 1);
  assert.equal(requests.length, 1);
});

test('media queue rejects overload explicitly, limits concurrency and accepts later retries', async t => {
  const originalLookup = dns.lookup;
  const originalRequest = https.request;
  t.after(() => { dns.lookup = originalLookup; https.request = originalRequest; });
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  const active = [];
  let concurrent = 0;
  let peak = 0;
  https.request = () => {
    const request = new EventEmitter();
    request.end = () => {
      peak = Math.max(peak, ++concurrent);
      active.push(() => { concurrent--; request.emit('error', new Error('test transport failure')); });
    };
    return request;
  };
  const downloader = createMediaDownloader({ getConnection: () => 'connected' });
  const message = { message: { imageMessage: { url: 'https://mmg.whatsapp.net/a' } } };
  const pending = Array.from({ length: 100 }, () => downloader.mediaToDataUrl(message, 'image', '', { force: true }));
  const finished = Promise.allSettled(pending);
  // Hold the first downloads so the waiting queue actually saturates.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active.length, 3);
  for (let i = 0; i < 100; i++) {
    active.splice(0).forEach(release => release());
    await new Promise(resolve => setImmediate(resolve));
  }
  const results = await finished;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 67);
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 33);
  assert(rejected.every(result => result.reason.status === 503));
  assert.equal(peak, 3);
  const retry = downloader.mediaToDataUrl(message, 'image');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active.length, 1);
  active.splice(0).forEach(release => release());
  assert.equal(await retry, '');
});

test('send and catalog routes hand bounded buffers to SDK and reject private URLs', async t => {
  const requests = mockNetwork(t, [{ body: Buffer.from('image') }, { body: Buffer.from('product') }]);
  const sent = [];
  const server = http.createServer(createBaileysRequestHandler({
    token: 'test-token', port: 0, connection: 'connected', resolveSendJid: async () => '123@s.whatsapp.net',
    rawWaByMsgId: new Map([['busy', { message: { imageMessage: {} } }]]),
    findStoredMessageByKey: () => null,
    mediaToDataUrl: async () => { throw Object.assign(new Error('media busy'), { status: 503 }); },
    socket: { user: { id: '123@s.whatsapp.net' }, sendMessage: async (_jid, content) => { sent.push(content); return { key: { id: 'sent' } }; } },
    products: new Map([['p', { id: 'p', name: 'product', imageUrls: { one: 'https://media.example/product' } }]]),
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { 'X-Wap-Token': 'test-token' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await post('/send', { phoneE164: '123', imageUrl: 'https://media.example/image' })).status, 200);
    assert(Buffer.isBuffer(sent[0].image));
    assert.equal((await post('/catalog/send', { phoneE164: '123', productId: 'p' })).status, 200);
    assert(Buffer.isBuffer(sent[1].product.productImage));
    for (const imageUrl of ['http://media.example/image', 'https://169.254.169.254/latest/meta-data']) {
      assert.equal((await post('/send', { phoneE164: '123', imageUrl })).status, 400);
    }
    assert.equal(sent.length, 2);
    assert.equal(requests.length, 2);
    const busy = await post('/message/media', { key: { id: 'busy' }, mediaType: 'image' });
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get('retry-after'), '5');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('real HTTPS transport honors pinned DNS in Node and compiled-sidecar Bun runtime', async () => {
  let accepted = 0;
  const server = net.createServer(socket => { accepted++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await new Promise(resolve => {
      const request = https.request(`https://dns-pin.invalid:${server.address().port}`, {
        agent: false, servername: 'dns-pin.invalid', signal: AbortSignal.timeout(2000),
        lookup: (_host, options, callback) => options.all
          ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
      });
      request.on('error', resolve); // Deliberately non-TLS peer; verification must fail.
      request.end();
    });
    assert.equal(accepted, 1, 'transport must use the pinned address, never resolve the original hostname again');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
