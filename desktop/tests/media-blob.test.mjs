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

test("audio reads reject oversized headers and actual streams, and cancel the reader", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const advertised of [0, 14_000_001]) {
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
      await assert.rejects(mediaUrlToBlob("https://example.com/voice"), /14 MB/);
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
    assert.throws(() => dataUrlToBlob("data:audio/ogg;base64," + "A".repeat(18_666_672)), /14 MB/);
  } finally { globalThis.atob = originalAtob; }
});
