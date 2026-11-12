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
import { VIDEO_DATA_URL_MAX_CHARS } from "./mediaBlob.ts";

const DATA_URL_RE = /^data:/i;
const MEDIA_PREFIX = "media:";
const MEDIA_INDEX_KEY = "media-cache-index-v1";
/** data URL 字符数约等于实际落盘字节量；总缓存控制在约 1 GB。 */
export const MEDIA_CACHE_MAX_CHARS = 1024 * 1024 * 1024;
/** 普通附件单项上限；视频另限 100 MB，仍共用总缓存预算。 */
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
const blobUrls = new Map<string, string>();
function releaseBlobUrl(id: string) {
  const url = blobUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  blobUrls.delete(id);
}

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
    if (id.startsWith("saved-")) continue;
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
  const existing = await idbEntriesPrefix<string | Blob>(MEDIA_PREFIX);
  const now = Date.now();
  const index: MediaCacheIndex = {};
  for (const [key, value] of existing) {
    if (typeof value !== "string" && !(value instanceof Blob)) continue;
    index[key.slice(MEDIA_PREFIX.length)] = {
      chars: typeof value === "string" ? value.length : value.size,
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

/** Batch bridge history media so one ingest batch updates the index once. */
export function cacheMediaUrls(
  entries: readonly { messageId: string; url: string }[]
): Promise<void> {
  const unique = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.messageId || !isDataUrl(entry.url)) continue;
    const max = entry.url.startsWith("data:video/")
      ? VIDEO_DATA_URL_MAX_CHARS
      : MEDIA_CACHE_MAX_ITEM_CHARS;
    if (entry.url.length <= max) unique.set(entry.messageId, entry.url);
  }
  if (!unique.size) return Promise.resolve();
  return runMediaMutation(async () => {
    try {
      const index = await loadMediaIndex();
      const now = Date.now();
      const puts = [...unique].map(([messageId, url]) => {
        index[messageId] = { chars: url.length, cachedAt: now };
        return { key: mediaCacheKey(messageId), value: url };
      });
      const evicted = selectMediaCacheEvictions(index);
      for (const id of evicted) delete index[id];
      await idbSet(MEDIA_INDEX_KEY, index, [
        ...puts,
        ...evicted.map((id) => ({ key: mediaCacheKey(id), remove: true })),
      ]);
      unique.forEach((_url, id) => releaseBlobUrl(id));
      evicted.forEach(releaseBlobUrl);
    } catch {
      /* bridge media caching is best-effort and must not delay message ingest */
    }
  });
}

/** 大 data URL 落盘前转存 IDB，返回要保留的（小 URL 或 undefined） */
export async function cacheMediaUrl(
  messageId: string,
  url: string | undefined | null,
  strict = false
): Promise<void> {
  if (!messageId || !isDataUrl(url)) return;
  if (url.length > (url.startsWith("data:video/") ? VIDEO_DATA_URL_MAX_CHARS : MEDIA_CACHE_MAX_ITEM_CHARS)) {
    if (strict) throw new Error("附件超过本地保存上限");
    return;
  }
  try {
    await runMediaMutation(async () => {
      const index = await loadMediaIndex();
      if (strict) {
        const total = Object.entries(index).reduce((sum, [id, entry]) => sum +
          (!messageId.startsWith("saved-") || id.startsWith("saved-") ? Math.max(0, entry.chars || 0) : 0), 0);
        if (total - (index[messageId]?.chars || 0) + url.length > MEDIA_CACHE_MAX_CHARS) {
          throw new Error("附件缓存空间不足，已停止保存，请先导出并清理不用的附件");
        }
      }
      index[messageId] = { chars: url.length, cachedAt: Date.now() };
      const evicted = selectMediaCacheEvictions(index);
      for (const id of evicted) delete index[id];
      await idbSet(MEDIA_INDEX_KEY, index, [
        {key: mediaCacheKey(messageId), value: url},
        ...evicted.map(id => ({key: mediaCacheKey(id), remove: true})),
      ]);
      releaseBlobUrl(messageId);
      evicted.forEach(releaseBlobUrl);
    });
  } catch (error) {
    if (strict) throw error;
    /* 缓存失败不阻塞发送 */
  }
}

/** Raw attachment cache shares the existing total budget without a Base64 copy. */
export async function cacheMediaBlob(messageId: string, blob: Blob): Promise<string> {
  if (!messageId || !blob.size || blob.size > 100 * 1024 * 1024) throw new Error("附件为空或超过 100 MiB");
  await runMediaMutation(async () => {
    const index = await loadMediaIndex();
    const savedBytes = Object.entries(index).reduce((sum, [id, entry]) => sum + (id.startsWith("saved-") && id !== messageId ? entry.chars : 0), 0);
    if (savedBytes + blob.size > MEDIA_CACHE_MAX_CHARS) throw new Error("本地附件缓存空间不足，请先清理不用的附件");
    index[messageId] = {chars:blob.size, cachedAt:Date.now()};
    const evicted = selectMediaCacheEvictions(index);
    for (const id of evicted) delete index[id];
    await idbSet(MEDIA_INDEX_KEY, index, [{key:mediaCacheKey(messageId), value:blob}, ...evicted.map(id => ({key:mediaCacheKey(id), remove:true}))]);
    releaseBlobUrl(messageId);
    evicted.forEach(releaseBlobUrl);
  });
  const url = URL.createObjectURL(blob);
  blobUrls.set(messageId, url);
  return url;
}

/** 从 IDB 回填：有则返回缓存的 data URL */
export async function readMediaCache(
  messageId: string,
  strict = false
): Promise<string | undefined> {
  if (!messageId) return undefined;
  try {
    if (blobUrls.has(messageId)) return blobUrls.get(messageId);
    const value = await idbGet<string | Blob>(mediaCacheKey(messageId), strict);
    if (!(value instanceof Blob)) return value || undefined;
    const url = URL.createObjectURL(value);
    blobUrls.set(messageId, url);
    return url;
  } catch (error) {
    if (strict) throw error;
    return undefined;
  }
}

/** 清理缓存（删消息时调用） */
export async function dropMediaCache(messageId: string): Promise<void> {
  releaseBlobUrl(messageId);
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

export async function clearMediaCache(includeSaved = false): Promise<number> {
  try {
    let removed = 0;
    await runMediaMutation(async () => {
      if (includeSaved) {
        removed = await idbDelPrefix(MEDIA_PREFIX);
        await idbDel(MEDIA_INDEX_KEY);
        for (const id of blobUrls.keys()) releaseBlobUrl(id);
        return;
      }
      const index = await loadMediaIndex();
      for (const id of Object.keys(index)) {
        if (id.startsWith("saved-")) continue;
        await idbDel(mediaCacheKey(id));
        releaseBlobUrl(id);
        delete index[id];
        removed++;
      }
      await idbSet(MEDIA_INDEX_KEY, index);
    });
    return removed;
  } catch {
    return 0;
  }
}
