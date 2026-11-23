import assert from "node:assert/strict";
import test from "node:test";
import { androidVoiceAttachment } from "../src/store/androidVoiceAttachment.ts";

const message = { id: "voice-1", deviceId: "phone-a", direction: "in", mediaType: "audio" };
const item = { targetMessageId: "voice-1", mediaUrl: "data:audio/ogg;base64,AA==" };

test("voice return updates only the original inbound voice on the originating phone", () => {
  const patch = androidVoiceAttachment(message, item, "phone-a");
  assert.equal(patch.mediaUrl, item.mediaUrl);
  assert.equal(patch.mediaPending, false);
  assert.equal(androidVoiceAttachment(message, item, "phone-b"), undefined);
  assert.equal(androidVoiceAttachment({ ...message, id: "voice-2" }, item, "phone-a"), undefined);
  assert.equal(androidVoiceAttachment({ ...message, mediaUrl: "already-loaded" }, item, "phone-a"), undefined);
  assert.equal(androidVoiceAttachment({ ...message, direction: "out" }, item, "phone-a"), undefined);
});

test("voice return retains complete audio through the 8 MiB limit", () => {
  const fromBytes = (size) => ({ ...item, mediaUrl: `data:audio/ogg;base64,${Buffer.alloc(size).toString("base64")}` });
  const max = 8 * 1024 * 1024;
  const supported = fromBytes(max);
  assert.equal(androidVoiceAttachment(message, supported, "phone-a").mediaUrl, supported.mediaUrl);
  assert.equal(androidVoiceAttachment(message, fromBytes(max + 1), "phone-a"), undefined);
  assert.equal(androidVoiceAttachment(message, { ...item, mediaUrl: "data:audio/ogg;base64,AA=A" }, "phone-a"), undefined);
});
