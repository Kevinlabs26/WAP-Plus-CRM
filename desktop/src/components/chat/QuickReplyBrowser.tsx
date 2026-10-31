import { FileText, Image as ImageIcon, Music2, Pin, Play, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/primitives";
import { useI18n, type TranslationKey } from "@/i18n";
import { filterQuickReplies, getQuickReplyCategories, QUICK_REPLY_CATEGORIES, type QuickReplyCategoryOption } from "@/lib/quickReplies";
import type { SettingsQuickReply } from "@/store/settingsDefaults";

const PAGE_SIZE = 50;
const EMPTY_IDS: string[] = [];
type ReplyTarget = { title: string; account: string };
const mediaSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

export function QuickReplyBrowser({ replies, categories = [], contextKey, onInsert, pinnedIds = EMPTY_IDS, recentIds = EMPTY_IDS, onTogglePin, onUsed, target, disabled = false, compact = false }: {
  replies: SettingsQuickReply[];
  categories?: QuickReplyCategoryOption[];
  contextKey: string;
  onInsert: (reply: SettingsQuickReply) => boolean | void;
  pinnedIds?: string[];
  recentIds?: string[];
  onTogglePin?: (id: string) => void;
  onUsed?: (id: string) => void;
  target?: ReplyTarget;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"all" | "pinned" | "recent">("all");
  const [preview, setPreview] = useState<{ id: string; contextKey: string } | null>(null);
  useEffect(() => setPreview(null), [contextKey]);
  const listRef = useRef<HTMLUListElement>(null);
  const categoryOptions = useMemo(() => getQuickReplyCategories(categories), [categories]);
  const selectedCategory = category !== "all" && categoryOptions.some(c => c.id === category) && replies.some(reply=>reply.category===category) ? category : "all";
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const filtered = useMemo(() => {
    const matches = filterQuickReplies(replies, selectedCategory, query);
    if (view === "recent") {
      const order = new Map(recentIds.map((id, index) => [id, index]));
      return matches.filter(reply => order.has(reply.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    if (view === "pinned") return matches.filter(reply => pinned.has(reply.id));
    return matches.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
  }, [replies, selectedCategory, query, view, pinned, recentIds]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const pageReplies = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const previewReply = preview?.contextKey === contextKey ? replies.find(reply => reply.id === preview.id) : undefined;
  const categoryLabel = (id: string) => QUICK_REPLY_CATEGORIES.some(c => c.id === id)
    ? t(`quickReply.category.${id}` as TranslationKey) : categoryOptions.find(c => c.id === id)?.label || t("quickReply.category.other");
  const resetPage = () => { setPage(0); if (listRef.current) listRef.current.scrollTop = 0; };
  const insert = (reply: SettingsQuickReply) => {
    if (disabled) return;
    const latest = replies.find(item => item.id === reply.id);
    if (!latest || !latest.body.trim() && !latest.media) return;
    if (onInsert(latest) !== false) { onUsed?.(latest.id); setPreview(null); }
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 space-y-2 border-b border-zinc-800 p-2.5">
      {target && <div className="space-y-0.5 text-2xs text-zinc-500"><p className="truncate" title={target.title}>{t("quickShelf.target", { title: target.title })}</p><p className="truncate" title={target.account}>{t("quickShelf.account", { account: target.account })}</p></div>}
      <label className="relative block"><Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input value={query} onChange={e => { setQuery(e.target.value); resetPage(); }} placeholder={t("quickShelf.search")} aria-label={t("multi.searchQuickReplies")} className="ui-control h-8 w-full pl-7 pr-2 text-xs" />
      </label>
      <div className="flex items-center gap-2">
        <select value={selectedCategory} aria-label={t("multi.quickReplyCategories")} className="ui-control h-8 min-w-0 flex-1 px-2 text-xs" onChange={e => { setCategory(e.target.value); resetPage(); }}>
          <option value="all">{t("multi.all")}</option>
          {categoryOptions.filter(c => replies.some(reply => reply.category === c.id)).map(c => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}
        </select>
        <span className="shrink-0 text-2xs text-zinc-500" role="status">{filtered.length}/{replies.length}</span>
      </div>
      <div className="flex gap-1" role="group" aria-label={t("quickShelf.views")}>
        {(["all", "pinned", "recent"] as const).map(item => <Button key={item} size="xs" variant={view === item ? "secondary" : "ghost"} aria-pressed={view === item} onClick={() => { setView(item); resetPage(); }}>{t(`quickShelf.view.${item}`)}</Button>)}
      </div>
      <p className="text-2xs leading-relaxed text-zinc-500">{t("quickShelf.hint")}</p>
      {disabled && <p className="text-2xs text-amber-500">{t("quickShelf.chooseChat")}</p>}
    </div>
    <ul ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {pageReplies.map(reply => <li key={reply.id}>
        <article className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/30 p-2.5">
          <div className="flex items-start gap-2.5">
            {reply.media && <button type="button" className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand" aria-label={t("quickShelf.previewNamed", { title: reply.title || t("crmPanel.unnamed") })} onClick={() => setPreview({ id: reply.id, contextKey })}>
              <QuickReplyMediaTile media={reply.media} compact={compact} />
            </button>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1"><h4 className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100" title={reply.title}>{reply.title || t("crmPanel.unnamed")}</h4>
                {onTogglePin && <button type="button" aria-pressed={pinned.has(reply.id)} aria-label={t(pinned.has(reply.id) ? "quickShelf.unpin" : "quickShelf.pin", { title: reply.title || t("crmPanel.unnamed") })} onClick={() => { onTogglePin(reply.id); resetPage(); }} className={`shrink-0 rounded p-1 hover:bg-zinc-800 ${pinned.has(reply.id) ? "text-brand" : "text-zinc-500"}`}><Pin aria-hidden="true" className="h-3.5 w-3.5" /></button>}
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-400">{reply.body || t("quickShelf.mediaOnly")}</p>
              {reply.media && <p className="mt-1 truncate text-2xs text-zinc-500" title={reply.media.fileName}>{reply.media.fileName} · {mediaSize(reply.media.size)}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="max-w-[42%] truncate rounded bg-brand/10 px-1.5 py-0.5 text-2xs text-brand">{categoryLabel(reply.category)}</span>
            <div className="flex gap-1"><Button size="xs" variant="ghost" onClick={() => setPreview({ id: reply.id, contextKey })}>{t("quickShelf.preview")}</Button>
              <Button size="xs" disabled={disabled || !reply.body.trim() && !reply.media} onClick={() => insert(reply)}>{t("quickShelf.insert")}</Button></div>
          </div>
        </article>
      </li>)}
      {!pageReplies.length && <li className="px-3 py-8 text-center text-xs text-zinc-500">{t(!replies.length ? "multi.noQuickReplies" : !query.trim() && selectedCategory === "all" && view !== "all" ? `quickShelf.empty.${view}` : "multi.noMatchingQuickReplies")}</li>}
    </ul>
    {filtered.length > PAGE_SIZE && <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 p-2 text-2xs text-zinc-500">
      <Button size="xs" aria-label={t("quickShelf.previousPage")} disabled={!currentPage} onClick={() => { setPage(currentPage - 1); if (listRef.current) listRef.current.scrollTop = 0; }}>‹</Button>
      <span>{currentPage + 1}/{Math.ceil(filtered.length / PAGE_SIZE)} · {t("quickShelf.pageSize", { count: PAGE_SIZE })}</span>
      <Button size="xs" aria-label={t("quickShelf.nextPage")} disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => { setPage(currentPage + 1); if (listRef.current) listRef.current.scrollTop = 0; }}>›</Button>
    </div>}
    {previewReply && <QuickReplyPreview key={`${contextKey}:${previewReply.id}`} reply={previewReply} category={categoryLabel(previewReply.category)} target={target} disabled={disabled} onInsert={() => insert(previewReply)} onClose={() => setPreview(null)} />}
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

export function QuickReplyPreview({ reply, category, target, disabled, onInsert, onClose }: {
  reply: SettingsQuickReply; category: string; target?: ReplyTarget; disabled: boolean; onInsert: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [mediaFailed,setMediaFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(()=>setMediaFailed(false),[reply.media?.dataUrl]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; closeRef.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); }
      if (e.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),audio[controls],video[controls]') || []);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => { window.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 p-4"><div className="min-w-0"><h3 id={titleId} className="break-words text-sm font-semibold text-zinc-100">{reply.title || t("crmPanel.unnamed")}</h3><p className="mt-1 text-xs text-zinc-500">{category}</p></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X aria-hidden="true" className="h-4 w-4" /></button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        {target && <div className="space-y-1 rounded-lg bg-brand/10 p-3 text-xs text-brand"><p className="break-words">{t("quickShelf.target", { title: target.title })}</p><p className="break-words">{t("quickShelf.account", { account: target.account })}</p></div>}
        {reply.body && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">{reply.body}</p>}
        {reply.media && <div className="space-y-2 rounded-lg border border-zinc-700 p-3">
          {mediaFailed ? <p role="status" className="text-xs text-amber-500">{t("quickShelf.previewUnavailable")}</p> : reply.media.kind === "image" ? <img src={reply.media.dataUrl} alt={reply.media.fileName} className="max-h-72 w-full object-contain" onError={()=>setMediaFailed(true)} /> : reply.media.kind === "audio" ? <audio src={reply.media.dataUrl} controls preload="metadata" className="w-full" aria-label={reply.media.fileName} onError={()=>setMediaFailed(true)} /> : reply.media.kind === "video" ? <video src={reply.media.dataUrl} controls preload="metadata" className="max-h-72 w-full" aria-label={reply.media.fileName} onError={()=>setMediaFailed(true)} /> : <FileText aria-hidden="true" className="h-10 w-10 text-zinc-500" />}
          <p className="break-all text-xs text-zinc-400">{reply.media.fileName} · {mediaSize(reply.media.size)}</p>
          <p className="text-2xs text-zinc-500">{t(`quickShelf.kind.${reply.media.kind}`)}</p>
        </div>}
      </div>
      <footer className="shrink-0 space-y-3 border-t border-zinc-800 p-4"><p className="text-xs text-zinc-500">{t("quickShelf.draftHint")}</p><div className="flex justify-end gap-2"><Button size="sm" onClick={onClose}>{t("common.close")}</Button><Button size="sm" variant="primary" disabled={disabled || !reply.body.trim() && !reply.media} onClick={onInsert}>{t("quickShelf.insert")}</Button></div></footer>
    </div>
  </div>, document.body);
}
