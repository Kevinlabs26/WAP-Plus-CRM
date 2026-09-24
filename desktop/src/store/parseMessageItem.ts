import type { MessageContactCard, WaMessageKey } from "@/types/crm";
import { isHiddenProtocolMessageBody } from "./messageOrdering.ts";

function ingestString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function ingestObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 纯解析层：把单条 bridge 原始消息 item 解析为结构化 envelope。
 * 不访问 store / bag 状态，只依赖 item + ctx，便于单测。
 * 返回 null 表示本条应被丢弃（纯空且无媒体线索 / 非 system）。
 */

export type ParsedReaction = {
  isReaction: true;
  emoji: string;
  targetId: string;
  bogusId: string;
  /** body 以 [表情] 开头时的原文，用于清理错误落库的独立气泡 */
  legacyBubbleBody?: string;
  reactorKey: "me" | `m:${string}` | "peer";
  from: "me" | "member" | "peer";
  participantJid?: string;
  participantName?: string;
};

export type ParsedEnvelope = {
  isReaction: false;
  direction: "in" | "out";
  /** 原始截断正文（媒体消息可空） */
  body: string;
  /** 空白折叠后的正文，用于回声/去重匹配 */
  normBody: string;
  sentAt: string;
  /** sentAt 解析后的毫秒时间戳 */
  sentTs: number;
  waId: string;
  localMessageId: string;
  mediaType?: string;
  mediaUrl?: string;
  mediaMime?: string;
  mediaFileName?: string;
  mediaSeconds?: number;
  mediaPtt?: boolean;
  mediaWaveform?: number[];
  mediaCaption?: string;
  mediaThumbUrl?: string;
  mediaPending?: boolean;
  contactCard?: MessageContactCard;
  /** 是否有媒体线索（媒体类型或任意 mediaUrl/dataUrl/缩略图） */
  hasMediaHint: boolean;
  isGroup: boolean;
  groupJid?: string;
  senderJid?: string;
  senderPhoneE164?: string;
  senderName?: string;
  senderAvatarUrl?: string;
  quoted?: {
    id: string;
    body: string;
    fromMe?: boolean;
    remoteJid?: string;
    participant?: string;
    senderName?: string;
    mediaType?: string;
    mediaSeconds?: number;
  };
  waKey?: WaMessageKey;
  systemKind?: string;
  systemAction?: string;
  mentionedJids?: string[];
  mentionedMe?: boolean;
};

export type ParsedMessageItem = ParsedReaction | ParsedEnvelope;

export type ParseMessageItemCtx = {
  deviceId: string;
  eventTs?: number;
  /** 解析时的 messages 长度，用于 bridge 消息 id 兜底 */
  messagesLength: number;
};

function isOpaqueSenderName(name?: string | null): boolean {
  const s = String(name || "").trim();
  if (!s) return true;
  if (s === "群成员" || s === "?" ) return true;
  if (s.includes("@lid") || s.includes("@s.whatsapp.net") || s.includes("@g.us"))
    return true;
  if (/^\d{10,}$/.test(s)) return true;
  return false;
}

