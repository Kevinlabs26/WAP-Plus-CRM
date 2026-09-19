import type { CSSProperties } from "react";
import type { AppSettings } from "@/store/appStore";
import {
  buildPatternBackground,
  type ChatPatternId,
} from "@/lib/chatPatterns";

/** 把聊天背景设置解析为可用的 CSS 样式（无则返回 undefined） */
export function resolveChatBackground(
  settings: Pick<AppSettings, "chatBackground">
): CSSProperties | undefined {
  const bg = settings.chatBackground;
  if (!bg || bg.kind === "none") return undefined;
  if (bg.kind === "image" && bg.imageUrl) {
    return {
      backgroundImage: `url("${bg.imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    };
  }
  if (bg.kind === "pattern") {
    return buildPatternBackground(bg.patternId as ChatPatternId);
  }
  if (bg.kind === "color" && bg.color) {
    return { backgroundColor: bg.color };
  }
  return undefined;
}