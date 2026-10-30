import type { LayoutMode } from "../types";

export function multiWindowGridClass(layoutMode: LayoutMode, compact: boolean) {
  const gap = compact ? "gap-2" : "gap-3";
  const cardHeight = compact ? "[&>article:not([data-collapsed=true])]:h-[20rem]" : "[&>article:not([data-collapsed=true])]:h-[26rem]";
  const columns = layoutMode === "one" ? "grid-cols-1"
    : layoutMode === "two" ? "grid-cols-1 lg:grid-cols-2"
    : layoutMode === "three" ? "grid-cols-1 xl:grid-cols-3"
    : "grid-cols-[repeat(auto-fit,minmax(min(100%,max(24rem,calc((100%_-_1.5rem)/3))),1fr))]";
  return `grid min-h-0 content-start ${columns} ${gap} ${cardHeight}`;
}
