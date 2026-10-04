import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createBaileysRequestHandler } from '../baileys-bridge/httpServer.mjs';
import { requestBody, readBoundedStream } from '../baileys-bridge/httpUtil.mjs';
import { resolveConfig } from 'vite';
import { openMediaInNewTab, triggerMediaDownload } from '../src/components/chat/messageMediaUtils.ts';
import { runFfmpegToOggOpus, safeVideoThumbnail } from '../baileys-bridge/audioConvert.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('sidecar rejects hostile origins and missing auth; local UI can preflight', async () => {
  let restarts = 0;
  const server = http.createServer(createBaileysRequestHandler({
    token: 'test-token', port: 0, statusPayload: () => ({ connection: 'connected' }),
    connect: async () => { restarts++; },
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:3000.evil.example']) {
      const res = await fetch(base + '/status', { headers: { Origin: origin, 'X-Wap-Token': 'test-token' } });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await fetch(base + '/status')).status, 401);
    const preflight = await fetch(base + '/status', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const native = await fetch(base + '/status', { headers: { 'X-Wap-Token': 'test-token' } });
    assert.equal(native.status, 200);
    assert.equal(native.headers.get('cache-control'), 'no-store');
    const bad = await fetch(base + '/restart', { method: 'POST', headers: { 'X-Wap-Token': 'test-token' }, body: 'null' });
    assert.equal(bad.status, 400);
    assert.equal(restarts, 0, 'invalid JSON must not clear WhatsApp auth');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('request body preserves UTF-8 across chunks and rejects non-object JSON and oversized input', async () => {
  const bytes = Buffer.from('{"text":"你好"}');
  assert.deepEqual(await requestBody(Readable.from([bytes.subarray(0, 10), bytes.subarray(10)])), { text: '你好' });
  for (const body of ['null', '[]', '42', '{']) {
    await assert.rejects(requestBody(Readable.from([Buffer.from(body)])), error => error.status === 400);
  }
  await assert.rejects(requestBody(Readable.from([Buffer.alloc(40_000_001)])), error => error.status === 413);
});

test('media size limit aborts the stream before buffering the full response', async () => {
  let read = 0;
  let closed = false;
  async function* chunks() {
    try { for (let i = 0; i < 100; i++) { read++; yield Buffer.alloc(3); } }
    finally { closed = true; }
  }
  await assert.rejects(readBoundedStream(chunks(), 5), /media too large/);
  assert.equal(read, 2);
  assert.equal(closed, true);
  assert.deepEqual(await readBoundedStream(Readable.from([Buffer.from('ok')]), 2), Buffer.from('ok'));
});

test('Vite never exposes Tauri signing secrets to the frontend', async () => {
  const key = 'TAURI_SIGNING_PRIVATE_KEY';
  const old = process.env[key];
  process.env[key] = 'test-only-signing-secret';
  try {
    const config = await resolveConfig({ root: fileURLToPath(new URL('../', import.meta.url)) }, 'build');
    assert.equal(config.env[key], undefined);
    assert.deepEqual(config.envPrefix, ['VITE_']);
  } finally {
    if (old === undefined) delete process.env[key]; else process.env[key] = old;
  }
});

test('media open/download rejects executable protocols and downloads active documents', async () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  let opened = 0;
  let downloaded = 0;
  globalThis.window = { open() { opened++; }, setTimeout() {} };
  globalThis.document = { body: { appendChild() {} }, createElement: () => ({ click() { downloaded++; }, remove() {} }) };
  try {
    for (const url of ['javascript:alert(1)', 'file:///secret', 'vbscript:msgbox(1)']) {
      await assert.rejects(openMediaInNewTab(url));
      assert.throws(() => triggerMediaDownload(url, 'test'));
    }
    for (const mime of ['text/html', 'image/svg+xml', 'application/xhtml+xml']) {
      await openMediaInNewTab(`data:${mime};base64,PHNjcmlwdD4=`, mime);
    }
    assert.equal(opened, 0);
    assert.equal(downloaded, 3);
    await openMediaInNewTab('data:application/pdf;base64,JVBERg==');
    assert.equal(opened, 1);
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});

test('ffmpeg cannot fetch network resources referenced by an uploaded playlist', {
  skip: spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status !== 0,
}, async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => { requests++; res.end('private'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(join(tmpdir(), 'wap-ffmpeg-security-'));
  try {
    const input = join(directory, 'input.m3u8');
    await writeFile(input, `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${server.address().port}/private.ts\n#EXT-X-ENDLIST\n`);
    await assert.rejects(runFfmpegToOggOpus(input, join(directory, 'out.ogg'), 1));
    assert.equal((await safeVideoThumbnail(await readFile(input))).length, 0);
    assert.equal(requests, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
