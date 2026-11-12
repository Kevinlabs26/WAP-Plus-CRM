import assert from "node:assert/strict";
import { mergeStickerFavoritesFromMessages, normalizeStickerFavorites } from "../src/lib/stickerFavorites.ts";

const sticker = (n) => `data:image/webp;base64,${String(n).padStart(2, "0")}`;
assert.deepEqual(
  normalizeStickerFavorites([sticker(1), "bad", sticker(1), sticker(2)]),
  [sticker(1), sticker(2)]
);
assert.equal(
  normalizeStickerFavorites(Array.from({ length: 30 }, (_, i) => sticker(i))).length,
  24
);
assert.deepEqual(
  mergeStickerFavoritesFromMessages([sticker(1)], [
    { mediaType: "sticker", mediaUrl: sticker(2) },
    { mediaType: "image", mediaUrl: sticker(3) },
    { mediaType: "sticker", mediaUrl: sticker(1) },
  ]),
  [sticker(1), sticker(2)]
);

console.log("sticker-favorites.test.mjs ok");
