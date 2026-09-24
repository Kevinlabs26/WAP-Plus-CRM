import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BAILEYS_BRIDGE_PROTOCOL_VERSION as sharedVersion,
  BAILEYS_LIBRARY_VERSION as sharedLibraryVersion,
} from "../../shared/baileysProtocol.ts";
import {
  BAILEYS_BRIDGE_PROTOCOL_VERSION as runtimeVersion,
  BAILEYS_LIBRARY_VERSION as runtimeLibraryVersion,
} from "../baileys-bridge/protocol.mjs";
import { createMessageIngest } from "../baileys-bridge/messageIngest.mjs";
import { describeMessage } from "../baileys-bridge/messageDescribe.mjs";
import { isHumanName } from "../baileys-bridge/jidUtils.mjs";
import { createBaileysRequestHandler } from "../baileys-bridge/httpServer.mjs";
import { BoundedMessageMap } from "../baileys-bridge/messageStore.mjs";

assert.equal(sharedVersion, runtimeVersion);
assert.equal(sharedLibraryVersion, runtimeLibraryVersion);
assert.equal(isHumanName("群成员"), false);
assert.equal(isHumanName("+225 0710288215"), false);

const boundedMessages = new BoundedMessageMap(2);
boundedMessages.set("a", 1).set("b", 2).set("c", 3);
assert.deepEqual([...boundedMessages.keys()], ["b", "c"]);
boundedMessages.set("b", 4);
assert.deepEqual([...boundedMessages.entries()], [["c", 3], ["b", 4]]);

