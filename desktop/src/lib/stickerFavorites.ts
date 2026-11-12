import { idbGet, idbSet } from "./idb.ts";

const KEY = "favorite_stickers_v1";

export function normalizeStickerFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" &&
          item.startsWith("data:image/webp;base64,") &&
          item.length < 3_000_000
      )
    )
  ).slice(0, 24);
}

/** 收集本机已同步消息中的贴纸；官方贴纸包本身不会出现在消息数据里。 */
export function mergeStickerFavoritesFromMessages(
  current: string[],
  messages: readonly { mediaType?: string; mediaUrl?: string }[],
): string[] {
  const discovered: string[] = [];
  const seen = new Set(current);
  for (let index = messages.length - 1; index >= 0 && discovered.length < 24; index--) {
    const message = messages[index];
    const sticker = message?.mediaType === "sticker" ? message.mediaUrl : undefined;
    if (!sticker?.startsWith("data:image/webp;base64,") || seen.has(sticker)) continue;
    seen.add(sticker);
    discovered.push(sticker);
  }
  return normalizeStickerFavorites([...current, ...discovered]);
}

export async function loadStickerFavorites(): Promise<string[]> {
  return normalizeStickerFavorites(await idbGet<unknown>(KEY));
}

export async function saveStickerFavorites(items: string[]): Promise<string[]> {
  const next = normalizeStickerFavorites(items);
  await idbSet(KEY, next);
  return next;
}
