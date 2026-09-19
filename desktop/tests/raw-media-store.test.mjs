import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRawMediaStore } from "../baileys-bridge/rawMediaStore.mjs";

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
  console.log("raw media store tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
