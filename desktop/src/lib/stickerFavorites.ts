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

export async function loadStickerFavorites(): Promise<string[]> {
  return normalizeStickerFavorites(await idbGet<unknown>(KEY));
}

export async function saveStickerFavorites(items: string[]): Promise<string[]> {
  const next = normalizeStickerFavorites(items);
  await idbSet(KEY, next);
  return next;
}
