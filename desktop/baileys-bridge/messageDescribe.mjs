import {
  getContentType,
  normalizeMessageContent,
} from "baileys";
import { parseContactVcard } from "./contactVcard.mjs";

/** 解包 ephemeral / viewOnce / 设备同步 等外层 */
function thumbDataUrl(msgPart) {
  try {
    const th =
      msgPart?.jpegThumbnail ||
      msgPart?.thumbnail ||
      msgPart?.thumbnailDirectPath && null;
    if (!th) return "";
    if (typeof th === "string") {
      if (th.startsWith("data:")) return th;
      // already base64?
      if (/^[A-Za-z0-9+/=\s]+$/.test(th) && th.length > 80)
        return `data:image/jpeg;base64,${th.replace(/\s+/g, "")}`;
      return "";
    }
    // Buffer / Uint8Array
    if (th?.type === "Buffer" && Array.isArray(th.data)) {
      return `data:image/jpeg;base64,${Buffer.from(th.data).toString("base64")}`;
    }
    if (th instanceof Uint8Array || Buffer.isBuffer(th)) {
      return `data:image/jpeg;base64,${Buffer.from(th).toString("base64")}`;
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function unwrapContent(message) {
  let content = message?.message;
  if (!content || typeof content !== "object") return null;
  try {
    content = normalizeMessageContent(content) || content;
  } catch {
    /* keep */
  }
  // 再剥一层常见壳
  for (let i = 0; i < 4; i++) {
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
      continue;
    }
    if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
      continue;
    }
    if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
      continue;
    }
    if (content.viewOnceMessageV2Extension?.message) {
      content = content.viewOnceMessageV2Extension.message;
      continue;
    }
    if (content.documentWithCaptionMessage?.message) {
      content = content.documentWithCaptionMessage.message;
      continue;
    }
    if (content.templateMessage?.hydratedTemplate) {
      const t = content.templateMessage.hydratedTemplate;
      content = {
        conversation:
          t.hydratedContentText || t.hydratedTitleText || "[模板消息]",
      };
      break;
    }
    if (content.buttonsMessage) {
      content = {
        conversation:
          content.buttonsMessage.contentText ||
          content.buttonsMessage.text ||
          "[按钮消息]",
      };
      break;
    }
    if (content.listMessage) {
      content = {
        conversation:
          content.listMessage.description ||
          content.listMessage.title ||
          "[列表消息]",
      };
      break;
    }
    break;
  }
  return content;
}

/**
 * @returns {{ body: string, mediaType: string, caption: string, mimetype: string, fileName: string, seconds: number, ptt: boolean, contactCard?: { displayName: string, phoneE164: string, vcard: string } }}
 */
