import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/lib/exportData.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  alias: { "@": join(dir, "../src") },
  write: false,
});

const { parseBackupJson } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
  const restored = parseBackupJson({
    version: 2,
    messages: [
      {
        id: "out-1",
        chatId: "chat-1",
        direction: "out",
        body: "do not resend automatically",
        sentAt: "2026-08-12T10:00:00.000Z",
        deliveryStatus: "queued",
        retryCount: 1,
        nextAttemptAt: "2026-08-12T10:01:00.000Z",
        quoted: { id: "quoted-1", body: "original", fromMe: false },
        reactions: [{ emoji: "👍", from: "peer", at: "2026-08-12T10:02:00.000Z" }],
        waKey: {
          id: "wa-out-1",
          remoteJid: "12025550100@s.whatsapp.net",
          fromMe: true,
        },
      },
    ],
    contacts: [
      {
        id: "contact-1",
        name: "Alice",
        phone: "+12025550100",
        tags: [],
        stage: "vip_custom",
      },
    ],
    broadcastCampaigns: [
      {
        id: "campaign-1",
        accountId: "wa-1",
        template: "hello",
        status: "running",
        createdAt: "2026-08-12T10:00:00.000Z",
        items: [
          {
            id: "item-1",
            contactId: "contact-1",
            contactName: "Alice",
            phoneE164: "+12025550100",
            bodyRendered: "hello",
            status: "sending",
          },
        ],
      },
    ],
  });

  assert.equal(restored.messages[0].deliveryStatus, "failed");
  assert.equal(restored.messages[0].retryCount, 5);
  assert.equal(restored.messages[0].nextAttemptAt, undefined);
  assert.match(restored.messages[0].lastError, /未自动重发/);
  assert.equal(restored.messages[0].quoted.id, "quoted-1");
  assert.equal(restored.messages[0].reactions[0].emoji, "👍");
  assert.equal(restored.messages[0].waKey.id, "wa-out-1");
  assert.equal(restored.contacts[0].stage, "vip_custom");
  assert.equal(restored.broadcastCampaigns[0].status, "paused");
  assert.equal(restored.broadcastCampaigns[0].items[0].status, "failed");
console.log("backup-recovery.test.mjs ok");
