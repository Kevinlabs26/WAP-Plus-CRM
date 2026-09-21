/**
 * 本地媒体缓存：把「大 data URL」按 messageId 存到 IndexedDB，
 * 落盘消息时仍剥掉 inline media，重启后从这里回填 mediaUrl。
 * 这样自发送的语音/图片/视频不依赖桥接内存，重开会话也在。
 */
import {
  idbGet,
  idbSet,
  idbDel,
  idbDelPrefix,
  idbEntriesPrefix,
  mediaCacheKey,
} from "./idb.ts";

const DATA_URL_RE = /^data:/i;
const MEDIA_PREFIX = "media:";
const MEDIA_INDEX_KEY = "media-cache-index-v1";
/** data URL 字符数约等于实际落盘字节量；总缓存控制在约 1 GB。 */
export const MEDIA_CACHE_MAX_CHARS = 1024 * 1024 * 1024;
/** 单项上限约 24 MB，避免一个超大视频挤掉全部聊天图片。 */
export const MEDIA_CACHE_MAX_ITEM_CHARS = 24 * 1024 * 1024;

export type MediaCacheIndex = Record<
  string,
  { chars: number; cachedAt: number }
>;

export type MediaCacheStats = {
  items: number;
  chars: number;
  limitChars: number;
};

let mediaMutation = Promise.resolve();

/** 等待已排队的媒体缓存写入完成，再提交消息游标/快照。 */
export function waitForMediaCacheWrites(): Promise<void> {
  return mediaMutation;
}

function runMediaMutation(task: () => Promise<void>): Promise<void> {
  const next = mediaMutation.then(task, task);
  mediaMutation = next.catch(() => undefined);
  return next;
}

/** 超限时按最旧缓存优先清理；纯函数便于验证容量策略。 */
export function selectMediaCacheEvictions(
  index: MediaCacheIndex,
  maxChars = MEDIA_CACHE_MAX_CHARS
): string[] {
  let total = Object.values(index).reduce(
    (sum, entry) => sum + Math.max(0, entry.chars || 0),
    0
  );
  if (total <= maxChars) return [];
  const evictions: string[] = [];
  for (const [id, entry] of Object.entries(index).sort(
    (a, b) => a[1].cachedAt - b[1].cachedAt
  )) {
    evictions.push(id);
    total -= Math.max(0, entry.chars || 0);
    if (total <= maxChars) break;
  }
  return evictions;
}

async function loadMediaIndex(): Promise<MediaCacheIndex> {
  const saved = await idbGet<MediaCacheIndex>(MEDIA_INDEX_KEY);
  if (saved) return saved;

  // 兼容旧版本：首次维护时为现有媒体补一份轻量索引。
  const existing = await idbEntriesPrefix<string>(MEDIA_PREFIX);
  const now = Date.now();
  const index: MediaCacheIndex = {};
  for (const [key, value] of existing) {
    if (typeof value !== "string") continue;
    index[key.slice(MEDIA_PREFIX.length)] = {
      chars: value.length,
      cachedAt: now,
    };
  }
  return index;
}

export async function getMediaCacheStats(): Promise<MediaCacheStats> {
  try {
    const index = await loadMediaIndex();
    return {
      items: Object.keys(index).length,
      chars: Object.values(index).reduce(
        (sum, entry) => sum + Math.max(0, entry.chars || 0),
        0
      ),
      limitChars: MEDIA_CACHE_MAX_CHARS,
    };
  } catch {
    return { items: 0, chars: 0, limitChars: MEDIA_CACHE_MAX_CHARS };
  }
}

/** bridge 的原始消息 id 转成前端实际保存的消息 id。 */
export function bridgeMessageMediaCacheId(
  messageId: string,
  deviceId: string
): string {
  if (!messageId || !deviceId) return messageId;
  const prefix = `bridge-msg-${encodeURIComponent(deviceId)}-`;
  return messageId.startsWith(prefix)
    ? messageId
    : `${prefix}${encodeURIComponent(messageId)}`;
}

export function isDataUrl(url: string | undefined | null): url is string {
  return !!url && DATA_URL_RE.test(url);
}

/** 大 data URL 落盘前转存 IDB，返回要保留的（小 URL 或 undefined） */
export async function cacheMediaUrl(
  messageId: string,
  url: string | undefined | null
): Promise<void> {
  if (!messageId || !isDataUrl(url)) return;
  if (url.length > MEDIA_CACHE_MAX_ITEM_CHARS) return;
  try {
    await runMediaMutation(async () => {
      const index = await loadMediaIndex();
      await idbSet(mediaCacheKey(messageId), url);
      index[messageId] = { chars: url.length, cachedAt: Date.now() };
      for (const id of selectMediaCacheEvictions(index)) {
        await idbDel(mediaCacheKey(id));
        delete index[id];
      }
      await idbSet(MEDIA_INDEX_KEY, index);
    });
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
    await runMediaMutation(async () => {
      await idbDel(mediaCacheKey(messageId));
      const index = await loadMediaIndex();
      if (index[messageId]) {
        delete index[messageId];
        await idbSet(MEDIA_INDEX_KEY, index);
      }
    });
  } catch {
    /* ignore */
  }
}

export async function clearMediaCache(): Promise<number> {
  try {
    let removed = 0;
    await runMediaMutation(async () => {
      removed = await idbDelPrefix(MEDIA_PREFIX);
      await idbDel(MEDIA_INDEX_KEY);
    });
    return removed;
  } catch {
    return 0;
  }
}
