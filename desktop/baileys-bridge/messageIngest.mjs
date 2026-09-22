import { describeMessage, unwrapContent } from "./messageDescribe.mjs";
import {
  isHumanName,
  isLidJid,
  phoneFromJid,
} from "./jidUtils.mjs";

/**
 * Some Baileys stores expose the latest WAMessage on a chat record even when
 * no matching messages.upsert event reaches this companion. Recover those
 * messages so a chat preview never exists without its transcript row.
 */
export function extractChatLastMessages(chats) {
  const byId = new Map();
  for (const chat of chats || []) {
    const message = chat?.lastMsg;
    const id = message?.key?.id;
    if (!id || !message?.key?.remoteJid || !message?.message) continue;
    byId.set(id, message);
  }
  return [...byId.values()];
}

/**
 * deps: {
 *   contacts, messages, // Maps
 *   isSelfJid, upsertContact, mergeHumanName, rememberLidPn,
 *   rememberRawWa, rememberRawMedia, mediaToDataUrl, getOrderDetails, enrichContact, enqueueAvatar,
 *   push, timestamp,
 * }
 */
export function createMessageIngest(deps) {
  const {
    contacts,
    messages,
    isSelfJid,
    upsertContact,
    mergeHumanName,
    rememberLidPn,
    rememberRawWa,
    rememberRawMedia,
    mediaToDataUrl,
    getOrderDetails,
    enrichContact,
    enqueueAvatar,
    push,
    timestamp,
  } = deps;

  /** enrich 结果批量推送，避免每条媒体/头像各打一次 messages.sync 风暴 */
  const pendingEnrichItems = new Map();
  const pendingContactItems = new Map();
  let enrichFlushTimer = null;
  function scheduleEnrichFlush() {
    if (enrichFlushTimer) return;
    enrichFlushTimer = setTimeout(() => {
      enrichFlushTimer = null;
      if (pendingContactItems.size) {
        const items = Array.from(pendingContactItems.values());
        pendingContactItems.clear();
        push("contacts.sync", { items, source: "enrich" });
      }
      if (pendingEnrichItems.size) {
        const items = Array.from(pendingEnrichItems.values());
        pendingEnrichItems.clear();
        push("messages.sync", {
          items,
          live: false,
          source: "enrich",
        });
      }
    }, 220);
  }
  function queueEnrichMessage(item) {
    if (!item?.id) return;
    pendingEnrichItems.set(item.id, item);
    scheduleEnrichFlush();
  }
  function queueEnrichContact(payload) {
    if (!payload) return;
    const key =
      payload.jid ||
      payload.channelAddress ||
      payload.phoneE164 ||
      payload.id ||
      "";
    if (!key) return;
    pendingContactItems.set(String(key), payload);
    scheduleEnrichFlush();
  }

  function extractAltFromMessage(message) {
    const key = message?.key || {};
    const candidates = [
      key.remoteJidAlt,
      key.participantAlt,
      message?.participant,
      // 出站回执里常有对方 PN
      message?.userReceipt?.[0]?.userJid,
      message?.message?.extendedTextMessage?.contextInfo?.participant,
    ];
    for (const c of candidates) {
      if (!c || typeof c !== "string") continue;
      if (phoneFromJid(c) || c.endsWith("@s.whatsapp.net") || c.endsWith("@c.us"))
        return c;
    }
    return "";
  }

  /** 从内存通讯录里给 jid 找已有显示名（历史消息常无 pushName） */
  function lookupStoredName(jid, alt = "") {
    const keys = [jid, alt, phoneFromJid(alt) && `${phoneFromJid(alt).replace(/\D/g, "")}@s.whatsapp.net`]
      .filter(Boolean);
    for (const k of keys) {
      const c = contacts.get(k);
      if (c && isHumanName(c.displayName)) return c.displayName.trim();
    }
    if (phoneFromJid(jid) || phoneFromJid(alt)) {
      const phone = phoneFromJid(jid) || phoneFromJid(alt);
      for (const c of contacts.values()) {
        if (c.phoneE164 === phone && isHumanName(c.displayName))
          return c.displayName.trim();
      }
    }
    return "";
  }

  function contactPayload(c) {
    if (!c) return null;
    return {
      // 始终带上 LID 作为稳定会话键，避免 PN/LID 在前端拆成两人
      jid: c.jid,
      pnJid: c.pnJid || "",
      channelAddress: c.lidJid || (isLidJid(c.jid) ? c.jid : c.lidJid) || c.jid,
      phoneE164: c.phoneE164 || "",
      displayName: c.displayName || "",
      lastMessage: c.lastMessage || "",
      updatedAt: c.updatedAt || Date.now(),
      avatarUrl: c.avatarUrl || "",
      isGroup: Boolean(c.isGroup),
      participantCount: c.participantCount || undefined,
      groupOwner: c.groupOwner || undefined,
      groupDesc: c.groupDesc || undefined,
      groupAnnounce: c.groupAnnounce || undefined,
      groupRestrict: c.groupRestrict || undefined,
      groupEphemeral: c.groupEphemeral || undefined,
      groupJoinApproval: c.groupJoinApproval || undefined,
      groupLinkedParent: c.groupLinkedParent || undefined,
      groupIsCommunity: c.groupIsCommunity || undefined,
    };
  }

  function ingestMessage(message) {
    const jid = message?.key?.remoteJid;
    const meta = describeMessage(message);
    const body = meta.body;
    if (!jid) return null;
    // 反应：允许 body 为空
    const isReaction = meta.mediaType === "reaction";
    if (!isReaction && !body) return null;
    // 动态不属于 CRM 会话，不解析、不下载媒体。
    if (jid === "status@broadcast") return null;
    if (isSelfJid(jid)) return null;
    const isGroup = jid.endsWith("@g.us");
    const participant = message?.key?.participant || message?.participant || "";
    const alt = extractAltFromMessage(message);
    if (!isGroup && alt && isLidJid(jid)) rememberLidPn(jid, alt);
    // 群消息：participant 常为 LID，alt/participantAlt 可能是 PN
    if (isGroup && participant && alt && isLidJid(participant)) {
      rememberLidPn(participant, alt);
    }

    // 仅入站 pushName = 对方昵称（协议：stanza.attrs.notify）
    const fromMe = Boolean(message.key?.fromMe);
    const pushName = fromMe
      ? ""
      : (message.pushName || message.verifiedBizName || "").trim();
    const storedName = lookupStoredName(jid, isGroup ? "" : alt);
    const nameHint = isGroup ? storedName : pushName || storedName;
    const contact = upsertContact(
      jid,
      nameHint,
      isGroup ? "" : phoneFromJid(alt) || alt
    );
    if (!contact) return null;
    if (nameHint && !isGroup) {
      mergeHumanName(contact, nameHint);
      contacts.set(jid, contact);
    }

    // 群成员：把发言人写入通讯录，便于显示名/头像/lookup
    let senderContact = null;
    if (isGroup && participant && !fromMe) {
      senderContact = upsertContact(
        participant,
        pushName || "",
        phoneFromJid(alt) || alt || ""
      );
      if (senderContact && pushName) {
        mergeHumanName(senderContact, pushName);
        contacts.set(participant, senderContact);
        if (alt && !isLidJid(alt)) {
          const pnKey = alt.includes("@")
            ? alt
            : `${String(phoneFromJid(alt) || alt).replace(/\D/g, "")}@s.whatsapp.net`;
          const c2 = upsertContact(pnKey, pushName, phoneFromJid(alt) || alt);
          if (c2) {
            mergeHumanName(c2, pushName);
            contacts.set(c2.jid || pnKey, c2);
          }
        }
      }
    }

    // 绝不把 @lid 用户段数字当「名字」展示（前端会显示成一长串绿号）
    const senderName = isGroup
      ? fromMe
        ? "我"
        : (isHumanName(pushName) ? pushName.trim() : "") ||
          (senderContact && isHumanName(senderContact.displayName)
            ? senderContact.displayName.trim()
            : "") ||
          lookupStoredName(participant, alt) ||
          phoneFromJid(alt) ||
          phoneFromJid(participant) ||
          "群成员"
      : "";
    const senderAvatarUrl =
      isGroup && !fromMe
        ? senderContact?.avatarUrl ||
          contacts.get(participant)?.avatarUrl ||
          ""
        : "";
    const sentAt = timestamp(message.messageTimestamp);
    const key = message.key || {};

    // 引用消息上下文不是正文的一部分，必须从 Baileys 的 contextInfo 单独传出。
    // 不同消息类型会把 contextInfo 放在各自的 *Message 节点里；这里统一读取，
    // 这样图片、语音、文件和普通文本的引用都能保持一致。
    const contextInfo = (() => {
      const content = unwrapContent(message) || message?.message || {};
      return (
        content?.extendedTextMessage?.contextInfo ||
        content?.imageMessage?.contextInfo ||
        content?.videoMessage?.contextInfo ||
        content?.audioMessage?.contextInfo ||
        content?.documentMessage?.contextInfo ||
        content?.stickerMessage?.contextInfo ||
        content?.documentWithCaptionMessage?.message?.documentMessage?.contextInfo ||
        meta?.contextInfo ||
        {}
      );
    })();
    const quoted = (() => {
      const quotedMessage = contextInfo?.quotedMessage;
      const quotedId = String(contextInfo?.stanzaId || "").trim();
      if (!quotedMessage || !quotedId) return undefined;
      const quotedMeta = describeMessage({ message: quotedMessage });
      const quotedRemoteJid = String(
        contextInfo?.remoteJid || key.remoteJid || jid || ""
      ).trim();
      const quotedParticipant = String(contextInfo?.participant || "").trim();
      const quotedFromMe =
        contextInfo?.fromMe === true ||
        (Boolean(contextInfo?.participant) && isSelfJid(contextInfo.participant));
      const quotedSenderName = quotedFromMe
        ? ""
        : isGroup
          ? lookupStoredName(quotedParticipant) ||
            (quotedParticipant === participant ? senderName : "") ||
            pushName ||
            contact.displayName ||
            ""
          : contact.displayName || pushName || "";
      return {
        id: quotedId,
        body: String(quotedMeta.body || "").slice(0, 20_000),
        fromMe: quotedFromMe,
        remoteJid: quotedRemoteJid || undefined,
        participant: quotedParticipant || undefined,
        senderName: quotedSenderName || undefined,
        mediaType: quotedMeta.mediaType || undefined,
        mediaSeconds: quotedMeta.seconds || undefined,
      };
    })();

    // 表情回应：推 reaction 事件，不占一条会话气泡
    if (isReaction) {
      const emoji = meta.reactionEmoji || "";
      const targetId = meta.reactionTargetId || "";
      if (!targetId && !emoji) return null;
      // 反应者 jid：群内优先 participant（发言/反应人），不是被反应消息的 key.participant
      const reactorJid = fromMe
        ? ""
        : participant || key.participant || meta.reactionTargetParticipant || "";
      return {
        kind: "reaction",
        id: key.id || `react:${targetId}:${sentAt}`,
        jid: contact.jid,
        channelAddress: contact.lidJid || contact.jid,
        phoneE164: contact.phoneE164,
        displayName: contact.displayName,
        isGroup,
        groupJid: isGroup ? jid : undefined,
        senderJid: reactorJid || undefined,
        participant: reactorJid || undefined,
        senderName: isGroup
          ? fromMe
            ? "我"
            : senderName || pushName || undefined
          : undefined,
        direction: fromMe ? "out" : "in",
        sentAt,
        emoji,
        // 被回应的消息 id
        targetMessageId: targetId,
        targetRemoteJid: meta.reactionTargetRemoteJid || jid,
        targetFromMe: meta.reactionTargetFromMe,
        fromMe,
        waKey: {
          remoteJid: key.remoteJid || jid,
          fromMe: Boolean(key.fromMe),
          id: key.id || "",
          participant: key.participant || undefined,
        },
      };
    }

    const mentionedJids = (() => {
      try {
        const ctx = contextInfo;
        const arr = ctx.mentionedJid || ctx.mentionedJids || [];
        return Array.isArray(arr)
          ? [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))]
          : [];
      } catch {
        return [];
      }
    })();

    const item = {
      id: key.id || `${jid}:${sentAt}`,
      jid: contact.jid,
      channelAddress: contact.lidJid || contact.jid,
      phoneE164: contact.phoneE164,
      displayName: contact.displayName,
      pushName: pushName || "",
      isGroup,
      groupJid: isGroup ? jid : undefined,
      mentionedJids: mentionedJids.length ? mentionedJids : undefined,
      mentionedMe:
        isGroup && !fromMe && mentionedJids.some((mentioned) => isSelfJid(mentioned)),
      senderJid: isGroup ? participant : undefined,
      senderPhoneE164: isGroup
        ? phoneFromJid(participant) || phoneFromJid(alt) || ""
        : undefined,
      senderName: isGroup ? senderName : undefined,
      /** 群内发言人头像（非群头像） */
      senderAvatarUrl: isGroup ? senderAvatarUrl : undefined,
      body,
      direction: fromMe ? "out" : "in",
      sentAt,
      avatarUrl: isGroup
        ? senderAvatarUrl || ""
        : contact.avatarUrl || "",
      mediaType: meta.mediaType || "",
      mediaMime: meta.mimetype || "",
      mediaFileName: meta.fileName || "",
      mediaSeconds: meta.seconds || 0,
      mediaPtt: Boolean(meta.ptt),
      mediaCaption: meta.caption || "",
      pollName: meta.pollName || "",
      pollOptions: meta.pollOptions || [],
      pollSelectableCount: Number(meta.pollSelectableCount) || 0,
      contactCard: meta.contactCard || undefined,
      mediaUrl: "",
      /** 协议自带 jpeg 缩略图，视频未下完也能先看封面 */
      mediaThumbUrl: meta.thumbnailUrl || "",
      quoted,
      // 协议操作用：撤回/已读/引用
      waKey: {
        remoteJid: key.remoteJid || jid,
        fromMe: Boolean(key.fromMe),
        id: key.id || "",
        participant: key.participant || undefined,
      },
    };
    contact.lastMessage =
      isGroup && !fromMe ? `${senderName}: ${body}` : body;
    contact.updatedAt = sentAt;
    // 媒体默认不塞 base64：仅保留协议缩略图 + raw 供 /message/media 按需拉
    const hasBinaryMedia =
      meta.mediaType &&
      ["image", "sticker", "audio", "video", "gif", "document"].includes(
        meta.mediaType
      );
    if (hasBinaryMedia) {
      item.mediaPending = true;
    }

    messages.set(item.id, item);
    // 不在桥接内存里截断历史消息。/sync 是断线补偿和前端重启恢复的
    // 最后一条链路，保留最近 5000 条会让更早的聊天记录永久消失。
    rememberRawWa(item.id, message);
    if (hasBinaryMedia) {
      rememberRawMedia?.(item.id, message);
      if (item.waKey?.id && item.waKey.id !== item.id) {
        rememberRawMedia?.(item.waKey.id, message);
      }
    }

    void (async () => {
      let dirty = false;

      // 订单详情仍可异步补全文（体积小，非二进制媒体）
      if (meta.mediaType === "order" && meta.orderId && meta.orderToken) {
        try {
          const details = await getOrderDetails?.(meta.orderId, meta.orderToken);
          const lines = (details?.products || []).map((product) =>
            `${product.name || product.id} \u00d7${Number(product.quantity) || 1}`
          );
          if (lines.length) {
            item.body = `${meta.body}\n${lines.join("\n")}`;
            messages.set(item.id, item);
            dirty = true;
          }
        } catch {
          /* keep the order summary when details are unavailable */
        }
      }

      if (isGroup && participant && !fromMe) {
        // 群：enrich 发言人，而不是整个群 jid
        try {
          const se = await enrichContact(
            participant,
            pushName || senderName || "",
            alt || ""
          );
          if (se) {
            if (isHumanName(se.displayName)) {
              item.senderName = se.displayName.trim();
            }
            item.senderAvatarUrl = se.avatarUrl || item.senderAvatarUrl || "";
            item.avatarUrl = item.senderAvatarUrl || item.avatarUrl || "";
            item.senderPhoneE164 =
              se.phoneE164 || item.senderPhoneE164 || "";
            messages.set(item.id, item);
            dirty = true;
            const payload = contactPayload(se);
            if (payload) queueEnrichContact(payload);
            enqueueAvatar(se.jid || participant);
          } else {
            enqueueAvatar(participant);
          }
        } catch {
          enqueueAvatar(participant);
        }
      } else if (!isGroup) {
        const enriched = await enrichContact(
          jid,
          pushName || contact.displayName || "",
          alt || contact.pnJid
        );
        if (enriched) {
          item.phoneE164 = enriched.phoneE164;
          item.displayName = enriched.displayName;
          // 头像 URL 通常是 http(s)/短链，允许；禁止把大体量 data: 灌事件
          const av = enriched.avatarUrl || "";
          if (av && !(av.startsWith("data:") && av.length > 12_000)) {
            item.avatarUrl = av;
          }
          messages.set(item.id, item);
          dirty = true;
          const payload = contactPayload(enriched);
          if (payload) queueEnrichContact(payload);
          enqueueAvatar(enriched.jid);
        }
      }

      if (dirty) queueEnrichMessage(item);
    })();

    return item;
  }


  return {
    extractAltFromMessage,
    lookupStoredName,
    contactPayload,
    ingestMessage,
  };
}
