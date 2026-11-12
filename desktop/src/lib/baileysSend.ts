import type {
  BaileysQuotePayload,
  BaileysSendResponse,
} from "@shared/baileysProtocol";
import type { WhatsAppProduct } from "@/types/crm";
import { baileysStatus, request } from "./baileysCore";
import { dataUrlToBlob } from "./mediaBlob";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const VIDEO_STREAM_THRESHOLD_CHARS = 24 * 1024 * 1024;

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
      signal: AbortSignal.timeout(30_000),
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

/** 发送 WebP 贴纸；原有动画帧会保留。 */
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

/** Older bridges can silently treat an unknown video payload as plain text. */
export const baileysSendVideo = async (phoneE164: string, videoDataUrl: string | Blob, caption = "", accountId?: string | null, canSend?: () => boolean, onUploadProgress?: (loaded: number, total: number) => void) => {
  let status;
  try { status = await baileysStatus(accountId); }
  catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { deliveryUncertain: false }); }
  if (status.connection !== "connected") throw Object.assign(new Error("WhatsApp 尚未连接"), { code: "baileys_not_connected", deliveryUncertain: false });
  if (status.capabilities?.nativeVideo !== true) throw Object.assign(new Error("当前桥接不支持原生视频，请更新桥接或改用文件发送"), { code: "native_video_unsupported", deliveryUncertain: false });
  if (videoDataUrl instanceof Blob || videoDataUrl.startsWith("blob:") || videoDataUrl.startsWith("data:video/mp4;") && videoDataUrl.length > VIDEO_STREAM_THRESHOLD_CHARS) {
    if (!status.capabilities?.nativeVideoStream) throw Object.assign(new Error("请重启对应账号连接，以加载大视频上传支持"), {deliveryUncertain:false});
    const video = videoDataUrl instanceof Blob ? videoDataUrl : videoDataUrl.startsWith("data:")
      ? dataUrlToBlob(videoDataUrl, "video/mp4", MAX_VIDEO_BYTES)
      : await fetch(videoDataUrl).then(response => response.blob());
    if (!video.size || video.size > MAX_VIDEO_BYTES) throw Object.assign(new Error("视频为空或超过 100 MB"), {deliveryUncertain:false});
    const header = new TextEncoder().encode(JSON.stringify({phoneE164, caption, size:video.size}));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, header.length);
    if (canSend && !canSend()) throw Object.assign(new Error("发送任务已暂停或取消"), {deliveryUncertain:false});
    return request<BaileysSendResponse>("/send/video", {
      method:"POST", signal:AbortSignal.timeout(900_000),
      headers:{"Content-Type":"application/octet-stream"}, body:new Blob([length, header, video]),
    }, accountId, onUploadProgress);
  }
  if (canSend && !canSend()) throw Object.assign(new Error("发送任务已暂停、取消或超出发送时间"), { code: "automation_cancelled", deliveryUncertain: false });
  return request<BaileysSendResponse>("/send", { method: "POST", signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({phoneE164,videoDataUrl,text:caption,mediaType:"video"}) }, accountId);
};

/** 发文件/文档 */
export const baileysSendDocument = async (
  phoneE164: string,
  fileDataUrl: string | Blob,
  fileName: string,
  opts?: {
    mimetype?: string;
    caption?: string;
    quoted?: QuotePayload;
    accountId?: string | null;
    canSend?: () => boolean;
    onUploadProgress?: (loaded:number,total:number)=>void;
  }
) => {
  if(fileDataUrl instanceof Blob||fileDataUrl.startsWith('blob:')){
    let status;
    try {status=await baileysStatus(opts?.accountId);}catch(error){throw Object.assign(error instanceof Error?error:new Error(String(error)),{deliveryUncertain:false});}
    if(status.connection!=='connected'||!status.capabilities?.documentStream)throw Object.assign(new Error('请重启对应账号连接，以加载大文件发送支持'),{deliveryUncertain:false});
    const blob=fileDataUrl instanceof Blob?fileDataUrl:await fetch(fileDataUrl).then(r=>{if(!r.ok)throw Error('本地文件缓存已不可用，请重新选择文件');return r.blob();});
    if(!blob.size||blob.size>100*1024*1024)throw Object.assign(new Error('文件为空或超过 100 MiB'),{deliveryUncertain:false});
    if(opts?.quoted)throw Object.assign(new Error('大文件暂不支持引用发送，请取消引用后重试'),{deliveryUncertain:false});
    const metadata=new TextEncoder().encode(JSON.stringify({phoneE164,caption:opts?.caption||'',fileName,mimetype:opts?.mimetype||blob.type||'application/octet-stream',size:blob.size}));
    const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,metadata.length);
    if(opts?.canSend&&!opts.canSend())throw Object.assign(new Error('发送已取消'),{deliveryUncertain:false});
    return request<BaileysSendResponse>('/send/document',{method:'POST',signal:AbortSignal.timeout(900_000),headers:{'Content-Type':'application/octet-stream'},body:new Blob([length,metadata,blob])},opts?.accountId,opts?.onUploadProgress);
  }
  return request<BaileysSendResponse>("/send", {
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
};

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
