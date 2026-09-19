import assert from "node:assert/strict";
import test from "node:test";
import {
  stripHeavyContactMediaForPersist,
  stripHeavyMediaForPersist,
} from "../src/lib/persistMedia.ts";

const heavy = `data:image/jpeg;base64,${"a".repeat(8_100)}`;

test("persist snapshot strips reproducible inline media", () => {
  const contacts = stripHeavyContactMediaForPersist([
    { id: "c1", avatarUrl: "data:image/jpeg;base64,small", avatarFullUrl: heavy },
  ]);
  const messages = stripHeavyMediaForPersist([
    {
      id: "m1",
      chatId: "chat-1",
      body: "hello",
      direction: "in",
      sentAt: "2026-08-12T10:00:00.000Z",
      mediaType: "image",
      mediaUrl: heavy,
      senderAvatarUrl: "data:image/jpeg;base64,small",
    },
  ]);

  assert.equal(contacts[0].avatarFullUrl, undefined);
  assert.equal(contacts[0].avatarUrl, "data:image/jpeg;base64,small");
  assert.equal(messages[0].mediaUrl, undefined);
  assert.equal(messages[0].senderAvatarUrl, undefined);
  assert.equal(messages[0].mediaType, "image");
  assert.equal(messages[0].mediaPending, true);
});

test("persisted voice media is marked for automatic reload", () => {
  const messages = stripHeavyMediaForPersist([
    {
      id: "voice-1",
      chatId: "chat-1",
      body: "[voice]",
      direction: "out",
      sentAt: "2026-08-12T10:00:00.000Z",
      mediaType: "audio",
      mediaUrl: `data:audio/ogg;base64,${"a".repeat(8_100)}`,
      mediaPending: false,
    },
  ]);

  assert.equal(messages[0].mediaUrl, undefined);
  assert.equal(messages[0].mediaType, "audio");
  assert.equal(messages[0].mediaPending, true);
});
