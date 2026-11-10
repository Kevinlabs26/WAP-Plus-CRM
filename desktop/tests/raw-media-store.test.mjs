import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRawMediaStore } from "../baileys-bridge/rawMediaStore.mjs";
import { serialize } from "node:v8";
import { detachMessageBuffers } from "../baileys-bridge/messageStore.mjs";

const dir = await mkdtemp(join(tmpdir(), "bridgecrm-media-index-"));
try {
  const store = createRawMediaStore(dir, 10);
  const message = {
    key: { id: "media-1", remoteJid: "123@s.whatsapp.net" },
    message: { audioMessage: { mediaKey: Buffer.from([1, 2, 3]) } },
  };
  await store.save("media-1", message);

  const restored = await createRawMediaStore(dir, 10).load("media-1");
  assert.equal(restored.key.id, "media-1");
  assert.deepEqual(restored.message.audioMessage.mediaKey, Buffer.from([1, 2, 3]));
  assert.equal(await store.load("missing"), null);

  const historyPacket = Buffer.alloc(8 * 1024 * 1024, 7);
  const protocol = { key: { id: 'small-key' }, message: { audioMessage: {
    mediaKey: historyPacket.subarray(128, 160), fileSha256: historyPacket.subarray(160, 192),
    waveform: new Uint8Array(historyPacket.buffer, 200, 64),
  } } };
  const detached = detachMessageBuffers(protocol);
  assert.equal(detached.message.audioMessage.mediaKey.buffer.byteLength, 32);
  assert.equal(detached.message.audioMessage.waveform.buffer.byteLength, 64);
  assert.deepEqual(detached, protocol, 'keep every protocol field and byte');
  assert.ok(serialize(detached).byteLength < 2048, 'release Bun must not persist the entire history packet');
  await store.save('small-key', protocol);
  const small = await store.load('small-key');
  assert.deepEqual(small, protocol, 'small views of large packets must not be rejected as oversized media');
  assert.equal(small.message.audioMessage.mediaKey.buffer.byteLength, 32);
  historyPacket.fill(9);
  assert.equal(small.message.audioMessage.mediaKey[0], 7, 'cached protocol bytes must own their backing storage');

  for (let i = 0; i < 5; i++) await store.save(`old-${i}`, { data: Buffer.alloc(512) });
  const bounded = createRawMediaStore(dir, 2, 1200);
  await bounded.load("missing");
  const files = (await readdir(dir)).filter(name => name.endsWith('.bin'));
  assert.ok(files.length <= 2, 'restart must trim old caches by count');
  const sizes = await Promise.all(files.map(name => stat(join(dir, name)).then(info => info.size)));
  assert.ok(sizes.reduce((sum,size)=>sum+size,0) <= 1200, 'restart must enforce the byte cap');
  await bounded.save('oversized', { data: Buffer.alloc(4 * 1024 * 1024 + 1) });
  assert.equal(await bounded.load('oversized'), null, 'oversized protocol objects must not expand the cache');

  const budgetDir = join(dir, 'budget');
  const budget = createRawMediaStore(budgetDir, 1000, 1200);
  for (let i = 0; i < 30; i++) {
    await budget.save(`row-${i}`, { data: Buffer.alloc(400), version: i });
    const files = (await readdir(budgetDir)).filter(n => n.endsWith('.bin'));
    const bytes = await Promise.all(files.map(n => stat(join(budgetDir, n)).then(s => s.size)));
    assert.ok(bytes.reduce((sum, size) => sum + size, 0) <= 1200, 'enforce budget after every write, not every 200 writes');
  }
  assert.equal((await budget.load('row-29')).version, 29, 'keep newest cache entries');
  await budget.save('coalesced', { version: -1 });
  const writes = Array.from({ length: 1000 }, (_, version) => budget.save('coalesced', { version }));
  await Promise.all(writes);
  assert.equal((await budget.load('coalesced')).version, 999, 'coalesce queued updates without stale overwrites');
  const filesBefore = (await readdir(budgetDir)).filter(n => n.endsWith('.bin'));
  for (const name of filesBefore) await utimes(join(budgetDir, name), 1, 1);
  await budget.save('coalesced', { version: 999 });
  const filesAfter = (await readdir(budgetDir)).filter(n => n.endsWith('.bin'));
  assert.ok((await Promise.all(filesAfter.map(n => stat(join(budgetDir, n))))).every(s => s.mtimeMs === 1000), 'unchanged data does not rewrite cache files');

  const burst = createRawMediaStore(join(dir, 'burst'), 4000, 512 * 1024 * 1024);
  await Promise.all(Array.from({ length: 1000 }, (_, i) => burst.save(`burst-${i}`, { id: i, data: Buffer.alloc(32 * 1024) })));
  assert.ok((await readdir(join(dir, 'burst'))).length < 512, 'bound burst bytes independently of the larger on-disk cache budget');
  assert.equal((await burst.load('burst-999')).id, 999);
  const smallBurst = createRawMediaStore(join(dir, 'small-burst'), 4000);
  await Promise.all(Array.from({ length: 500 }, (_, i) => smallBurst.save(`small-${i}`, { id: i, key: Buffer.alloc(32) })));
  assert.equal((await readdir(join(dir, 'small-burst'))).length, 500, 'ordinary small protocol messages survive a history burst');
  console.log("raw media store tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
