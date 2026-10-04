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

const { parseBackupJson, contactsToCsv, buildExportBundle } = await import(
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
const unsafe = parseBackupJson({ version: 2, contacts: restored.contacts, settingsSafe: {
  bridgeToken: "attacker", customAiKey: "attacker", customAiBaseUrl: "https://attacker.invalid",
  aiReplyMode: "auto", rateLimitEnabled: false, blockSendWhenOverheated: false,
  unknownSetting: "bad", theme: "light", internalNotesByKey: { customer: "saved note" },
  scheduledMessages: [{ id: "pending", status: "pending" }, { id: "queued", status: "queued", messageId: "out" }, { id: "sent", status: "sent" }],
}});
assert.equal(unsafe.settingsSafe.theme, "light");
assert.equal(unsafe.settingsSafe.internalNotesByKey.customer, "saved note");
for (const key of ["bridgeToken", "customAiKey", "customAiBaseUrl", "aiReplyMode", "rateLimitEnabled", "blockSendWhenOverheated", "unknownSetting"]) assert.equal(Object.hasOwn(unsafe.settingsSafe, key), false);
assert.deepEqual(unsafe.settingsSafe.scheduledMessages.map(x => x.status), ["failed", "failed", "sent"]);
assert.equal(unsafe.settingsSafe.scheduledMessages[1].messageId, undefined);
for (const value of ["=1+1", "+cmd", "-cmd", "@SUM(1)", "  =1+1", "\t=1+1", "＝1+1"]) {
  const csv = contactsToCsv([{ ...restored.contacts[0], name: value, phone: "001234" }]);
  assert.ok(csv.includes('"\'' + value + '"'));
  assert.ok(csv.includes('"\'001234"'));
}
const mediaUrl = "data:image/png;base64," + "A".repeat(9000);
const input = { ...restored, settings: {}, messages: [{ ...restored.messages[0], mediaUrl }] };
assert.equal(buildExportBundle(input).messages[0].mediaUrl, undefined);
assert.equal(Object.hasOwn(buildExportBundle({ ...input, draftReplyByChatId: { a: 'unsent private draft' } }), 'draftReplyByChatId'), false);
const withMedia = buildExportBundle({ ...input, includeMedia: true });
assert.equal(parseBackupJson(withMedia).messages[0].mediaUrl, mediaUrl);
console.log("backup-recovery.test.mjs ok");

for (const id of ['wa/a', 'wa?a', 'wa-A', 'con', 'wa-' + 'x'.repeat(64)]) {
  assert.throws(() => parseBackupJson({ contacts: [{ id: 'c' }], settingsSafe: { waAccounts: [{ id }] } }), /账号/);
  assert.throws(() => parseBackupJson({ contacts: [{ id: 'c', accountId: id }] }), /账号/);
}
assert.throws(() => parseBackupJson({ contacts: [{ id: 'c' }], settingsSafe: { waAccounts: [{ id: 'wa-a' }, { id: 'wa-a' }] } }), /重复/);
