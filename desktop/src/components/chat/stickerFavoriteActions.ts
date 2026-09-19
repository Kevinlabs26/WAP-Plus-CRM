import { saveStickerFavorites } from "@/lib/stickerFavorites";
import type { AppState } from "@/store/appStore";

type StickerFavoriteActionsDeps = {
  favoriteStickers: string[];
  setFavoriteStickers: (items: string[]) => void;
  toStickerDataUrl: (file: File) => Promise<string>;
  pushToast: AppState["pushToast"];
};

export function createStickerFavoriteActions({
  favoriteStickers,
  setFavoriteStickers,
  toStickerDataUrl,
  pushToast,
}: StickerFavoriteActionsDeps) {
  const store = (items: string[]) => {
    void saveStickerFavorites(items)
      .then(setFavoriteStickers)
      .catch(() => pushToast("保存贴纸收藏失败", "error"));
  };

  return {
    toggle: async (source: string) => {
      const dataUrl = source.startsWith("data:image/webp;base64,")
        ? source
        : await toStickerDataUrl(
            new File([await (await fetch(source)).blob()], "favorite.webp", {
              type: "image/webp",
            })
          );
      const exists = favoriteStickers.includes(dataUrl);
      store(
        exists
          ? favoriteStickers.filter((item) => item !== dataUrl)
          : [dataUrl, ...favoriteStickers]
      );
      pushToast(exists ? "已取消收藏贴纸" : "已收藏贴纸", "success");
    },
    remove: (dataUrl: string) => {
      store(favoriteStickers.filter((item) => item !== dataUrl));
    },
  };
}
