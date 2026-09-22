import assert from "node:assert/strict";
import { parseMessageItem } from "../src/store/parseMessageItem.ts";

const CTX = { deviceId: "d1", messagesLength: 0 };

function resultOf(raw) {
  return parseMessageItem(raw, CTX);
}

// —— 判空丢弃 ——
assert.equal(resultOf({}), null);
assert.equal(resultOf({ body: "   " }), null);
assert.equal(resultOf({ body: "hello" })?.isReaction, false);
assert.equal(resultOf({ body: "[secretEncrypted]" }), null);
// WhatsApp 置顶/取消置顶：协议动作，丢弃不进会话
assert.equal(resultOf({ body: "[pinInChat]" }), null);
assert.equal(resultOf({ body: "[unpinInChat]" }), null);
// 媒体消息允许空 body
assert.equal(resultOf({ mediaType: "image", mediaUrl: "data:image/png;base64,x" })?.isReaction, false);
// system 类型空 body 保留
assert.equal(resultOf({ mediaType: "system" })?.isReaction, false);

// —— 表情回应 ——
const reaction = resultOf({ kind: "reaction", emoji: "👍", targetMessageId: "m1", fromMe: true });
assert.equal(reaction?.isReaction, true);
assert.equal(reaction.isReaction && reaction.emoji, "👍");
assert.equal(reaction.isReaction && reaction.reactorKey, "me");
const reactionFromMember = resultOf({
  body: "[表情] ❤️",
  targetMessageId: "m2",
  senderJid: "123@s.whatsapp.net",
  senderName: "Sample Contact A",
});
assert.equal(reactionFromMember?.isReaction, true);
assert.equal(reactionFromMember.isReaction && reactionFromMember.emoji, "❤️");
assert.equal(reactionFromMember.isReaction && reactionFromMember.reactorKey, "m:123@s.whatsapp.net");
// 错误落库的「[表情]」独立气泡会被标记 legacyBubbleBody
const legacy = resultOf({ id: "legacy1", body: "[表情] 👍", targetMessageId: "m3" });
assert.equal(legacy?.isReaction, true);
assert.equal(legacy.isReaction && legacy.bogusId, "legacy1");
assert.equal(legacy.isReaction && legacy.legacyBubbleBody, "[表情] 👍");

// —— 普通消息字段 ——
const msg = resultOf({
  body: "  Hello   World ",
  direction: "out",
  id: "wa-id-1",
  sentAt: "2026-01-01T00:00:00.000Z",
});
assert.equal(msg?.isReaction, false);
assert.equal(msg.isReaction === false && msg.body, "Hello   World");
assert.equal(msg.isReaction === false && msg.normBody, "Hello World");
assert.equal(msg.isReaction === false && msg.waId, "wa-id-1");
assert.equal(
  msg.isReaction === false && msg.localMessageId,
  "bridge-msg-d1-wa-id-1"
);
assert.equal(msg.isReaction === false && msg.direction, "out");
assert.equal(msg.isReaction === false && msg.sentTs, 1767225600000);

// 无 id 的兜底 id（使用 messagesLength）
const noId = resultOf({ body: "x", sentAt: "2026-01-01T00:00:00.000Z" });
assert.equal(
  noId.isReaction === false && noId.waId,
  "bridge-msg-d1-2026-01-01T00:00:00.000Z-0"
);

// —— 媒体 / key / 群信息 ——
const media = resultOf({
  body: "pic",
  mediaType: "image",
  mediaUrl: "https://example.com/a.png",
  mediaSeconds: 12,
  mediaCaption: "caption",
  groupJid: "120363012345678@g.us",
  senderJid: "456@s.whatsapp.net",
  senderName: "Sample Contact B",
  mentionedJids: ["123@s.whatsapp.net"],
  mentionedMe: true,
  waKey: { id: "k1", remoteJid: "120363012345678@g.us", fromMe: false },
});
assert.equal(media.isReaction === false && media.mediaType, "image");
assert.equal(media.isReaction === false && media.mediaUrl, "https://example.com/a.png");
assert.equal(media.isReaction === false && media.mediaSeconds, 12);
assert.equal(media.isReaction === false && media.isGroup, true);
assert.equal(media.isReaction === false && media.groupJid, "120363012345678@g.us");
assert.equal(media.isReaction === false && media.senderName, "Sample Contact B");
assert.equal(media.isReaction === false && media.mentionedMe, true);
assert.equal(media.isReaction === false && media.waKey?.id, "k1");

// —— 引用消息：保留原消息正文和发送者，媒体无正文时也给出可读占位 ——
const quoted = resultOf({
  body: "Ça c'est qui?",
  direction: "in",
  id: "reply-1",
  quoted: {
    id: "voice-1",
    body: "[语音 76s]",
    fromMe: false,
    remoteJid: "123@s.whatsapp.net",
    senderName: "Celeste Temoin",
    mediaType: "audio",
    mediaSeconds: 76,
  },
});
assert.equal(quoted.isReaction === false && quoted.quoted?.id, "voice-1");
assert.equal(
  quoted.isReaction === false && quoted.quoted?.body,
  "[语音 76s]"
);
assert.equal(
  quoted.isReaction === false && quoted.quoted?.senderName,
  "Celeste Temoin"
);
const quotedImage = resultOf({
  body: "reply",
  id: "reply-2",
  quoted: { id: "image-1", mediaType: "image" },
});
assert.equal(quotedImage.isReaction === false && quotedImage.quoted?.body, "[图片]");

const contactCard = resultOf({
  body: "[名片] Shared Person",
  mediaType: "contact",
  contactCard: {
    displayName: "Shared Person",
    phoneE164: "+12025550147",
    vcard: "BEGIN:VCARD\nEND:VCARD",
  },
});
assert.equal(contactCard.isReaction === false && contactCard.mediaType, "contact");
assert.equal(
  contactCard.isReaction === false && contactCard.contactCard?.phoneE164,
  "+12025550147"
);

// —— 不透明发送者名被滤掉 ——
const opaque = resultOf({ body: "hi", senderName: "12025550123" });
assert.equal(opaque.isReaction === false && opaque.senderName, undefined);
const opaqueGroup = resultOf({ body: "hi", senderName: "群成员" });
assert.equal(opaqueGroup.isReaction === false && opaqueGroup.senderName, undefined);

// —— 大 dataURL 媒体被标记 mediaPending，不进内存 ——
const bigData = resultOf({
  body: "big",
  mediaType: "image",
  mediaUrl: `data:image/png;base64,${"A".repeat(20_000)}`,
});
assert.equal(bigData.isReaction === false && bigData.mediaUrl, undefined);
assert.equal(bigData.isReaction === false && bigData.mediaPending, true);

console.log("parseMessageItem ok");
