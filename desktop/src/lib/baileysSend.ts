import type {
  BaileysQuotePayload,
  BaileysSendResponse,
} from "@shared/baileysProtocol";
import type { WhatsAppProduct } from "@/types/crm";
import { request } from "./baileysCore";

export type QuotePayload = BaileysQuotePayload;

export const baileysCatalog = (accountId?: string | null) =>
  request<{ ok: boolean; products: WhatsAppProduct[] }>(
    "/catalog",
    undefined,
    accountId
  );

export const baileysSendProduct = (
  jid: string,
  productId: string,
  caption = "",
  accountId?: string | null
) =>
  request<BaileysSendResponse>("/catalog/send", {
    method: "POST",
    body: JSON.stringify({ jid, productId, caption }),
  }, accountId);

export const baileysSend = (
  phoneE164: string,
  text: string,
  opts?: {
    quoted?: QuotePayload;
    accountId?: string | null;
    mentionedJid?: string[];
  }
) =>
  request<BaileysSendResponse>(
    "/send",
    {
      method: "POST",
      body: JSON.stringify({
        phoneE164,
        text,
        quoted: opts?.quoted,
        mentionedJid: opts?.mentionedJid,
      }),
    },
    opts?.accountId
  );

export const baileysSendContact = (
  phoneE164: string,
  contact: { displayName: string; phoneE164: string },
  accountId?: string | null
) =>
  request<BaileysSendResponse>(
    "/send",
    {
      method: "POST",
      body: JSON.stringify({
        phoneE164,
        mediaType: "contact",
        contactName: contact.displayName,
        contactPhone: contact.phoneE164,
      }),
    },
    accountId
  );

/** 按协议 key 转发原始 WhatsApp 消息，保留媒体与转发标记。 */
export const baileysForwardMessage = (
  phoneE164: string,
  forwardKey: QuotePayload,
  accountId?: string | null
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ phoneE164, forwardKey }),
  }, accountId);

/** 发图片：imageDataUrl 为 data:image/...;base64,... ，caption 可选 */
export const baileysSendImage = (
  phoneE164: string,
  imageDataUrl: string,
  caption = "",
  opts?: { quoted?: QuotePayload; accountId?: string | null }
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      phoneE164,
      text: caption,
      imageDataUrl,
      mediaType: "image",
      quoted: opts?.quoted,
    }),
  }, opts?.accountId);

/** 发送已转换为 WebP 的静态贴纸。 */
export const baileysSendSticker = (
  phoneE164: string,
  stickerDataUrl: string,
  accountId?: string | null
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      phoneE164,
      stickerDataUrl,
      mediaType: "sticker",
    }),
  }, accountId);

/** GIF 会由 bridge 转成 WhatsApp 的 MP4 gifPlayback 消息。 */
export const baileysSendGif = (
  phoneE164: string,
  gifDataUrl: string,
  caption = "",
  accountId?: string | null
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      phoneE164,
      text: caption,
      gifDataUrl,
      mediaType: "gif",
    }),
  }, accountId);

/**
 * 发语音条（PTT）。audioDataUrl 可为 webm/ogg/wav 等 data:audio；
 * bridge 会尽量转成 OGG/Opus。seconds 为时长（秒）。
 */
export const baileysSendVoice = (
  phoneE164: string,
  audioDataUrl: string,
  opts?: {
    seconds?: number;
    mimetype?: string;
    ptt?: boolean;
    quoted?: QuotePayload;
    accountId?: string | null;
  }
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      phoneE164,
      audioDataUrl,
      mediaType: "ptt",
      ptt: opts?.ptt !== false,
      seconds: opts?.seconds,
      mimetype: opts?.mimetype,
      quoted: opts?.quoted,
    }),
  }, opts?.accountId);

/** 发文件/文档 */
export const baileysSendDocument = (
  phoneE164: string,
  fileDataUrl: string,
  fileName: string,
  opts?: {
    mimetype?: string;
    caption?: string;
    quoted?: QuotePayload;
    accountId?: string | null;
  }
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      phoneE164,
      fileDataUrl,
      fileName,
      mediaType: "document",
      mimetype: opts?.mimetype,
      text: opts?.caption || "",
      quoted: opts?.quoted,
    }),
  }, opts?.accountId);

/** 编辑已发文本（需协议 key） */
export const baileysMessageEdit = (
  key: {
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  },
  text: string,
  accountId?: string | null
) =>
  request<BaileysSendResponse>("/send", {
    method: "POST",
    body: JSON.stringify({
      edit: key,
      text,
      phoneE164: key.remoteJid,
    }),
  }, accountId);

/** composing | paused | available | unavailable；subscribe 仅订阅对方输入状态 */
export const baileysPresence = (
  type:
    | "composing"
    | "paused"
    | "available"
    | "unavailable"
    | "subscribe",
  target?: {
    jid?: string;
    phoneE164?: string;
    channelAddress?: string;
    /** 多个候选 jid（LID + PN），bridge 会全部 presenceSubscribe */
    jids?: string[];
    /** 打开会话时 true：presenceSubscribe，以便收到对方 composing */
    subscribe?: boolean;
    accountId?: string | null;
  }
) =>
  request<{
    ok: boolean;
    subscribed?: string[];
    jid?: string | null;
    errors?: string[];
  }>("/presence", {
    method: "POST",
    body: JSON.stringify({
      type,
      jid: target?.jid,
      phoneE164: target?.phoneE164,
      channelAddress: target?.channelAddress,
      jids: target?.jids,
      subscribe: target?.subscribe || type === "subscribe",
      subscribeOnly: type === "subscribe",
    }),
  }, target?.accountId);
