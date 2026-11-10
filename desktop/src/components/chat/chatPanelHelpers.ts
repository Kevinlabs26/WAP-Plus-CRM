import { useCallback, useRef } from "react";
import type { Message } from "@/types/crm";

/** 跟进时间：ISO → 可读「2026-08-02 13:39」 */
export function formatFollowDueLabel(raw?: string) {
  if (!raw) return "";
  const s = raw.trim();
  try {
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${mo}-${day} ${hh}:${mm}`;
    }
  } catch {
    /* fallthrough */
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const [date, time] = s.split("T");
    return `${date} ${(time || "").slice(0, 5)}`;
  }
  return s.replace(/Z$/i, "").replace("T", " ").slice(0, 16);
}

export function messagePlainText(m: Message) {
  const type = (m.mediaType || "").toLowerCase();
  if (type === "image") return m.mediaCaption || m.body || "[图片]";
  if (type === "audio") return m.body || "[语音]";
  if (type === "video") return m.body || "[视频]";
  if (type === "gif") return m.mediaCaption || m.body || "[GIF]";
  if (type === "document") return m.mediaFileName || m.body || "[文件]";
  return m.body || "";
}

export async function imageToStickerDataUrl(file: File): Promise<string> {
  if (file.type === "image/webp") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isAnimatedWebp(bytes)) {
      if (bytes.length > 2_000_000) throw new Error("动态贴纸超过 2 MB，暂不支持发送");
      return webpDataUrl(bytes);
    }
  }

  const image = await createImageBitmap(file);
  try {
    if (!image.width || !image.height) throw new Error("无法读取贴纸图片");
    const size = 512;
    const scale = Math.min(size / image.width, size / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法制作贴纸");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      Math.round((size - width) / 2),
      Math.round((size - height) / 2),
      width,
      height
    );
    const dataUrl = canvas.toDataURL("image/webp", 0.86);
    if (!dataUrl.startsWith("data:image/webp;base64,")) {
      throw new Error("当前环境不支持 WebP 贴纸");
    }
    return dataUrl;
  } finally {
    image.close();
  }
}

function isAnimatedWebp(bytes: Uint8Array) {
  if (
    bytes.length < 20 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length || riffEnd < 20) return false;
  let hasAnimation = false;
  let hasFrame = false;
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size;
    if (end > riffEnd) return false;
    if (kind === "ANIM") hasAnimation = true;
    if (kind === "ANMF") hasFrame = true;
    offset = end + (size & 1);
  }
  return hasAnimation && hasFrame;
}

function webpDataUrl(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

export function useEventCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  );
}
