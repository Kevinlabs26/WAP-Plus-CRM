import { FileText, GripVertical, Image as ImageIcon, Music2, Pin, Play, Search, Send, X } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { useDetailsMenu } from "@/components/ui/useDetailsMenu";
import { useI18n, type TranslationKey } from "@/i18n";
import { filterQuickReplies, flattenQuickReplyCategories, getQuickReplyCategories, quickReplyCategoryDescendants, quickReplyPreviewText, QUICK_REPLY_CATEGORIES, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_CATEGORIES, MAX_QUICK_REPLY_MEDIA_BYTES, MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES, type QuickReplyCategoryOption } from "@/lib/quickReplies";
import { scheduleQuickReplySheetSync } from "@/lib/quickReplySheetSync";
import { QuickReplySheetStatus } from "./QuickReplySheetStatus";
import { useAppStore } from "@/store/appStore";
import type { SettingsQuickReply } from "@/store/settingsDefaults";

const PAGE_SIZE = 50;
const EMPTY_IDS: string[] = [];
const QuickReplyImport = lazy(() => import("@/components/settings/SettingsQuickRepliesPanel").then(module => ({ default: module.SettingsQuickRepliesPanel })));
type ReplyTarget = { title: string; account: string };
const mediaSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export function QuickReplyBrowser({ replies, categories = [], removedCategories = EMPTY_IDS, categoryLabels = {}, categoryOrder = EMPTY_IDS, contextKey, onInsert, pinnedIds = EMPTY_IDS, recentIds = EMPTY_IDS, onTogglePin, onUsed, target, disabled = false, compact = false, onManage }: {
  replies: SettingsQuickReply[];
  categories?: QuickReplyCategoryOption[];
  removedCategories?: string[];
  categoryLabels?: Record<string, string>;
  categoryOrder?: string[];
  contextKey: string;
  onInsert: (reply: SettingsQuickReply) => boolean | void;
  pinnedIds?: string[];
  recentIds?: string[];
  onTogglePin?: (id: string) => void;
  onUsed?: (id: string) => void;
  target?: ReplyTarget;
  disabled?: boolean;
  compact?: boolean;
  onManage?: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"all" | "pinned" | "recent">("all");
  const [textMode, setTextMode] = useState<"original" | "translation" | "both">(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("wap_quick_reply_text_mode");
        if (saved === "original" || saved === "translation" || saved === "both") return saved;
      }
    } catch {}
    return "translation";
  });
  const changeTextMode = (mode: "original" | "translation" | "both") => {
    setTextMode(mode);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("wap_quick_reply_text_mode", mode);
      }
    } catch {}
  };
  const [insertMode, setInsertMode] = useState<"original" | "translation">(() => {
    try { return localStorage.getItem("wap_quick_reply_insert_mode") === "translation" ? "translation" : "original"; }
    catch { return "original"; }
  });
  const changeInsertMode = (mode: "original" | "translation") => {
    setInsertMode(mode);
    try { localStorage.setItem("wap_quick_reply_insert_mode", mode); } catch {}
  };
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => {
    const options = getQuickReplyCategories(categories, removedCategories, categoryLabels, categoryOrder);
    const expanded = new Set<string>();
    let current = options.find(item => item.id === replies[0]?.category);
    while (current) { expanded.add(current.id); current = options.find(item => item.id === current?.parentId); }
    return [...expanded];
  });
  const [preview, setPreview] = useState<{ id: string; contextKey: string } | null>(null);
  const [action, setAction] = useState<"reply" | "category" | "import" | null>(null);
  const [draft, setDraft] = useState<SettingsQuickReply | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [activeCategory, setActiveCategory] = useState(replies[0]?.category || "other");
  const [revealId, setRevealId] = useState<string | null>(null);
  const draggingCategory = useRef<string | null>(null);
  const [categoryDrop, setCategoryDrop] = useState<{ id: string; after: boolean } | null>(null);
  useEffect(() => setPreview(null), [contextKey]);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useDetailsMenu(contextKey);
  const categoryOptions = useMemo(() => getQuickReplyCategories(categories, removedCategories, categoryLabels, categoryOrder), [categories, removedCategories, categoryLabels, categoryOrder]);
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const filtered = useMemo(() => {
    const matches = filterQuickReplies(replies, "all", query);
    if (view === "recent") {
      const order = new Map(recentIds.map((id, index) => [id, index]));
      return matches.filter(reply => order.has(reply.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    if (view === "pinned") return matches.filter(reply => pinned.has(reply.id));
    return matches.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
  }, [replies, query, view, pinned, recentIds]);
  const autoExpandCategories = !!query.trim() || view !== "all";
  const visibleReplies = useMemo(() => {
    if (autoExpandCategories) return filtered.filter(reply => categoryOptions.some(item => item.id === reply.category));
    const byId = new Map(categoryOptions.map(item => [item.id, item]));
    const expanded = new Set(expandedCategories);
    return filtered.filter(reply => {
      let id = reply.category;
      while (id) {
        if (!expanded.has(id)) return false;
        id = byId.get(id)?.parentId || "";
      }
      return byId.has(reply.category);
    });
  }, [filtered, categoryOptions, expandedCategories, autoExpandCategories]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visibleReplies.length / PAGE_SIZE) - 1));
  const pageReplies = visibleReplies.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  useEffect(() => {
    if (!revealId) return;
    const index = visibleReplies.findIndex(reply => reply.id === revealId);
    if (index < 0) return;
    const nextPage = Math.floor(index / PAGE_SIZE);
    if (currentPage !== nextPage) { setPage(nextPage); return; }
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-quick-reply-id="${CSS.escape(revealId)}"]`)?.scrollIntoView({ block: "nearest" });
      setRevealId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealId, visibleReplies, currentPage]);
  const previewReply = preview?.contextKey === contextKey ? replies.find(reply => reply.id === preview.id) : undefined;
  const categoryLabel = (id: string) => categoryLabels[id] || (QUICK_REPLY_CATEGORIES.some(c => c.id === id)
    ? t(`quickReply.category.${id}` as TranslationKey) : categoryOptions.find(c => c.id === id)?.label || t("quickReply.category.other"));
  const reorderCategory = (targetId: string, after: boolean) => {
    const latest = useAppStore.getState().settings;
    const options = getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels, latest.quickReplyCategoryOrder);
    const source = options.find(item => item.id === draggingCategory.current);
    const target = options.find(item => item.id === targetId);
    if (!source || !target || source.id === target.id || source.parentId !== target.parentId) return;
    const order = options.map(item => item.id).filter(id => id !== source.id);
    order.splice(order.indexOf(target.id) + Number(after), 0, source.id);
    useAppStore.getState().updateSettings({ quickReplyCategoryOrder: order });
  };
  const resetPage = () => { setPage(0); if (listRef.current) listRef.current.scrollTop = 0; };
  const showCategories = (ids: string[]) => {
    const latest = useAppStore.getState().settings;
    const options = getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels, latest.quickReplyCategoryOrder);
    setExpandedCategories(previous => {
      const expanded = new Set(previous);
      for (const id of ids) {
        let current = options.find(item => item.id === id);
        while (current) { expanded.add(current.id); current = options.find(item => item.id === current?.parentId); }
      }
      return [...expanded];
    });
    if (ids[0]) setActiveCategory(ids[0]);
    setQuery(""); setView("all"); resetPage();
  };
  const beginReply = () => {
    if (draft) { setAction("reply"); return; }
    setDraft({ id: crypto.randomUUID(), title: "", body: "", category: categoryOptions.some(item => item.id === activeCategory) ? activeCategory : "other" });
    setPreview(null); setAction("reply");
  };
  const saveDraft = () => {
    if (!draft || !draft.body.trim() && !draft.translation?.trim() && !draft.media) return;
    const store = useAppStore.getState(), current = store.settings.quickReplies || [];
    if (current.some(reply => reply.id === draft.id)) return;
    if (current.length >= MAX_QUICK_REPLIES) { store.pushToast(t("settingsQuickReplies.limit"), "info"); return; }
    if (current.reduce((bytes, reply) => bytes + (reply.media?.size || 0), draft.media?.size || 0) > MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES) { store.pushToast(t("quickLibrary.mediaCapacity"), "error"); return; }
    const options = getQuickReplyCategories(store.settings.quickReplyCustomCategories, store.settings.quickReplyRemovedCategories);
    const category = options.some(item => item.id === draft.category) ? draft.category : "other";
    const title = draft.title.trim() || (draft.body || draft.translation || draft.media?.fileName || t("quickLibrary.newReply")).trim().split("\n")[0].slice(0, 40);
    if (title.length > 40 || draft.body.length > 2000 || (draft.translation?.length || 0) > 2000) return;
    const link = current.find(reply => reply.category === category && reply.sheetLink)?.sheetLink;
    const item = { ...draft, title, category, ...(link ? { sheetLink: { ...link, row: 0, titleSnapshot: title, originalSnapshot: "", translationSnapshot: "" } } : {}) };
    store.updateSettings({ quickReplies: [...current, item] });
    if (link) scheduleQuickReplySheetSync(item.id, t);
    showCategories([category]); setRevealId(item.id); setDraft(null); setAction(null);
  };
  const addCategory = () => {
    const label = newCategory.trim(); if (!label || label.length > 32) return;
    const store = useAppStore.getState(), latest = store.settings;
    if ((latest.quickReplyCustomCategories?.length || 0) >= MAX_QUICK_REPLY_CATEGORIES) { store.pushToast(t("quickLibrary.categoryLimit"), "info"); return; }
    const options = getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels);
    if (options.some(item => (latest.quickReplyCategoryLabels?.[item.id] || (QUICK_REPLY_CATEGORIES.some(base => base.id === item.id) ? t(`quickReply.category.${item.id}` as TranslationKey) : item.label)).toLocaleLowerCase() === label.toLocaleLowerCase())) { store.pushToast(t("settingsQuickReplies.categoryExists"), "info"); return; }
    const id = "custom-" + crypto.randomUUID();
    store.updateSettings({ quickReplyCustomCategories: [...(latest.quickReplyCustomCategories || []), { id, label }] });
    setDraft(value => value ? { ...value, category: id } : value);
    showCategories([id]); setNewCategory(""); setAction(draft ? "reply" : null);
  };
  const finishImport = (ids: string[]) => {
    showCategories(ids);
    const known = new Set(replies.map(reply => reply.id));
    const items = useAppStore.getState().settings.quickReplies || [];
    setRevealId(items.find(reply => !known.has(reply.id) && ids.includes(reply.category))?.id || items.find(reply => ids.includes(reply.category))?.id || null);
    setAction(draft ? "reply" : null);
  };
  const categoryCount = (id: string) => { const ids = quickReplyCategoryDescendants(id, categoryOptions); return filtered.filter(reply => ids.has(reply.category)).length; };
  const insert = (reply: SettingsQuickReply, body?: string) => {
    if (disabled) return;
    const latest = replies.find(item => item.id === reply.id);
    body ??= (insertMode === "translation" ? latest?.translation : latest?.body)?.trim() || "";
    if (!latest || !body.trim() && !latest.media) return;
    if (onInsert({ ...latest, body }) !== false) { onUsed?.(latest.id); setPreview(null); }
  };
  const updateReply = (id: string, patch: Partial<Pick<SettingsQuickReply, "title" | "body" | "translation" | "media">>) => {
    const store = useAppStore.getState();
    const current = store.settings.quickReplies || [];
    if (!current.some(reply => reply.id === id)) return false;
    const next = current.map(reply => reply.id === id ? { ...reply, ...patch } : reply);
    if (next.reduce((bytes, reply) => bytes + (reply.media?.size || 0), 0) > MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES) {
      store.pushToast(t("quickLibrary.mediaCapacity"), "error"); return false;
    }
    store.updateSettings({ quickReplies: next });
    if (patch.body !== undefined || patch.translation !== undefined) scheduleQuickReplySheetSync(id, t);
    return true;
  };
  const renderReply = (reply: SettingsQuickReply) => {
    const hasOriginal = !!reply.body?.trim();
    const hasTranslation = !!reply.translation?.trim();
    const original = quickReplyPreviewText(reply.title, reply.body || "");
    const translation = quickReplyPreviewText(reply.title, reply.translation || "");
    const text = textMode === "both"
      ? ""
      : textMode === "original"
        ? (original || (hasOriginal ? "" : t("quickShelf.originalUnavailable")))
        : (translation || (hasTranslation ? "" : t("quickShelf.translationUnavailable")));
    const selectedInsertText = insertMode === "translation" ? reply.translation?.trim() : reply.body.trim();

    return <li key={reply.id}>
      <article data-quick-reply-id={reply.id} className="space-y-1.5 rounded-xl border border-zinc-800 p-2">
        <QuickReplySheetStatus reply={reply} />
        <div className="flex items-start gap-2">
          <button type="button" className="flex min-w-0 flex-1 items-start gap-2.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" aria-label={t("quickShelf.previewNamed", { title: reply.title || t("crmPanel.unnamed") })} onClick={() => setPreview({ id: reply.id, contextKey })}>
            {reply.media && <span className="shrink-0" title={`${reply.media.fileName} · ${mediaSize(reply.media.size)}`}><QuickReplyMediaTile media={reply.media} compact={compact} /></span>}
            <span className="min-w-0 flex-1">
              <span role="heading" aria-level={4} className="block truncate text-xs font-semibold text-zinc-100" title={reply.title}>{reply.title || t("crmPanel.unnamed")}</span>
              {textMode === "both"
                ? <span className="mt-1 block space-y-0.5 text-[11px] leading-relaxed text-zinc-400" title={text}>
                    {original && <span className="block line-clamp-1 break-words"><span className="text-zinc-500">{t("quickShelf.insertOriginalShort")}:</span> {original}</span>}
                    {!hasOriginal && <span className="block line-clamp-1 break-words"><span className="text-zinc-500">{t("quickShelf.insertOriginalShort")}:</span> {t("quickShelf.originalUnavailable")}</span>}
                    {translation && <span className="block line-clamp-1 break-words"><span className="text-zinc-500">{t("quickShelf.insertTranslationShort")}:</span> {translation}</span>}
                    {!hasTranslation && <span className="block line-clamp-1 break-words"><span className="text-zinc-500">{t("quickShelf.insertTranslationShort")}:</span> {t("quickShelf.translationUnavailable")}</span>}
                  </span>
                : text && <span className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-400" title={text}>{text}</span>}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {onTogglePin && <button type="button" aria-pressed={pinned.has(reply.id)} aria-label={t(pinned.has(reply.id) ? "quickShelf.unpin" : "quickShelf.pin", { title: reply.title || t("crmPanel.unnamed") })} onClick={() => { onTogglePin(reply.id); resetPage(); }} className={`rounded p-1 hover:bg-zinc-800 ${pinned.has(reply.id) ? "text-brand" : "text-zinc-500"}`}><Pin aria-hidden="true" className="h-3.5 w-3.5" /></button>}
            <button type="button" aria-label={t(insertMode === "translation" ? "quickShelf.insertTranslation" : "quickShelf.insertOriginal")} title={t(insertMode === "translation" ? "quickShelf.insertTranslation" : "quickShelf.insertOriginal")} disabled={disabled || !selectedInsertText && !reply.media} onClick={() => insert(reply)} className="rounded p-1 text-brand hover:bg-zinc-800 disabled:opacity-40"><Send aria-hidden="true" className="h-4 w-4" /></button>
          </div>
        </div>
      </article>
    </li>;
  };
  const renderCategoryTree = (parentId: string | undefined, depth = 0): React.ReactNode => categoryOptions
    .filter(item => item.parentId === parentId && (categoryCount(item.id) > 0 || !query.trim() && view === "all" && categories.some(custom => custom.id === item.id)))
    .map(item => {
      const expanded = autoExpandCategories || expandedCategories.includes(item.id);
      const directReplies = pageReplies.filter(reply => reply.category === item.id);
      return <section key={item.id} className="space-y-1.5">
        <div className={`flex items-center gap-2 rounded-lg bg-zinc-800/50 px-2 py-1 ${categoryDrop?.id === item.id ? categoryDrop.after ? "border-b-2 border-brand" : "border-t-2 border-brand" : ""}`} style={{ marginLeft: depth * 12 }} onDragOver={event => {
          const source = categoryOptions.find(category => category.id === draggingCategory.current);
          if (!source || source.id === item.id || source.parentId !== item.parentId) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const after = event.clientY >= rect.top + rect.height / 2;
          setCategoryDrop(current => current?.id === item.id && current.after === after ? current : { id: item.id, after });
        }} onDrop={event => {
          event.preventDefault();
          reorderCategory(item.id, event.clientY >= event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2);
          draggingCategory.current = null;
          setCategoryDrop(null);
        }}>
          {autoExpandCategories ? <span className="h-6 w-6 shrink-0" /> : <button type="button" aria-label={t(expanded ? "quickLibrary.collapseCategory" : "quickLibrary.expandCategory", { name: categoryLabel(item.id) })} aria-expanded={expanded} onClick={() => { setActiveCategory(item.id); setExpandedCategories(current => expanded ? current.filter(id => id !== item.id) : [...current, item.id]); resetPage(); }} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm font-semibold text-zinc-400 hover:bg-zinc-700" title={t(expanded ? "quickLibrary.collapseCategory" : "quickLibrary.expandCategory", { name: categoryLabel(item.id) })}>{expanded ? "−" : "+"}</button>}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">{categoryLabel(item.id)}</span>
          <span className="text-2xs text-zinc-500">{categoryCount(item.id)}</span>
          <button type="button" draggable aria-label={t("quickLibrary.dragCategory", { name: categoryLabel(item.id) })} title={t("quickLibrary.dragCategory", { name: categoryLabel(item.id) })} className="cursor-grab touch-none text-zinc-500 hover:text-zinc-200 active:cursor-grabbing" onDragStart={event => { draggingCategory.current = item.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }} onDragEnd={() => { draggingCategory.current = null; setCategoryDrop(null); }}><GripVertical aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
        {expanded && <div className="space-y-1.5" style={{ marginLeft: depth * 12 + 24 }}>
          {!!directReplies.length && <ul className="m-0 list-none space-y-1.5 p-0">{directReplies.map(renderReply)}</ul>}
          {renderCategoryTree(item.id, depth + 1)}
        </div>}
      </section>;
    });

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-2 border-b border-zinc-800 p-2">
      <div className="flex items-center gap-1.5">
        <label className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input value={query} onChange={e => { setQuery(e.target.value); resetPage(); }} placeholder={t("quickShelf.search")} aria-label={t("multi.searchQuickReplies")} className="ui-control h-8 w-full pl-7 pr-2 text-xs" />
        </label>
        <div className="inline-flex shrink-0 items-center rounded-lg bg-zinc-800 p-0.5 text-2xs" role="group" aria-label={t("quickShelf.langMode")}>
          <button
            type="button"
            aria-label={t("quickShelf.showOriginal")}
            title={t("quickShelf.showOriginal")}
            aria-pressed={textMode === "original"}
            onClick={() => changeTextMode("original")}
            className={`rounded px-2 py-1 transition-colors ${textMode === "original" ? "bg-zinc-700 font-medium text-brand shadow-xs" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {t("quickShelf.insertOriginalShort")}
          </button>
          <button
            type="button"
            aria-label={t("quickShelf.showTranslation")}
            title={t("quickShelf.showTranslation")}
            aria-pressed={textMode === "translation"}
            onClick={() => changeTextMode("translation")}
            className={`rounded px-2 py-1 transition-colors ${textMode === "translation" ? "bg-zinc-700 font-medium text-brand shadow-xs" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {t("quickShelf.insertTranslationShort")}
          </button>
          <button
            type="button"
            aria-label={t("quickShelf.showBoth")}
            title={t("quickShelf.showBoth")}
            aria-pressed={textMode === "both"}
            onClick={() => changeTextMode("both")}
            className={`rounded px-2 py-1 transition-colors ${textMode === "both" ? "bg-zinc-700 font-medium text-brand shadow-xs" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {t("quickShelf.showBothShort")}
          </button>
        </div>
        <details ref={menuRef} className="relative shrink-0 text-xs text-zinc-500" onClick={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false; }}>
          <summary aria-label={t("nav.more")} title={t("nav.more")} className="cursor-pointer list-none rounded px-2 py-1.5 hover:bg-zinc-800">•••</summary>
          <div className="absolute right-0 top-full z-10 mt-1 min-w-max space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
            <div className="flex gap-1" role="group" aria-label={t("quickShelf.views")}>{(["all", "pinned", "recent"] as const).map(item => <Button key={item} size="xs" variant={view === item ? "secondary" : "ghost"} aria-pressed={view === item} onClick={() => { setView(item); resetPage(); }}>{t(`quickShelf.view.${item}`)}</Button>)}</div>
            <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-2">
              <span className="text-2xs text-zinc-500">{t("quickShelf.fillLanguage")}</span>
              <div className="flex gap-1" role="group" aria-label={t("quickShelf.fillLanguage")}>
                {(["original", "translation"] as const).map(mode => <Button key={mode} size="xs" variant={insertMode === mode ? "secondary" : "ghost"} aria-pressed={insertMode === mode} onClick={() => changeInsertMode(mode)}>{t(mode === "original" ? "quickShelf.insertOriginalShort" : "quickShelf.insertTranslationShort")}</Button>)}
              </div>
            </div>
            {onManage && <Button size="xs" className="w-full" onClick={onManage}>{t("crmPanel.manage")}</Button>}
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label={t("quickShelf.actions")}>
        <Button size="xs" variant="secondary" aria-label={t("settingsQuickReplies.add")} aria-expanded={action === "reply"} disabled={action === "import" || replies.length >= MAX_QUICK_REPLIES} onClick={beginReply}>＋ {t("settingsQuickReplies.add")}</Button>
        <Button size="xs" aria-label={t("settingsQuickReplies.addCategory")} aria-expanded={action === "category"} disabled={action === "import"} onClick={() => { setAction("category"); setPreview(null); }}>＋ {t("settingsQuickReplies.addCategory")}</Button>
        <Button size="xs" disabled={action === "import"} onClick={() => { setAction("import"); setPreview(null); }}>{t("quickShelf.import")}</Button>
      </div>
      {disabled && <p className="text-2xs text-amber-500">{t("quickShelf.chooseChat")}</p>}
    </div>
    <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {action === "reply" && draft && <QuickReplyPreview key={draft.id} inline reply={draft} category={categoryLabel(draft.category)} categories={flattenQuickReplyCategories(categoryOptions).map(({ category, depth }) => ({ id: category.id, label: "　".repeat(depth) + categoryLabel(category.id) }))} disabled={false}
        onChange={patch => { setDraft(current => current?.id === draft.id ? { ...current, ...patch } : current); }}
        onSave={saveDraft} onInsert={() => {}} onClose={() => { setDraft(null); setAction(null); }} />}
      {action === "category" && <form aria-label={t("settingsQuickReplies.addCategory")} className="space-y-2 rounded-lg border border-zinc-700 p-2" onSubmit={event => { event.preventDefault(); addCategory(); }}>
        <Input autoFocus maxLength={32} value={newCategory} aria-label={t("settingsQuickReplies.categoryPlaceholder")} placeholder={t("settingsQuickReplies.categoryPlaceholder")} onChange={event => setNewCategory(event.target.value)} />
        <div className="flex justify-end gap-1"><Button size="xs" onClick={() => setAction(draft ? "reply" : null)}>{t("common.cancel")}</Button><Button size="xs" type="submit" variant="primary" disabled={!newCategory.trim()}>{t("common.save")}</Button></div>
      </form>}
      {action === "import" && <Suspense fallback={<p role="status" className="p-2 text-xs text-zinc-500">{t("quickLibrary.sheetLoading")}</p>}><QuickReplyImport importOnly defaultCategory={activeCategory} onClose={() => setAction(draft ? "reply" : null)} onImported={finishImport} /></Suspense>}
      {view !== "all" && <button type="button" className="rounded-full bg-brand/10 px-2.5 py-1 text-2xs text-brand" onClick={() => { setView("all"); resetPage(); }}>{t(`quickShelf.view.${view}`)} ×</button>}
      {renderCategoryTree(undefined)}
      {!visibleReplies.length && <div className="px-3 py-8 text-center text-xs text-zinc-500">{!replies.length ? t("multi.noQuickReplies") : !filtered.length ? !query.trim() && view !== "all" ? t(`quickShelf.empty.${view}`) : t("multi.noMatchingQuickReplies") : t("quickShelf.expandCategoryHint")}</div>}
    </div>
    {visibleReplies.length > PAGE_SIZE && <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 p-2 text-2xs text-zinc-500">
      <Button size="xs" aria-label={t("quickShelf.previousPage")} disabled={!currentPage} onClick={() => { setPage(currentPage - 1); if (listRef.current) listRef.current.scrollTop = 0; }}>‹</Button>
      <span>{currentPage + 1}/{Math.ceil(visibleReplies.length / PAGE_SIZE)} · {t("quickShelf.pageSize", { count: PAGE_SIZE })}</span>
      <Button size="xs" aria-label={t("quickShelf.nextPage")} disabled={(currentPage + 1) * PAGE_SIZE >= visibleReplies.length} onClick={() => { setPage(currentPage + 1); if (listRef.current) listRef.current.scrollTop = 0; }}>›</Button>
    </div>}
    {previewReply && <QuickReplyPreview key={`${contextKey}:${previewReply.id}`} reply={previewReply} category={categoryLabel(previewReply.category)} target={target} disabled={disabled} onChange={patch => updateReply(previewReply.id, patch)} onInsert={body => insert(previewReply, body)} onClose={() => setPreview(null)} />}
  </div>;
}

function QuickReplyMediaTile({ media, compact }: { media: NonNullable<SettingsQuickReply["media"]>; compact: boolean }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media.dataUrl]);
  const Icon = media.kind === "audio" ? Music2 : media.kind === "video" ? Play : media.kind === "image" ? ImageIcon : FileText;
  return <span className={`relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-zinc-700/70 bg-zinc-800/60 text-zinc-400 ${compact ? "h-14 w-14" : "h-16 w-16"}`}>
    {media.kind === "image" && !failed ? <img src={media.dataUrl} alt={media.fileName} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : <><Icon aria-hidden="true" className="h-5 w-5" /><span className="text-[9px]">{t(`quickShelf.kind.${media.kind}`)}</span></>}
    {media.kind === "image" && !failed && <span className="absolute bottom-0 inset-x-0 bg-black/65 py-0.5 text-center text-[9px] text-white">{t("quickShelf.kind.image")}</span>}
  </span>;
}

export function QuickReplyPreview({ reply, category, target, disabled, onChange, onInsert, onClose, inline = false, categories, onSave }: {
  reply: SettingsQuickReply; category: string; target?: ReplyTarget; disabled: boolean; onChange?: (patch: Partial<Pick<SettingsQuickReply, "title" | "body" | "translation" | "media" | "category">>) => boolean | void; onInsert: (body?: string) => void; onClose: () => void;
  inline?: boolean; categories?: { id: string; label: string }[]; onSave?: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [mediaFailed,setMediaFailed] = useState(false);
  const [mediaBusy,setMediaBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const mediaRequest = useRef(0), mounted = useRef(true);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mediaRequest.current++; }; }, []);
  useEffect(()=>setMediaFailed(false),[reply.media?.dataUrl]);
  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement as HTMLElement | null; closeRef.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); }
      if (e.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),audio[controls],video[controls]') || []);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => { window.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [inline]);
  const readMedia = async (file: File) => {
    if (!onChange) return;
    if (file.size > MAX_QUICK_REPLY_MEDIA_BYTES) { useAppStore.getState().pushToast(t("settingsQuickReplies.mediaTooLarge"), "info"); return; }
    const request = ++mediaRequest.current;
    setMediaBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reader.onabort = () => reject(reader.error || new Error("read failed"));
        reader.readAsDataURL(file);
      });
      if (!mounted.current || request !== mediaRequest.current) return;
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(";base64,")) throw new Error("invalid media");
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "file";
      if (onChange({ media: { dataUrl, fileName: file.name.slice(0, 180), mimeType: file.type || "application/octet-stream", kind, size: file.size } }) !== false) {
        useAppStore.getState().pushToast(t("settingsQuickReplies.mediaAdded"), "success");
      }
    } catch { if (mounted.current && request === mediaRequest.current) useAppStore.getState().pushToast(t("settingsQuickReplies.mediaReadFailed"), "error"); }
    finally { if (mounted.current && request === mediaRequest.current) setMediaBusy(false); }
  };
  if (!inline && typeof document === "undefined") return null;
  const content = <div className={inline ? "" : "fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4"} onMouseDown={e => { if (!inline && e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} role={inline ? "region" : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby={titleId} className={inline ? "overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900" : "flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 p-3"><div className="min-w-0 flex-1"><h3 id={titleId} className="sr-only">{t(onSave ? "settingsQuickReplies.add" : "quickLibrary.edit")}</h3><Input autoFocus={inline} placeholder={onSave ? t("quickShelf.optionalTitle") : undefined} maxLength={40} value={reply.title} aria-label={t("settingsQuickReplies.commandTitle")} readOnly={!onChange} onChange={event => onChange?.({ title: event.target.value })} />{categories ? <select aria-label={t("settingsQuickReplies.category")} className="ui-control mt-2 w-full px-2 text-xs" value={reply.category} onChange={event => onChange?.({ category: event.target.value })}>{categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <p className="mt-1 text-xs text-zinc-500">{category}</p>}</div><button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X aria-hidden="true" className="h-4 w-4" /></button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        {target && <p className="break-words rounded-lg bg-brand/10 p-2 text-xs text-brand">{target.title} · {target.account}</p>}
        <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.originalContent")} · {reply.body.length} / 2000</span><Textarea rows={inline ? 3 : 5} maxLength={2000} value={reply.body} aria-label={t("settingsQuickReplies.content")} placeholder={t("settingsQuickReplies.contentPlaceholder")} readOnly={!onChange} onChange={event => onChange?.({ body: event.target.value })} /></label>
        <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.translation")} · {(reply.translation || "").length} / 2000</span><Textarea rows={inline ? 2 : 4} maxLength={2000} value={reply.translation || ""} aria-label={t("settingsQuickReplies.translation")} placeholder={t("settingsQuickReplies.translationPlaceholder")} readOnly={!onChange} onChange={event => onChange?.({ translation: event.target.value })} /></label>
        {reply.media && <div className="space-y-2 rounded-lg border border-zinc-700 p-3">
          {mediaFailed ? <p role="status" className="text-xs text-amber-500">{t("quickShelf.previewUnavailable")}</p> : reply.media.kind === "image" ? <button type="button" disabled={!onChange} aria-label={t("settingsQuickReplies.replaceMedia")} onClick={() => mediaInput.current?.click()} className="block w-full"><img src={reply.media.dataUrl} alt={reply.media.fileName} className="max-h-72 w-full object-contain" onError={()=>setMediaFailed(true)} /></button> : reply.media.kind === "audio" ? <audio src={reply.media.dataUrl} controls preload="metadata" className="w-full" aria-label={reply.media.fileName} onError={()=>setMediaFailed(true)} /> : reply.media.kind === "video" ? <video src={reply.media.dataUrl} controls preload="metadata" className="max-h-72 w-full" aria-label={reply.media.fileName} onError={()=>setMediaFailed(true)} /> : <FileText aria-hidden="true" className="h-10 w-10 text-zinc-500" />}
          <p className="break-all text-xs text-zinc-400">{reply.media.fileName} · {mediaSize(reply.media.size)}</p>
          <p className="text-2xs text-zinc-500">{t(`quickShelf.kind.${reply.media.kind}`)}</p>
        </div>}
        <input ref={mediaInput} type="file" className="hidden" aria-label={t("settingsQuickReplies.addMedia")} disabled={!onChange || mediaBusy} accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void readMedia(file); }} />
        <div className="flex items-center gap-2"><Button size="sm" disabled={!onChange || mediaBusy} onClick={() => mediaInput.current?.click()}>{t(reply.media ? "settingsQuickReplies.replaceMedia" : "settingsQuickReplies.addMedia")}</Button>{reply.media && <Button size="sm" variant="ghost" disabled={!onChange || mediaBusy} onClick={() => onChange?.({ media: undefined })}>{t("settingsQuickReplies.removeMedia")}</Button>}{mediaBusy && <span role="status" className="text-xs text-brand">{t("quickLibrary.readingMedia")}</span>}</div>
      </div>
      <footer className="shrink-0 space-y-3 border-t border-zinc-800 p-3">{!onSave && <p className="text-xs text-zinc-500">{t("quickShelf.draftHint")}</p>}<div className="flex justify-end gap-2"><Button size="sm" onClick={onClose}>{t(onSave ? "common.cancel" : "common.close")}</Button>{onSave ? <Button size="sm" variant="primary" disabled={mediaBusy || !reply.body.trim() && !reply.translation?.trim() && !reply.media} onClick={onSave}>{t("common.save")}</Button> : <>{reply.translation && <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onInsert(reply.translation)}>{t("quickShelf.insertTranslation")}</Button>}<Button size="sm" variant="primary" disabled={disabled || !reply.body.trim() && !reply.media} onClick={() => onInsert(reply.body)}>{t(reply.translation ? "quickShelf.insertOriginal" : "quickShelf.insert")}</Button></>}</div></footer>
    </div>
  </div>;
  return inline ? content : createPortal(content, document.body);
}
