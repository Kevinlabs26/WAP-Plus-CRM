import assert from "node:assert/strict";
import test from "node:test";

import { dataUrlToBlob, mediaUrlToBlob } from "../src/lib/mediaBlob.ts";

test("dataUrlToBlob decodes base64 audio without fetch", async () => {
  const blob = dataUrlToBlob("data:audio/ogg;base64,SGVsbG8=");
  assert.equal(blob.type, "audio/ogg");
  assert.equal(await blob.text(), "Hello");
});

test("dataUrlToBlob decodes percent-encoded payloads", async () => {
  const blob = dataUrlToBlob("data:text/plain,hello%20world");
  assert.equal(await blob.text(), "hello world");
});

test("media callers enforce their own byte limit without changing the default audio limit", async () => {
  assert.equal((await dataUrlToBlob("data:image/webp;base64,SGVsbG8=", "image/webp", 5).text()), "Hello");
  assert.throws(() => dataUrlToBlob("data:image/webp;base64,SGVsbG8=", "image/webp", 4), /大小上限/);
});

test("audio reads reject oversized headers and actual streams, and cancel the reader", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const advertised of [0, 16 * 1024 * 1024 + 1]) {
      let cancelled = false;
      let released = false;
      const reader = {
        read: async () => ({ done: false, value: { byteLength: 14_000_001 } }),
        cancel: async () => { cancelled = true; },
        releaseLock: () => { released = true; },
      };
      globalThis.fetch = async () => ({ ok: true,
        headers: new Headers({ "content-length": String(advertised) }),
        body: { getReader: () => reader, cancel: reader.cancel },
        blob: async () => new Blob(["unbounded old path"]),
      });
      await assert.rejects(mediaUrlToBlob("https://example.com/voice"), /16 MiB/);
      assert.equal(cancelled, true);
      assert.equal(released, advertised === 0);
    }
    globalThis.fetch = async () => new Response("Hello", { headers: { "content-type": "audio/ogg" } });
    const blob = await mediaUrlToBlob("blob:voice");
    assert.equal(await blob.text(), "Hello");
    assert.equal(blob.type, "audio/ogg");
  } finally { globalThis.fetch = originalFetch; }
});

test("oversized data URL is rejected before base64 decoding", () => {
  const originalAtob = globalThis.atob;
  try {
    globalThis.atob = () => { throw new Error("decoder should not be called"); };
    assert.throws(() => dataUrlToBlob("data:audio/ogg;base64," + "A".repeat(22_369_628)), /16 MiB/);
  } finally { globalThis.atob = originalAtob; }
});

test('a regular audio attachment around 15 MiB decodes without the old 14 MB rejection',()=>{
 const payload=Buffer.alloc(15*1024*1024).toString('base64');
 assert.equal(dataUrlToBlob('data:audio/mpeg;base64,'+payload).size,15*1024*1024);
});
