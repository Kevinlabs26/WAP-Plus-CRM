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

export function useEventCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  );
}