const server = readFileSync(
  new URL("../baileys-bridge/httpServer.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(server, /subErrors\.d\.push/);
assert.doesNotMatch(server, /(?<!\.)\bupsertContact\(target\)/);
assert.doesNotMatch(server, /await endSocketQuietly\(/);
assert.doesNotMatch(server, /(?<!\.)\brawWaByMsgId\.get\(/);
assert.doesNotMatch(server, /\$\{url\.pathname\}/);
assert.match(server, /mediaType === "sticker"/);
assert.match(server, /sticker: parsed\.buf/);
assert.match(server, /mediaType === "gif"/);
assert.match(server, /gifPlayback: true/);
assert.match(server, /File-selected audio is regular WhatsApp audio/);
assert.match(server, /const parsed = parseDataUrl\(audioDataUrl\)/);
assert.match(server, /forward: original/);
assert.match(server, /rawWaByMsgId\.get\(forwardKey\.id\)/);
assert.match(server, /url\.pathname === "\/labels"/);
assert.match(server, /addChatLabel/);
assert.match(server, /removeChatLabel/);
assert.match(server, /addOrEditQuickReply/);
assert.match(server, /removeQuickReply/);
assert.match(server, /eventsDroppedThrough/);
assert.match(server, /count: droppedThrough - after/);

const catalogRoutes = readFileSync(
  new URL("../baileys-bridge/catalogRoutes.mjs", import.meta.url),
  "utf8"
);
assert.match(catalogRoutes, /getCatalog/);
assert.match(catalogRoutes, /priceAmount1000/);

const bridgeIndex = readFileSync(
  new URL("../baileys-bridge/index.mjs", import.meta.url),
  "utf8"
);
assert.match(bridgeIndex, /sock\.ev\.on\("labels\.edit"/);
assert.match(bridgeIndex, /sock\.ev\.on\("labels\.association"/);
assert.match(bridgeIndex, /eventsDroppedThrough = removed\[removed\.length - 1\]\?\.seq/);
assert.match(bridgeIndex, /shouldSyncHistoryMessage: \(\) => true/);
assert.match(bridgeIndex, /FULL_HISTORY_SYNC_ON_DEMAND/);
assert.match(bridgeIndex, /useMultiFileAuthState\(authDir\)/);
assert.doesNotMatch(bridgeIndex, /auth-state\.json|useAtomicAuthState/);
assert.match(bridgeIndex, /browser: Browsers\.ubuntu\("Chrome"\)/);
assert.doesNotMatch(bridgeIndex, /Browsers\.macOS\("Desktop"\)/);

const audioConvert = readFileSync(
  new URL("../baileys-bridge/audioConvert.mjs", import.meta.url),
  "utf8"
);
assert.match(audioConvert, /const FFMPEG_AUDIO_TIMEOUT_MS = 60_000/);
assert.match(audioConvert, /const FFMPEG_GIF_TIMEOUT_MS = 30_000/);
assert.match(audioConvert, /const timer = setTimeout/);
assert.match(audioConvert, /child\.kill\("SIGKILL"\)/);
assert.match(audioConvert, /timeoutMs: FFMPEG_AUDIO_TIMEOUT_MS/);
assert.match(audioConvert, /timeoutMs: FFMPEG_GIF_TIMEOUT_MS/);

const watcher = readFileSync(
  new URL("../src/components/bridge/BaileysWatcher.tsx", import.meta.url),
  "utf8"
);
assert.match(watcher, /result\.gap && result\.gap\.count > 0/);
assert.match(watcher, /正在全量同步/);

const gapHandler = createBaileysRequestHandler({
  token: "test-token",
  port: 17891,
  events: [{ seq: 6, type: "messages.sync" }],
  sequence: 6,
  eventsDroppedThrough: 5,
  statusPayload: () => ({
    protocolVersion: sharedVersion,
    baileysVersion: sharedLibraryVersion,
  }),
});
const gapResponse = {
  status: 0,
  body: "",
  setHeader() {},
  writeHead(status) {
    this.status = status;
  },
  end(body) {
    this.body = body;
  },
};
await gapHandler(
  {
    method: "GET",
    url: "/events?after=2",
    headers: { "x-wap-token": "test-token" },
  },
  gapResponse
);
const gapPayload = JSON.parse(gapResponse.body);
assert.deepEqual(gapPayload.gap, { after: 2, from: 3, to: 5, count: 3 });

const sendQueue = readFileSync(
  new URL("../src/components/bridge/SendQueueWatcher.tsx", import.meta.url),
  "utf8"
);
assert.match(sendQueue, /if \(msg\.mediaType\) return/);

const baileysCore = readFileSync(
  new URL("../src/lib/baileysCore.ts", import.meta.url),
  "utf8"
);
const baileysSend = readFileSync(
  new URL("../src/lib/baileysSend.ts", import.meta.url),
  "utf8"
);
const baileysChannel = readFileSync(
  new URL("../src/channels/baileys.ts", import.meta.url),
  "utf8"
);
assert.match(baileysCore, /AbortSignal\.timeout\(10_000\)/);
assert.match(baileysCore, /method === "GET" \|\| method === "HEAD" \? 15_000 : 30_000/);
assert.match(baileysCore, /errorName === "TimeoutError"/);
assert.match(baileysSend, /AbortSignal\.timeout\(30_000\)/);
assert.match(baileysChannel, /if \(!sendStarted\) return temporarilyUnavailableResult\(\)/);

const gif = describeMessage({
  message: { videoMessage: { gifPlayback: true, mimetype: "video/mp4" } },
});
assert.equal(gif.mediaType, "gif");
assert.equal(gif.body, "[GIF]");

const order = describeMessage({
  message: {
    orderMessage: {
      itemCount: 2,
      totalAmount1000: 12500,
      totalCurrencyCode: "EUR",
      orderId: "order-1",
      token: "token-1",
    },
  },
});
assert.equal(order.mediaType, "order");
assert.match(order.body, /EUR 12\.50/);
assert.equal(order.orderId, "order-1");

const secretEncrypted = describeMessage({
  message: { secretEncryptedMessage: { targetMessageId: "hidden" } },
});
assert.equal(secretEncrypted.body, "");

const contacts = new Map();
const messages = new Map();
const ingest = createMessageIngest({
  contacts,
  messages,
  isSelfJid: () => false,
  upsertContact: (jid, name) => {
    const contact = contacts.get(jid) || {
      jid,
      displayName: name || "测试群",
      isGroup: jid.endsWith("@g.us"),
    };
    contacts.set(jid, contact);
    return contact;
  },
  mergeHumanName: () => undefined,
  rememberLidPn: () => undefined,
  rememberRawWa: () => undefined,
  mediaToDataUrl: async () => "",
  enrichContact: async () => null,
  enqueueAvatar: () => undefined,
  push: () => undefined,
  timestamp: () => 1_700_000_000_000,
});
const groupMessage = ingest.ingestMessage({
  key: {
    id: "group-message-1",
    remoteJid: "120363012345678@g.us",
    participant: "12025550123@s.whatsapp.net",
    fromMe: false,
  },
  pushName: "Alice",
  messageTimestamp: 1_700_000_000,
  message: { conversation: "大家好" },
});
assert.equal(groupMessage?.isGroup, true);
assert.equal(groupMessage?.senderName, "Alice");
assert.equal(groupMessage?.senderPhoneE164, "+12025550123");
assert.equal(contacts.get("120363012345678@g.us")?.lastMessage, "Alice: 大家好");

const quotedGroupMessage = ingest.ingestMessage({
  key: {
    id: "group-reply-1",
    remoteJid: "120363012345678@g.us",
    participant: "12025550123@s.whatsapp.net",
    fromMe: false,
  },
  pushName: "Alice",
  messageTimestamp: 1_700_000_001,
  message: {
    extendedTextMessage: {
      text: "Ça c'est qui?",
      contextInfo: {
        stanzaId: "group-message-1",
        participant: "12025550123@s.whatsapp.net",
        quotedMessage: { audioMessage: { seconds: 76, ptt: true } },
      },
    },
  },
});
assert.equal(quotedGroupMessage?.quoted?.id, "group-message-1");
assert.equal(quotedGroupMessage?.quoted?.body, "[语音 76s]");
assert.equal(quotedGroupMessage?.quoted?.senderName, "Alice");

console.log("baileys-protocol.test.mjs ok");