export function describeMessage(message) {
  const empty = {
    body: "",
    mediaType: "",
    caption: "",
    mimetype: "",
    fileName: "",
    seconds: 0,
    ptt: false,
  };
  const content = unwrapContent(message);
  if (!content) return empty;

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    "";

  if (content.imageMessage) {
    const cap = content.imageMessage.caption || "";
    const thumb = thumbDataUrl(content.imageMessage);
    return {
      ...empty,
      body: cap || "[图片]",
      mediaType: "image",
      caption: cap,
      mimetype: content.imageMessage.mimetype || "image/jpeg",
      thumbnailUrl: thumb || "",
    };
  }
  if (content.stickerMessage) {
    return {
      ...empty,
      body: "[贴纸]",
      mediaType: "sticker",
      mimetype: content.stickerMessage.mimetype || "image/webp",
    };
  }
  if (content.videoMessage) {
    const cap = content.videoMessage.caption || "";
    const sec = Number(content.videoMessage.seconds) || 0;
    const isGif = Boolean(content.videoMessage.gifPlayback);
    const thumb = thumbDataUrl(content.videoMessage);
    return {
      ...empty,
      body: isGif ? "[GIF]" : cap || (sec ? `[视频 ${sec}s]` : "[视频]"),
      mediaType: isGif ? "gif" : "video",
      caption: cap,
      mimetype: content.videoMessage.mimetype || "video/mp4",
      seconds: sec,
      thumbnailUrl: thumb || "",
    };
  }
  if (content.audioMessage) {
    const sec = Number(content.audioMessage.seconds) || 0;
    const ptt = Boolean(content.audioMessage.ptt);
    const label = ptt ? "语音" : "音频";
    const rawWaveform = content.audioMessage.waveform;
    const waveform =
      rawWaveform instanceof Uint8Array || Array.isArray(rawWaveform)
        ? Array.from(rawWaveform).slice(0, 128).map(Number)
        : undefined;
    return {
      ...empty,
      body: sec ? `[${label} ${sec}s]` : `[${label}]`,
      mediaType: "audio",
      mimetype: content.audioMessage.mimetype || "audio/ogg; codecs=opus",
      seconds: sec,
      ptt,
      waveform,
    };
  }
  if (content.documentMessage) {
    const name =
      content.documentMessage.fileName ||
      content.documentMessage.title ||
      "文件";
    const cap = content.documentMessage.caption || "";
    return {
      ...empty,
      body: cap || `[文件] ${name}`,
      mediaType: "document",
      caption: cap,
      fileName: name,
      mimetype: content.documentMessage.mimetype || "application/octet-stream",
    };
  }
  if (content.contactMessage || content.contactsArrayMessage) {
    const raw =
      content.contactMessage || content.contactsArrayMessage?.contacts?.[0] || {};
    const vcard = String(raw.vcard || "");
    const card = parseContactVcard(
      vcard,
      raw.displayName || content.contactsArrayMessage?.displayName || ""
    );
    return {
      ...empty,
      body: card.displayName ? `[名片] ${card.displayName}` : "[名片]",
      mediaType: "contact",
      contactCard: { ...card, vcard },
    };
  }
  if (content.locationMessage || content.liveLocationMessage) {
    const loc = content.locationMessage || content.liveLocationMessage;
    const name = loc?.name || loc?.address || "";
    return {
      ...empty,
      body: name ? `[位置] ${name}` : "[位置]",
      mediaType: "location",
    };
  }
  if (content.productMessage) {
    const product = content.productMessage.product || {};
    const title = product.title || content.productMessage.body || "";
    return {
      ...empty,
      body: title ? `[\u5546\u54c1] ${title}` : "[\u5546\u54c1]",
      mediaType: "product",
      caption: content.productMessage.body || "",
    };
  }
  if (content.orderMessage) {
    const order = content.orderMessage;
    const count = Number(order.itemCount) || 0;
    const amount = Number(order.totalAmount1000) || 0;
    const currency = order.totalCurrencyCode || "";
    const total = amount && currency ? ` ${currency} ${(amount / 1000).toFixed(2)}` : "";
    return {
      ...empty,
      body: `[\u8ba2\u5355] ${count || "?"} \u4ef6${total}`,
      mediaType: "order",
      orderId: order.orderId || "",
      orderToken: order.token || "",
    };
  }
  const poll =
    content.pollCreationMessage ||
    content.pollCreationMessageV2 ||
    content.pollCreationMessageV3 ||
    content.pollCreationMessageV5;
  if (poll) {
    const name = String(poll.name || "投票").trim();
    return {
      ...empty,
      body: `[投票] ${name}`,
    };
  }
  if (content.reactionMessage) {
    // 反应不是独立气泡；由 ingestMessage 特殊处理
    const emoji = content.reactionMessage.text || "";
    const targetKey = content.reactionMessage.key || {};
    return {
      ...empty,
      body: "", // 不进消息列表正文
      mediaType: "reaction",
      reactionEmoji: emoji,
      reactionTargetId: targetKey.id || "",
      reactionTargetRemoteJid: targetKey.remoteJid || "",
      reactionTargetFromMe:
        typeof targetKey.fromMe === "boolean" ? targetKey.fromMe : undefined,
      reactionTargetParticipant: targetKey.participant || undefined,
    };
  }
  if (content.pollUpdateMessage) return empty;
  if (content.protocolMessage || content.secretEncryptedMessage) {
    return empty;
  }
  if (content.albumMessage) {
    return empty;
  }
  if (text) {
    return { ...empty, body: String(text) };
  }

  // 未知类型：尽量标出 type，避免笼统「[消息]」
  let type = "";
  try {
    type = getContentType(content) || "";
  } catch {
    type = Object.keys(content).find((k) => !k.startsWith("sender")) || "";
  }
  if (type && type !== "senderKeyDistributionMessage") {
    return { ...empty, body: `[${type.replace(/Message$/, "") || "消息"}]` };
  }
  return empty;
}

export function bodyOf(message) {
  return describeMessage(message).body;
}
