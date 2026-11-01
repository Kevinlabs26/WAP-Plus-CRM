import type { LayoutMode } from "../types";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, MoreHorizontal, RotateCcw } from "lucide-react";
import { useI18n, type TranslationKey } from "@/i18n";

const layoutOptions: Array<[LayoutMode, TranslationKey]> = [
  ["auto", "multi.layoutAuto"],
  ["one", "multi.layoutOne"],
  ["two", "multi.layoutTwo"],
  ["three", "multi.layoutThree"],
];

export function MultiWindowLayoutControls({
  layoutMode,
  compact,
  onLayoutChange,
  onCompactChange,
  allVisibleCollapsed,
  onToggleVisibleCollapsed,
  onResetLayout,
}: {
  layoutMode: LayoutMode;
  compact: boolean;
  onLayoutChange: (mode: LayoutMode) => void;
  onCompactChange: (compact: boolean) => void;
  allVisibleCollapsed: boolean;
  onToggleVisibleCollapsed: () => void;
  onResetLayout: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5" aria-label={t("multi.layout")}>
      <select
        value={layoutMode}
        onChange={(event) => onLayoutChange(event.target.value as LayoutMode)}
        className={cn(
          "h-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-2 pr-6 text-2xs text-zinc-500 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-300",
          "bg-zinc-700/80 text-zinc-100"
        )}
        aria-label={t("multi.layout")}
        title={t("multi.layout")}
      >
        {layoutOptions.map(([mode, labelKey]) => (
          <option key={mode} value={mode}>
            {t(labelKey)}
          </option>
        ))}
      </select>
      <details className="relative" onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }} onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary aria-label={t("multi.layoutOptions")} title={t("multi.layoutOptions")} className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 [&::-webkit-details-marker]:hidden">
          <MoreHorizontal className="h-4 w-4" />
        </summary>
        <div className="absolute right-0 top-full z-50 mt-1 flex min-w-40 flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          <button
            type="button"
            onClick={() => onCompactChange(!compact)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-2xs transition-colors",
              compact ? "bg-brand/15 text-brand" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            )}
            aria-pressed={compact}
            aria-label={t("multi.compact")}
            title={t("multi.compactTitle")}
          >
            {t("multi.compact")}
          </button>
          <button
            type="button"
            onClick={onToggleVisibleCollapsed}
            aria-label={allVisibleCollapsed ? t("multi.expandPage") : t("multi.collapsePage")}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-2xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title={allVisibleCollapsed ? t("multi.expandPageTitle") : t("multi.collapsePageTitle")}
          >
            {allVisibleCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            {allVisibleCollapsed ? t("multi.expandPage") : t("multi.collapsePage")}
          </button>
          <button
            type="button"
            onClick={onResetLayout}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-2xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title={t("multi.resetLayoutTitle")}
            aria-label={t("multi.resetLayout")}
          >
            <RotateCcw className="h-3 w-3" />
            {t("multi.resetLayout")}
          </button>
        </div>
      </details>
    </div>
  );
}
