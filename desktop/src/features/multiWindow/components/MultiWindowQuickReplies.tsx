import { Search, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import {
  filterQuickReplies,
  getQuickReplyCategories,
  QUICK_REPLY_CATEGORIES,
  type QuickReplyCategoryFilter,
} from "@/lib/quickReplies";
import { useI18n, type TranslationKey } from "@/i18n";
import { emitQuickReplyMedia } from "@/lib/quickReplyMedia";

export function MultiWindowQuickReplies({
  onPick,
  onClose,
  variant = "popover",
  title,
}: {
  onPick: (text: string) => void;
  onClose?: () => void;
  variant?: "popover" | "panel";
  title?: string;
}) {
  const { t } = useI18n();
  const quickReplies = useAppStore((state) => state.settings.quickReplies || []);
  const customCategories = useAppStore(
    (state) => state.settings.quickReplyCustomCategories || []
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<QuickReplyCategoryFilter>("all");

  const availableCategories = useMemo(
    () =>
      getQuickReplyCategories(customCategories).filter((item) =>
        quickReplies.some((reply) => reply.category === item.id)
      ),
    [quickReplies, customCategories]
  );
  const filteredReplies = useMemo(
    () => filterQuickReplies(quickReplies, category, query),
    [quickReplies, category, query]
  );

  const isPanel = variant === "panel";

  return (
    <div className={isPanel ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-zinc-950" : "absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur"}>
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2.5 py-2">
        <Zap className="h-3.5 w-3.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-zinc-200">{t("multi.quickReplies")}</span>
          {title && <span className="block truncate text-[9px] text-zinc-600">{t("multi.appendTo", { title })}</span>}
        </div>
        <span className="ml-auto text-[10px] text-zinc-600">
          {filteredReplies.length}/{quickReplies.length}
        </span>
        {onClose && <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200" title={t("multi.closeQuickReplies")} aria-label={t("multi.closeQuickReplies")}><X className="h-3.5 w-3.5" /></button>}
      </div>

      {quickReplies.length > 0 && (
        <div className="space-y-1.5 border-b border-zinc-800 p-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("multi.searchQuickReplies")}
              aria-label={t("multi.searchQuickReplies")}
              className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 pl-7 text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-brand/60"
            />
          </label>
          {availableCategories.length > 1 && (
            <div className="flex gap-0.5 overflow-x-auto" aria-label={t("multi.quickReplyCategories")}>
              <button
                type="button"
                aria-pressed={category === "all"}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] ${
                  category === "all"
                    ? "bg-brand/15 text-brand"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                }`}
                onClick={() => setCategory("all")}
              >
                {t("multi.all")}
              </button>
              {availableCategories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.id}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] ${
                    category === item.id
                      ? "bg-brand/15 text-brand"
                      : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  }`}
                  onClick={() => setCategory(item.id)}
                >
                    {QUICK_REPLY_CATEGORIES.some((category) => category.id === item.id)
                      ? t(`quickReply.category.${item.id}` as TranslationKey)
                      : item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={isPanel ? "min-h-0 flex-1 overflow-y-auto p-2" : "max-h-52 overflow-y-auto p-1.5"}>
        {filteredReplies.map((reply) => (
          <button
            key={reply.id}
            type="button"
            disabled={!reply.body.trim() && !reply.media}
            className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              onPick(reply.body);
              if (reply.media) {
                emitQuickReplyMedia({
                  ...reply.media,
                  caption: reply.body,
                  token: `${reply.id}-${Date.now()}`,
                  target: "multi",
                });
              }
            }}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate text-[10px] font-medium text-zinc-200">
                {reply.title}
              </span>
              <span className="shrink-0 text-[9px] text-zinc-600">
                {QUICK_REPLY_CATEGORIES.some((category) => category.id === reply.category)
                  ? t(`quickReply.category.${reply.category}` as TranslationKey)
                  : getQuickReplyCategories(customCategories).find(
                      (category) => category.id === reply.category
                    )?.label || t("multi.noContent")}
              </span>
            </span>
            <span className="line-clamp-2 text-[10px] leading-relaxed text-zinc-500">
              {reply.body || reply.media?.fileName || t("multi.noContent")}
            </span>
          </button>
        ))}
        {quickReplies.length === 0 && (
          <p className="px-3 py-5 text-center text-[10px] text-zinc-600">{t("multi.noQuickReplies")}</p>
        )}
        {quickReplies.length > 0 && filteredReplies.length === 0 && (
          <p className="px-3 py-5 text-center text-[10px] text-zinc-600">{t("multi.noMatchingQuickReplies")}</p>
        )}
      </div>
    </div>
  );
}
