import type { Message } from "@/types/crm";

const AUTO_LOAD_MEDIA_TYPES = new Set(["image", "sticker", "audio"]);
export const QUIET_MEDIA_RETRY_DELAYS_MS = [800, 2400] as const;

export type MediaPlaceholderState = "loading" | "retry" | "failed";

export function mediaPlaceholderState(
  message: Pick<Message, "mediaUrl" | "mediaError" | "mediaPending">,
  busy: boolean
): MediaPlaceholderState {
  if (busy || (!message.mediaUrl && !message.mediaError && message.mediaPending)) {
    return "loading";
  }
  return !message.mediaUrl && message.mediaError ? "failed" : "retry";
}

export function shouldAutoLoadMessageMedia(
  message: Pick<Message, "mediaType" | "mediaPending" | "mediaUrl">
): boolean {
  const mediaType = (message.mediaType || "").toLowerCase();
  return (
    !message.mediaUrl &&
    AUTO_LOAD_MEDIA_TYPES.has(mediaType) &&
    (message.mediaPending === true || mediaType === "audio")
  );
}

export function shouldRetryMediaAfterSync(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

export function shouldShowBodyText(m: Message): boolean {
  const t = (m.mediaType || "").toLowerCase();
  const body = (m.body || "").trim();
  // 旧数据笼统 [消息]：有媒体组件时正文可藏
  if (!t) {
    if (body === "[消息]") return false;
    return true;
  }
  // 纯媒体占位文案在有预览时不重复显示
  if (t === "image" || t === "sticker") {
    if (m.mediaUrl)
      return Boolean(
        m.mediaCaption ||
          (body && !/^\[图片\]$|^\[贴纸\]$|^\[消息\]$/.test(body))
      );
    return body !== "[消息]";
  }
  if (t === "audio") {
    return Boolean(body && !/^\[(语音|音频)/.test(body) && body !== "[消息]");
  }
  if (t === "video") {
    // 有视频文件或缩略图封面时，隐藏 [视频 Ns] 占位，避免双层文字+边框
    if (m.mediaUrl || m.mediaThumbUrl)
      return Boolean(
        m.mediaCaption || (body && !/^\[视频/.test(body) && body !== "[消息]")
      );
    // 纯未缓存无封面：仍可留一行短提示，但 VideoTile 已自带 UI，正文占位可藏
    if (/^\[视频/.test(body) || body === "[消息]") return false;
    return Boolean(body);
  }
  if (t === "gif") {
    return Boolean(body && body !== "[GIF]" && body !== "[消息]");
  }
  if (t === "document") {
    // 有文件气泡时，隐藏「[文件] xxx」占位，只保留真正 caption
    if (m.mediaFileName || m.mediaUrl) {
      return Boolean(
        m.mediaCaption ||
          (body &&
            !/^\[(文件|文档)\]/.test(body) &&
            body !== m.mediaFileName &&
            body !== "[消息]")
      );
    }
    return body !== "[消息]";
  }
  if (t === "contact") return !m.contactCard && Boolean(body);
  return body !== "[消息]" || !t;
}

/** 无 mediaType 的历史占位，尽量猜一种展示 */
export function inferMediaType(m: Message): string {
  const t = (m.mediaType || "").toLowerCase();
  if (t) return t;
  const b = (m.body || "").trim();
  if (b === "[图片]" || b.startsWith("[图片]")) return "image";
  if (b === "[贴纸]") return "sticker";
  if (b.startsWith("[语音") || b.startsWith("[音频")) return "audio";
  if (b.startsWith("[视频")) return "video";
  if (b === "[GIF]") return "gif";
  if (b.startsWith("[文件]") || b.startsWith("[文档]")) return "document";
  if (b.startsWith("[名片]")) return "contact";
  if (b === "[消息]") return "unknown";
  return "";
}

export function documentDisplayName(m: Message): string {
  if (m.mediaFileName?.trim()) return m.mediaFileName.trim();
  const body = (m.body || "").trim();
  if (!body) return "文件";
  if (/^\[(文件|文档)\]/.test(body)) {
    return body.replace(/^\[(文件|文档)\]\s*/, "") || "文件";
  }
  return body;
}

export function documentExtLabel(name: string, mime?: string): string {
  const fromName = name.includes(".")
    ? name.split(".").pop()?.toLowerCase()
    : "";
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) {
    return fromName.toUpperCase();
  }
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return "PDF";
  if (m.includes("ogg") || m.includes("opus")) return "OGG";
  if (m.includes("mpeg") || m.includes("mp3")) return "MP3";
  if (m.includes("zip")) return "ZIP";
  if (m.includes("word") || m.includes("msword")) return "DOC";
  if (m.includes("sheet") || m.includes("excel")) return "XLS";
  if (m.includes("png")) return "PNG";
  if (m.includes("jpeg") || m.includes("jpg")) return "JPG";
  if (m.startsWith("audio/")) return "AUDIO";
  if (m.startsWith("video/")) return "VIDEO";
  if (m.startsWith("image/")) return "IMG";
  return "FILE";
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.max(1, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 从 data: URL 粗算体积（base64） */
export function estimateDataUrlBytes(url?: string): number | undefined {
  if (!url?.startsWith("data:")) return undefined;
  const comma = url.indexOf(",");
  if (comma < 0) return undefined;
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  if (!data) return 0;
  if (meta.includes(";base64")) {
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
  }
  try {
    return decodeURIComponent(data).length;
  } catch {
    return data.length;
  }
}

export function triggerMediaDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "file";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyImageToClipboard(url: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前环境不支持复制图片");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("图片读取失败");
  const source = await response.blob();
  let image = source;
  if (source.type !== "image/png") {
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    image = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片转换失败"))), "image/png")
    );
  }
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": image }),
  ]);
}

export async function openMediaInNewTab(url: string, mime?: string) {
  // http(s) 直接开；data/blob 优先 blob 新标签，避免超大 data URL 卡死
  if (url.startsWith("http://") || url.startsWith("https://")) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (url.startsWith("blob:")) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    const blob = await res.blob();
    const typed =
      mime && !blob.type
        ? new Blob([blob], { type: mime })
        : blob;
    const obj = URL.createObjectURL(typed);
    window.open(obj, "_blank", "noopener,noreferrer");
    // 延迟 revoke，给浏览器打开时间
    window.setTimeout(() => URL.revokeObjectURL(obj), 60_000);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
