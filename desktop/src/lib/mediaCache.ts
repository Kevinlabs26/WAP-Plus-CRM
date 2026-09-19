/**
 * 本地媒体缓存：把「大 data URL」按 messageId 存到 IndexedDB，
 * 落盘消息时仍剥掉 inline media，重启后从这里回填 mediaUrl。
 * 这样自发送的语音/图片/视频不依赖桥接内存，重开会话也在。
 */
import { idbGet, idbSet, idbDel, idbDelPrefix, mediaCacheKey } from "./idb.ts";

const DATA_URL_RE = /^data:/i;

export function isDataUrl(url: string | undefined | null): boolean {
  return !!url && DATA_URL_RE.test(url);
}

/** 大 data URL 落盘前转存 IDB，返回要保留的（小 URL 或 undefined） */
export async function cacheMediaUrl(
  messageId: string,
  url: string | undefined | null
): Promise<void> {
  if (!messageId || !isDataUrl(url)) return;
  try {
    await idbSet(mediaCacheKey(messageId), url);
  } catch {
    /* 缓存失败不阻塞发送 */
  }
}

/** 从 IDB 回填：有则返回缓存的 data URL */
export async function readMediaCache(
  messageId: string
): Promise<string | undefined> {
  if (!messageId) return undefined;
  try {
    return (await idbGet<string>(mediaCacheKey(messageId))) || undefined;
  } catch {
    return undefined;
  }
}

/** 清理缓存（删消息时调用） */
export async function dropMediaCache(messageId: string): Promise<void> {
  try {
    await idbDel(mediaCacheKey(messageId));
  } catch {
    /* ignore */
  }
}

export async function clearMediaCache(): Promise<number> {
  try {
    return await idbDelPrefix("media:");
  } catch {
    return 0;
  }
}
