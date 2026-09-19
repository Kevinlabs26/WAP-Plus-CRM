import type { LayoutMode } from "../types";

export function multiWindowGridClass(layoutMode: LayoutMode, compact: boolean) {
  const gap = compact ? "gap-2" : "gap-3";
  const cardHeight = compact ? "[&>article:not([data-collapsed=true])]:h-[14rem]" : "[&>article:not([data-collapsed=true])]:h-[18rem]";
  switch (layoutMode) {
    case "one":
      return `grid min-h-0 grid-cols-1 ${gap} ${cardHeight}`;
    case "two":
      return `grid min-h-0 grid-cols-1 lg:grid-cols-2 ${gap} ${cardHeight}`;
    case "three":
      return `grid h-full min-h-0 grid-cols-1 xl:grid-cols-3 ${gap}`;
    default:
      return `grid h-full min-h-0 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 xl:grid-rows-3 ${gap}`;
  }
}
