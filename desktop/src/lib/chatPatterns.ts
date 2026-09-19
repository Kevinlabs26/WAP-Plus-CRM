import type { CSSProperties } from "react";

/**
 * 内建聊天壁纸图案：全部由 SVG 代码生成，无版权、无外部资源、无网络依赖。
 * 每张图 = 底色 + 半透明压暗层（保证文字可读）+ 矢量花纹。
 */
export type ChatPatternId =
  | "dots"
  | "diagonal"
  | "crosshatch"
  | "waves"
  | "hexagons"
  | "polka"
  | "plus"
  | "zigzag";

interface ChatPatternDef {
  id: ChatPatternId;
  name: string;
  baseColor: string;
  svg: string;
}

function tile(w: number, h: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="rgba(8,8,12,0.22)"/>` +
    body +
    `</svg>`
  );
}

function dataUrl(svg: string): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export const CHAT_PATTERNS: ChatPatternDef[] = [
  {
    id: "dots",
    name: "点阵",
    baseColor: "#1a1c22",
    svg: tile(
      24,
      24,
      `<circle cx="12" cy="12" r="2.2" fill="#8a94a6" opacity="0.55"/>`
    ),
  },
  {
    id: "polka",
    name: "波点",
    baseColor: "#241d12",
    svg: tile(
      40,
      40,
      `<circle cx="12" cy="12" r="4.5" fill="#b08a4a" opacity="0.4"/>
       <circle cx="32" cy="32" r="6" fill="#b08a4a" opacity="0.32"/>
       <circle cx="12" cy="12" r="1.8" fill="#e6d3a8" opacity="0.5"/>`
    ),
  },
  {
    id: "diagonal",
    name: "斜纹",
    baseColor: "#101827",
    svg: tile(
      40,
      40,
      `<g transform="rotate(45 20 20)">
         <rect x="14" y="-10" width="4" height="60" fill="#5b86c4" opacity="0.28"/>
         <rect x="34" y="-10" width="4" height="60" fill="#5b86c4" opacity="0.28"/>
       </g>`
    ),
  },
  {
    id: "crosshatch",
    name: "格纹",
    baseColor: "#0f1f18",
    svg: tile(
      40,
      40,
      `<g transform="rotate(45 20 20)">
         <rect x="16" y="-10" width="3" height="60" fill="#4fbf8f" opacity="0.22"/>
         <rect x="36" y="-10" width="3" height="60" fill="#4fbf8f" opacity="0.22"/>
       </g>
       <g transform="rotate(-45 20 20)">
         <rect x="16" y="-10" width="3" height="60" fill="#4fbf8f" opacity="0.22"/>
         <rect x="36" y="-10" width="3" height="60" fill="#4fbf8f" opacity="0.22"/>
       </g>`
    ),
  },
  {
    id: "waves",
    name: "波浪",
    baseColor: "#0e1628",
    svg: tile(
      40,
      24,
      `<path d="M0 14 Q 10 6, 20 14 T 40 14" stroke="#4a6bbf" stroke-width="2.5" fill="none" opacity="0.45"/>
       <path d="M0 20 Q 10 12, 20 20 T 40 20" stroke="#4a6bbf" stroke-width="2" fill="none" opacity="0.3"/>`
    ),
  },
  {
    id: "hexagons",
    name: "六边",
    baseColor: "#22131c",
    svg: tile(
      44,
      44,
      `<polygon points="22,7 34,15 34,29 22,37 10,29 10,15" stroke="#c96a8f" stroke-width="2.5" fill="none" opacity="0.4"/>`
    ),
  },
  {
    id: "plus",
    name: "十字",
    baseColor: "#14202a",
    svg: tile(
      24,
      24,
      `<rect x="11" y="4" width="2" height="16" fill="#58b7d9" opacity="0.55"/>
       <rect x="4" y="11" width="16" height="2" fill="#58b7d9" opacity="0.55"/>`
    ),
  },
  {
    id: "zigzag",
    name: "锯齿",
    baseColor: "#161d14",
    svg: tile(
      40,
      20,
      `<path d="M0 16 L10 6 L20 16 L30 6 L40 16" stroke="#8fbf6a" stroke-width="3" fill="none" opacity="0.45"/>
       <path d="M0 14 L10 4 L20 14 L30 4 L40 14" stroke="#8fbf6a" stroke-width="3" fill="none" opacity="0.22"/>`
    ),
  },
];

export const PATTERN_LOOKUP: Record<ChatPatternId, ChatPatternDef> =
  Object.fromEntries(CHAT_PATTERNS.map((p) => [p.id, p])) as Record<
    ChatPatternId,
    ChatPatternDef
  >;

/** 由图案 id 生成可直接用于元素的背景样式（无则返回 undefined） */
export function buildPatternBackground(
  id: ChatPatternId | undefined
): CSSProperties | undefined {
  if (!id) return undefined;
  const def = PATTERN_LOOKUP[id];
  if (!def) return undefined;
  return {
    backgroundColor: def.baseColor,
    backgroundImage: dataUrl(def.svg),
    backgroundRepeat: "repeat",
  };
}