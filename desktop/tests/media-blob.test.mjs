import assert from "node:assert/strict";
import test from "node:test";

import { dataUrlToBlob } from "../src/lib/mediaBlob.ts";

test("dataUrlToBlob decodes base64 audio without fetch", async () => {
  const blob = dataUrlToBlob("data:audio/ogg;base64,SGVsbG8=");
  assert.equal(blob.type, "audio/ogg");
  assert.equal(await blob.text(), "Hello");
});

test("dataUrlToBlob decodes percent-encoded payloads", async () => {
  const blob = dataUrlToBlob("data:text/plain,hello%20world");
  assert.equal(await blob.text(), "hello world");
});