export function parseMessageItem(
  raw: Record<string, unknown>,
  ctx: ParseMessageItemCtx
): ParsedMessageItem | null {
  const string = ingestString;
  const object = ingestObject;
  const item = raw;
  const { deviceId, eventTs, messagesLength } = ctx;

  // —— 表情回应：挂到原消息上，不新建气泡 ——
  const kind = string(item.kind ?? item.mediaType, 40);
  const bodyEarly = string(item.body ?? item.text, 10_000);
  const isReaction =
    kind === "reaction" ||
    /^\[表情\]/.test(bodyEarly) ||
    Boolean(string(item.emoji, 16) && string(item.targetMessageId, 300));
  if (isReaction) {
    let emoji = string(item.emoji ?? item.reactionEmoji, 16);
    if (!emoji && bodyEarly.startsWith("[表情]")) {
      emoji = bodyEarly.replace(/^\[表情\]\s*/, "").trim();
    }
    // 空 emoji = 取消反应
    const targetId =
      string(item.targetMessageId, 300) ||
      string(object(item.reactionTarget)?.id, 300) ||
      "";
    const bogusId = string(item.id, 300);
    const fromMe =
      item.fromMe === true ||
      item.direction === "out" ||
      string(item.direction) === "out";
    const participantJid =
      string(
        item.participant ??
          item.senderJid ??
          item.reactorJid ??
          object(item.waKey)?.participant,
        200
      ) || undefined;
    const participantName =
      string(item.senderName ?? item.participantName ?? item.pushName, 120) ||
      undefined;
    // 身份键：我 / 群成员 jid / 私聊 peer
    const reactorKey = fromMe
      ? "me"
      : participantJid
        ? (`m:${participantJid}` as `m:${string}`)
        : "peer";
    const from = fromMe
      ? "me"
      : participantJid
        ? "member"
        : "peer";
    return {
      isReaction: true,
      emoji,
      targetId,
      bogusId,
      legacyBubbleBody:
        bogusId && bodyEarly.startsWith("[表情]") ? bodyEarly : undefined,
      reactorKey,
      from,
      participantJid,
      participantName,
    };
  }

  // 纯空文案且无媒体/系统类型才丢弃（媒体消息 body 可空，否则永远进不了 enrich）
  const mediaHintEarly = string(item.mediaType, 40);
  const hasMediaHint =
    Boolean(mediaHintEarly) ||
    Boolean(item.mediaUrl || item.mediaDataUrl || item.mediaThumbUrl || item.thumbnailUrl);
  const body = bodyEarly;
  if (isHiddenProtocolMessageBody(body)) return null;
  if (!body && !hasMediaHint && mediaHintEarly !== "system") return null;
  // 兜底：绝不把 [表情] 当普通消息
  if (body && /^\[表情\]/.test(body)) return null;

  const direction = item.direction === "out" ? "out" : "in";
  const sentAtValue = item.sentAt ?? eventTs ?? Date.now();
  const parsedDate = new Date(
    typeof sentAtValue === "number" ||
      typeof sentAtValue === "string"
      ? sentAtValue
      : Date.now()
  );
  const sentAt = Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString()
    : parsedDate.toISOString();
  const sentTs = parsedDate.getTime();
  const protocolKey = object(item.waKey ?? item.key);
  const waId =
    string(item.id, 300) ||
    string(protocolKey?.id, 300) ||
    `bridge-msg-${deviceId}-${sentAt}-${messagesLength}`;
  const localMessageId = string(item.id, 300)
    ? `bridge-msg-${encodeURIComponent(deviceId)}-${encodeURIComponent(waId)}`
    : waId;
  const normBody = (body || "").replace(/\s+/g, " ").trim();

  const mediaType = string(item.mediaType, 40);
  // 同步事件默认不带大体量 base64；超限直接丢，留给 /message/media 按需补
  const rawMediaUrl = string(item.mediaUrl ?? item.mediaDataUrl, 5_000_000);
  // 大 dataURL 不进内存 store（改 mediaPending 按需拉）；阈值 16KB
  const mediaUrl =
    rawMediaUrl.startsWith("data:") &&
    rawMediaUrl.length > 16_000 &&
    string(item.mediaSource, 80) !== "android-media-share"
      ? ""
      : rawMediaUrl;
  const mediaMime = string(item.mediaMime ?? item.mimetype, 120);
  const mediaFileName = string(
    item.mediaFileName ?? item.fileName,
    240
  );
  const mediaSeconds =
    typeof item.mediaSeconds === "number"
      ? item.mediaSeconds
      : typeof item.seconds === "number"
        ? item.seconds
        : undefined;
  const mediaPtt = Boolean(item.mediaPtt ?? item.ptt);
  const rawWaveform = item.mediaWaveform ?? item.waveform;
  const mediaWaveform = Array.isArray(rawWaveform)
    ? rawWaveform
        .slice(0, 128)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 255)
    : undefined;
  const mediaCaption = string(item.mediaCaption ?? item.caption, 2000);
  const rawThumb = string(
    item.mediaThumbUrl ?? item.thumbnailUrl,
    5_000_000
  );
  const mediaThumbUrl =
    rawThumb &&
    !(rawThumb.startsWith("data:") && rawThumb.length > 16_000)
      ? rawThumb
      : undefined;
  const mediaPending =
    item.mediaPending === true ||
    (Boolean(mediaType) &&
      ["image", "sticker", "video", "gif", "audio", "document"].includes(
        mediaType.toLowerCase()
      ) &&
      !mediaUrl);
  const rawQuoted = object(item.quoted ?? item.replyTo ?? item.quotedMessage);
  const quoted = (() => {
    if (!rawQuoted) return undefined;
    const id = string(rawQuoted.id ?? rawQuoted.stanzaId, 300);
    if (!id) return undefined;
    const quotedMediaType = string(rawQuoted.mediaType, 40) || undefined;
    const quotedMediaSeconds =
      typeof rawQuoted.mediaSeconds === "number"
        ? rawQuoted.mediaSeconds
        : typeof rawQuoted.seconds === "number"
          ? rawQuoted.seconds
          : undefined;
    const explicitBody = string(
      rawQuoted.body ?? rawQuoted.text ?? rawQuoted.caption,
      20_000
    );
    const body =
      explicitBody ||
      (quotedMediaType === "audio"
        ? quotedMediaSeconds
          ? `[语音 ${quotedMediaSeconds}s]`
          : "[语音]"
        : quotedMediaType === "image"
          ? "[图片]"
          : quotedMediaType === "video"
            ? "[视频]"
            : quotedMediaType === "document"
              ? "[文件]"
              : "");
    return {
      id,
      body,
      fromMe: rawQuoted.fromMe === true,
      remoteJid: string(rawQuoted.remoteJid, 200) || undefined,
      participant: string(rawQuoted.participant, 200) || undefined,
      senderName: string(rawQuoted.senderName, 200) || undefined,
      mediaType: quotedMediaType,
      mediaSeconds: quotedMediaSeconds,
    };
  })();
  const rawContactCard = object(item.contactCard);
  const contactCard = rawContactCard
    ? {
        displayName: string(rawContactCard.displayName, 120),
        phoneE164: string(rawContactCard.phoneE164, 32),
        vcard: string(rawContactCard.vcard, 10_000) || undefined,
      }
    : undefined;
  const rawKey = object(item.waKey ?? item.key);
  let waKey: WaMessageKey | undefined;
  if (rawKey) {
    const kid = string(rawKey.id, 300);
    const remote = string(
      rawKey.remoteJid ?? rawKey.jid ?? item.jid ?? item.channelAddress,
      200
    );
    if (kid && remote) {
      waKey = {
        id: kid,
        remoteJid: remote,
        fromMe:
          typeof rawKey.fromMe === "boolean"
            ? rawKey.fromMe
            : direction === "out",
        participant: string(rawKey.participant, 200) || undefined,
      };
    }
  }

  return {
    isReaction: false,
    direction,
body,
    normBody,
    sentAt,
    sentTs,
    waId,
    localMessageId,
    mediaType: mediaType || undefined,
    mediaUrl: mediaUrl || undefined,
    mediaMime: mediaMime || undefined,
    mediaFileName: mediaFileName || undefined,
    mediaSeconds,
    mediaPtt: mediaPtt || undefined,
    mediaWaveform: mediaWaveform?.length ? mediaWaveform : undefined,
    mediaCaption: mediaCaption || undefined,
    mediaThumbUrl: mediaThumbUrl || undefined,
    mediaPending: mediaUrl ? false : mediaPending || undefined,
    contactCard:
      contactCard?.displayName || contactCard?.phoneE164
        ? contactCard
        : undefined,
    hasMediaHint,
    isGroup:
      Boolean(item.isGroup) ||
      Boolean(string(item.groupJid ?? item.jid, 200).endsWith("@g.us")),
    groupJid: string(item.groupJid ?? item.jid, 200) || undefined,
    senderJid: string(item.senderJid, 200) || undefined,
    senderPhoneE164: string(item.senderPhoneE164, 80) || undefined,
    senderName: (() => {
      const rawSenderName = string(item.senderName, 200) || undefined;
      return rawSenderName && !isOpaqueSenderName(rawSenderName)
        ? rawSenderName
        : undefined;
    })(),
    senderAvatarUrl:
      string(item.senderAvatarUrl ?? item.avatarUrl, 5_000_000) ||
      undefined,
    quoted,
    waKey,
    systemKind:
      typeof item.systemKind === "string" ? item.systemKind : undefined,
    systemAction:
      typeof item.systemAction === "string" ? item.systemAction : undefined,
    mentionedJids: Array.isArray(item.mentionedJids)
      ? (item.mentionedJids as unknown[])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      : undefined,
    mentionedMe: item.mentionedMe === true,
  };
}
