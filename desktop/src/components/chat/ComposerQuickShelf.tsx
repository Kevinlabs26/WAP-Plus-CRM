import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, type TranslationKey } from "@/i18n";
import { emitQuickReplyMedia } from "@/lib/quickReplyMedia";
import { baileysRemoveQuickReply } from "@/lib/baileys";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { addLibraryImage, editLibraryImage, listLibraryCategories, listLibraryImages, readLibraryImage, type LibraryImage } from "@/lib/imageLibrary";
import { isTauri } from "@/lib/bridge";
import { cancelQuickReplySheetSync, removeQuickReplySheetRow, restoreQuickReplySheetRow, scheduleQuickReplySheetSync } from "@/lib/quickReplySheetSync";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import { flattenQuickReplyCategories, getQuickReplyCategories, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES, QUICK_REPLY_CATEGORIES, type QuickReplyCategoryOption } from "@/lib/quickReplies";
import { useAppStore } from "@/store/appStore";
import type { ComposerQuickAccessTab, SettingsQuickReply } from "@/store/settingsDefaults";
import { ImageLibraryPreview } from "./ImageLibraryPanel";
import { QuickReplyPreview } from "./QuickReplyBrowser";

type ShelfActionMenu = { kind: "reply" | "image"; left: number; top: number };
type ReplyEditor = { reply: SettingsQuickReply; isNew: boolean };

type ShelfCollapseState = {
  "quick-replies": boolean;
  images: boolean;
  activeReplyFolder: string | null;
  activeImageFolder: string | null;
};

const COLLAPSE_STORAGE_KEY = "wap-composer-shelf-collapsed";

function readCollapseState(): ShelfCollapseState {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || "{}") as Partial<ShelfCollapseState>;
    return {
      "quick-replies": saved["quick-replies"] === true,
      images: saved.images === true,
      activeReplyFolder: typeof saved.activeReplyFolder === "string" ? saved.activeReplyFolder : null,
      activeImageFolder: typeof saved.activeImageFolder === "string" ? saved.activeImageFolder : null,
    };
  } catch {
    return { "quick-replies": false, images: false, activeReplyFolder: null, activeImageFolder: null };
  }
}

export function ComposerQuickShelf({ tabs, quickReplies, categories, chatId, canSendReply, onToggleTab, onInsertReply, onSendReply }: {
  tabs: ComposerQuickAccessTab[];
  quickReplies: SettingsQuickReply[];
  categories: QuickReplyCategoryOption[];
  chatId?: string | null;
  canSendReply: boolean;
  onToggleTab: (tab: ComposerQuickAccessTab) => void;
  onInsertReply: (reply: SettingsQuickReply) => void;
  onSendReply: (reply: SettingsQuickReply) => void;
}) {
  const { t } = useI18n();
  const hasImages = tabs.includes("images");
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [imageCategories, setImageCategories] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imagePreview, setImagePreview] = useState<LibraryImage | null>(null);
  const [imageSaveError, setImageSaveError] = useState("");
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [importingImages, setImportingImages] = useState(false);
  const [replyEditor, setReplyEditor] = useState<ReplyEditor | null>(null);
  const [actionMenu, setActionMenu] = useState<ShelfActionMenu | null>(null);
  const [collapsed, setCollapsed] = useState<ShelfCollapseState>(readCollapseState);
  const imageStripRefs = useRef(new Map<string, HTMLDivElement>());
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const replyInsertClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToast = useAppStore(state => state.pushToast);
  const requestConfirm = useAppStore(state => state.requestConfirm);
  const replyGroups = useMemo(() => flattenQuickReplyCategories(categories)
    .map(({ category, depth }) => ({
      category,
      depth,
      replies: quickReplies.filter(reply => reply.category === category.id),
    }))
    .filter(group => group.replies.length > 0), [categories, quickReplies]);
  const imageGroups = useMemo(() => {
    const groups = new Map<string, LibraryImage[]>();
    groups.set("", []);
    for (const folder of imageCategories) if (!groups.has(folder)) groups.set(folder, []);
    for (const image of images) groups.set(image.category, [...(groups.get(image.category) || []), image]);
    return [...groups.entries()];
  }, [imageCategories, images]);
  const activeReplyGroup = replyGroups.find(group => group.category.id === collapsed.activeReplyFolder) || replyGroups[0];
  const activeImageGroup = imageGroups.find(([folder]) => folder === collapsed.activeImageFolder) || imageGroups[0];

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed)); } catch { /* UI preference only. */ }
  }, [collapsed]);

  useEffect(() => () => {
    if (replyInsertClickTimer.current) clearTimeout(replyInsertClickTimer.current);
  }, []);

  useEffect(() => {
    if (!actionMenu) return;
    const outside = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setActionMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setActionMenu(null); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    actionMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [actionMenu]);

  const toggleSection = (tab: ComposerQuickAccessTab) => setCollapsed(current => ({ ...current, [tab]: !current[tab] }));
  const replyCategoryLabel = (category: QuickReplyCategoryOption) => QUICK_REPLY_CATEGORIES.some(item => item.id === category.id)
    ? t(`quickReply.category.${category.id}` as TranslationKey)
    : category.label;

  const addReply = () => setReplyEditor({ isNew: true, reply: {
    id: crypto.randomUUID(), title: "", body: "", category: activeReplyGroup?.category.id || categories[0]?.id || "other",
  } });

  const editReply = (reply: SettingsQuickReply) => {
    if (replyInsertClickTimer.current) clearTimeout(replyInsertClickTimer.current);
    replyInsertClickTimer.current = null;
    const current = useAppStore.getState().settings.quickReplies.find(item => item.id === reply.id) || reply;
    setReplyEditor({ isNew: false, reply: { ...current, ...(current.media ? { media: { ...current.media } } : {}) } });
  };

  const saveReply = () => {
    if (!replyEditor) return;
    const { reply, isNew } = replyEditor;
    const store = useAppStore.getState();
    const current = store.settings.quickReplies || [];
    const existing = current.find(item => item.id === reply.id);
    if (!isNew && !existing) { setReplyEditor(null); return; }
    if (!reply.body.trim() && !reply.translation?.trim() && !reply.media) return;
    if (isNew && current.length >= MAX_QUICK_REPLIES) { pushToast(t("settingsQuickReplies.limit"), "info"); return; }
    if (current.reduce((bytes, item) => bytes + (item.id === reply.id ? 0 : item.media?.size || 0), 0) + (reply.media?.size || 0) > MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES) {
      pushToast(t("quickLibrary.mediaCapacity"), "error"); return;
    }
    const options = getQuickReplyCategories(store.settings.quickReplyCustomCategories, store.settings.quickReplyRemovedCategories, store.settings.quickReplyCategoryLabels, store.settings.quickReplyCategoryOrder);
    const category = options.some(item => item.id === reply.category) ? reply.category : "other";
    const titleSource = reply.body || reply.translation || reply.media?.fileName || t("quickLibrary.newReply");
    const title = reply.title.trim() || titleSource.trim().split(/\r?\n/, 1)[0].slice(0, 40);
    const patch = { title, body: reply.body, translation: reply.translation, media: reply.media, category };
    if (isNew) {
      const link = current.find(item => item.category === category && item.sheetLink)?.sheetLink;
      const created = { ...reply, ...patch, ...(link ? { sheetLink: { ...link, row: 0, titleSnapshot: title, originalSnapshot: "", translationSnapshot: "" } } : {}) };
      store.updateSettings({ quickReplies: [...current, created] });
      if (link) scheduleQuickReplySheetSync(created.id, t);
    } else {
      store.updateSettings({ quickReplies: current.map(item => item.id === reply.id ? { ...item, ...patch } : item) });
      if (existing && (existing.body !== reply.body || existing.translation !== reply.translation)) scheduleQuickReplySheetSync(reply.id, t);
    }
    setReplyEditor(null);
  };

  const deleteReply = async (reply: SettingsQuickReply) => {
    const ok = await requestConfirm({
      title: t("settingsQuickReplies.deleteReplyConfirm", { title: reply.title || t("quickLibrary.newReply") }),
      description: t(reply.sheetLink?.row ? "quickLibrary.sheetDeleteHint" : "settingsQuickReplies.deleteReplyHint"),
      tone: "danger",
    });
    if (!ok) return;

    const before = useAppStore.getState();
    const currentReply = before.settings.quickReplies.find(item => item.id === reply.id);
    if (!currentReply) { setReplyEditor(null); return; }
    if (currentReply.sheetLink) cancelQuickReplySheetSync(currentReply.id);
    if (currentReply.sheetLink?.row) {
      try { await removeQuickReplySheetRow(currentReply.sheetLink); }
      catch (error) {
        scheduleQuickReplySheetSync(currentReply.id, t);
        pushToast(String(error).includes("quickReplySheetConflict") ? t("quickLibrary.sheetDeleteConflict") : error instanceof Error ? error.message : t(sheetErrorHint(String(error))), "error");
        return;
      }
    }

    const latest = useAppStore.getState();
    const accountId = latest.settings.liveBaileysAccountId || latest.settings.activeAccountId || null;
    const connected = isWaAccountConnected(latest.settings.waAccounts, accountId, latest.settings.liveBaileysAccountId, latest.baileysUi.connection);
    if (connected) {
      try { await baileysRemoveQuickReply(currentReply.id, accountId); }
      catch (error) {
        let restoreFailed = false;
        if (currentReply.sheetLink?.row) {
          try { await restoreQuickReplySheetRow(currentReply.sheetLink); }
          catch { restoreFailed = true; }
        }
        scheduleQuickReplySheetSync(currentReply.id, t);
        pushToast(restoreFailed ? t("quickLibrary.sheetRestoreFailed") : error instanceof Error ? error.message : t("settingsQuickReplies.deleteFailed"), "error");
        return;
      }
    }

    const store = useAppStore.getState();
    store.updateSettings({
      quickReplies: (store.settings.quickReplies || []).filter(item => item.id !== currentReply.id),
      quickReplyPinnedIds: (store.settings.quickReplyPinnedIds || []).filter(id => id !== currentReply.id),
      quickReplyRecentIds: (store.settings.quickReplyRecentIds || []).filter(id => id !== currentReply.id),
    });
    setReplyEditor(null);
    pushToast(t("settingsQuickReplies.deleted"), "info");
  };

  const openActionMenu = (kind: ShelfActionMenu["kind"], event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 196, height = 52;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = rect.bottom + height <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    setActionMenu(current => current?.kind === kind ? null : { kind, left, top });
  };

  const addImages = async (files: File[]) => {
    if (!files.length || importingImages) return;
    setImportingImages(true);
    try {
      let added = 0, duplicates = 0, failures = 0;
      const category = activeImageGroup?.[0] ?? "";
      for (const file of files) {
        try {
          const result = await addLibraryImage(file, category);
          if (result.added) added++; else duplicates++;
        } catch { failures++; }
      }
      window.dispatchEvent(new Event("wap:image-library"));
      pushToast(t("gallery.importResult", { added, duplicates, failures }), failures === files.length ? "error" : "success");
    } finally {
      setImportingImages(false);
    }
  };

  useEffect(() => {
    if (!hasImages || !isTauri()) return;
    let stopped = false;
    const load = async () => {
      try {
        const [next, folderNames] = await Promise.all([listLibraryImages(), listLibraryCategories().catch(() => [])]);
        if (!stopped) { setImages(next); setImageCategories(folderNames); setImageError(""); }
      } catch (error) {
        if (!stopped) setImageError(String(error));
      } finally {
        if (!stopped) setLoadingImages(false);
      }
    };
    setLoadingImages(true);
    void load();
    window.addEventListener("wap:image-library", load);
    return () => { stopped = true; window.removeEventListener("wap:image-library", load); };
  }, [hasImages]);

  const insertImage = async (image: LibraryImage) => {
    if (!chatId || busyImageId) return;
    setBusyImageId(image.id);
    try {
      const dataUrl = await readLibraryImage(image.id);
      const fileName = image.title.includes(".") ? image.title : `${image.title}.${image.mime.split("/")[1] || "png"}`;
      if (!emitQuickReplyMedia({ dataUrl, fileName, mimeType: image.mime, kind: "image", caption: image.caption || "", token: crypto.randomUUID(), target: "main", chatId })) {
        pushToast(t("quickShelf.insertUnavailable"), "info");
        return;
      }
      pushToast(t("quickShelf.mediaInserted"), "success");
      void editLibraryImage({ ...image, usedAt: Date.now() }).then(() => window.dispatchEvent(new Event("wap:image-library"))).catch(() => {});
    } catch (error) {
      pushToast(String(error), "error");
    } finally {
      setBusyImageId(null);
    }
  };

  const saveImageEdits = async (image: LibraryImage) => {
    setImageSaveError("");
    try {
      await editLibraryImage(image);
      window.dispatchEvent(new Event("wap:image-library"));
      setImagePreview(null);
    } catch (error) {
      setImageSaveError(String(error));
    }
  };

  const saveAndInsertImage = async (image: LibraryImage) => {
    setImageSaveError("");
    try {
      await editLibraryImage(image);
      window.dispatchEvent(new Event("wap:image-library"));
      await insertImage(image);
      setImagePreview(null);
    } catch (error) {
      setImageSaveError(String(error));
    }
  };

  const scrollImageFolder = (folder: string, distance: number) => imageStripRefs.current.get(folder)?.scrollBy({ left: distance, behavior: "smooth" });
  if (!tabs.length) return null;

  return <div className="mb-1.5 flex max-h-80 min-h-0 flex-col space-y-1 overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-2">
    {tabs.includes("quick-replies") && <section className="flex min-h-0 flex-1 flex-col">
      <header className={`flex shrink-0 min-w-0 items-start gap-2 text-[11px] font-semibold text-zinc-300 ${collapsed["quick-replies"] ? "" : "mb-1.5"}`}>
        <div role="group" aria-label={t("crmPanel.quickReplies")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" aria-expanded={!collapsed["quick-replies"]} aria-label={t(collapsed["quick-replies"] ? "composerShelf.expandPanel" : "composerShelf.collapsePanel", { panel: t("crmPanel.quickReplies") })} title={t(collapsed["quick-replies"] ? "composerShelf.expandPanel" : "composerShelf.collapsePanel", { panel: t("crmPanel.quickReplies") })} onClick={() => toggleSection("quick-replies")} className="flex shrink-0 items-center gap-1.5 rounded py-1 text-left hover:text-zinc-100">
            {collapsed["quick-replies"] ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            <span>{t("crmPanel.quickReplies")}</span><span className="font-normal text-zinc-500">{quickReplies.length}</span>
          </button>
          {!collapsed["quick-replies"] && replyGroups.map(({ category, replies }) => <button key={category.id} type="button" aria-pressed={activeReplyGroup?.category.id === category.id} onClick={() => setCollapsed(current => ({ ...current, activeReplyFolder: category.id }))} className={`shrink-0 rounded-md px-2 py-1 font-medium transition-colors ${activeReplyGroup?.category.id === category.id ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}>
            {replyCategoryLabel(category)} <span className="ml-0.5 text-[10px] opacity-70">{replies.length}</span>
          </button>)}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-haspopup="menu" aria-expanded={actionMenu?.kind === "reply"} aria-label={t("quickShelf.actions")} title={t("quickShelf.actions")} onClick={event => openActionMenu("reply", event)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={t("settingsQuickReplies.add")} title={t("settingsQuickReplies.add")} onClick={addReply} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-brand"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={t("composerShelf.hidePanel", { panel: t("crmPanel.quickReplies") })} title={t("composerShelf.hidePanel", { panel: t("crmPanel.quickReplies") })} onClick={() => onToggleTab("quick-replies")} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
      </header>
      {!collapsed["quick-replies"] && (activeReplyGroup?.replies.length ? <div className="min-h-0 flex-1 overflow-y-auto"><div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))" }}>
              {activeReplyGroup.replies.map(reply => {
                const preview = (reply.body || reply.translation || "").trim();
                const label = preview.trim().split(/\r?\n/, 1)[0] || reply.title || reply.media?.fileName || t("quickShelf.mediaOnly");
                return <article key={reply.id} className="flex h-8 min-w-0 overflow-hidden rounded-md bg-zinc-800/50 text-[11px] text-zinc-200 transition-colors hover:bg-zinc-800">
                  <button type="button" title={`${t("quickShelf.insertNamed", { title: reply.title || label })} · ${t("quickShelf.doubleClickToEdit")}\n${preview}`} aria-label={t("quickShelf.insertNamed", { title: reply.title || label })} onClick={event => {
                    if (event.detail === 0) { onInsertReply(reply); return; }
                    if (replyInsertClickTimer.current) clearTimeout(replyInsertClickTimer.current);
                    replyInsertClickTimer.current = setTimeout(() => {
                      replyInsertClickTimer.current = null;
                      onInsertReply(reply);
                    }, 320);
                  }} onDoubleClick={() => editReply(reply)} className="min-w-0 flex-1 select-none truncate px-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
                    {label}
                  </button>
                  <button type="button" disabled={!canSendReply} title={t("quickShelf.sendNamed", { title: reply.title || label })} aria-label={t("quickShelf.sendNamed", { title: reply.title || label })} onClick={() => onSendReply(reply)} className="flex w-7 shrink-0 items-center justify-center text-sky-500 transition-colors hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-40"><Send aria-hidden="true" className="h-3 w-3" /></button>
                </article>;
              })}
            </div></div> : <p className="py-1 text-xs text-zinc-500">{t("multi.noQuickReplies")}</p>)}
    </section>}

    {tabs.includes("images") && <section className={`shrink-0 ${tabs.includes("quick-replies") ? "border-t border-zinc-800 pt-2" : ""}`}>
      <input ref={imageInputRef} type="file" className="hidden" accept="image/png,image/jpeg,image/gif,image/webp" multiple aria-label={t("gallery.add")} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void addImages(files); }} />
      <header className={`flex min-w-0 items-start gap-2 text-[11px] font-semibold text-zinc-300 ${collapsed.images ? "" : "mb-1.5"}`}>
        <div role="group" aria-label={t("gallery.title")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" aria-expanded={!collapsed.images} aria-label={t(collapsed.images ? "composerShelf.expandPanel" : "composerShelf.collapsePanel", { panel: t("gallery.title") })} title={t(collapsed.images ? "composerShelf.expandPanel" : "composerShelf.collapsePanel", { panel: t("gallery.title") })} onClick={() => toggleSection("images")} className="flex shrink-0 items-center gap-1.5 rounded py-1 text-left hover:text-zinc-100">
            {collapsed.images ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            <span>{t("gallery.title")}</span><span className="font-normal text-zinc-500">{images.length}</span>
          </button>
          {!collapsed.images && imageGroups.map(([folder, items]) => {
            const selected = activeImageGroup?.[0] === folder;
            return <button key={folder || "__uncategorized__"} type="button" aria-pressed={selected} onClick={() => setCollapsed(current => ({ ...current, activeImageFolder: folder }))} className={`shrink-0 rounded-md px-2 py-1 font-medium transition-colors ${selected ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}>
              {folder || t("gallery.uncategorized")} <span className="ml-0.5 text-[10px] opacity-70">{items.length}</span>
            </button>;
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-haspopup="menu" aria-expanded={actionMenu?.kind === "image"} aria-label={t("quickShelf.imageActions")} title={t("quickShelf.imageActions")} onClick={event => openActionMenu("image", event)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={t("gallery.add")} title={t("gallery.add")} disabled={!isTauri() || importingImages} onClick={() => imageInputRef.current?.click()} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-brand disabled:opacity-40"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
          {!collapsed.images && activeImageGroup && activeImageGroup[1].length > 5 && <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" aria-label={t("composerShelf.scrollImagesLeft")} onClick={() => scrollImageFolder(activeImageGroup[0], -420)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label={t("composerShelf.scrollImagesRight")} onClick={() => scrollImageFolder(activeImageGroup[0], 420)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
          </div>}
          <button type="button" aria-label={t("composerShelf.hidePanel", { panel: t("gallery.title") })} title={t("composerShelf.hidePanel", { panel: t("gallery.title") })} onClick={() => onToggleTab("images")} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
      </header>
      {!collapsed.images && loadingImages && <p role="status" className="py-1 text-xs text-zinc-500">{t("gallery.loading")}</p>}
      {!collapsed.images && imageError && <p role="alert" className="py-1 text-xs text-rose-400">{imageError}</p>}
      {!collapsed.images && !loadingImages && !imageError && !images.length && <p className="py-1 text-xs text-zinc-500">{t("gallery.empty")}</p>}
      {!collapsed.images && activeImageGroup && <div ref={element => { if (element) imageStripRefs.current.set(activeImageGroup[0], element); else imageStripRefs.current.delete(activeImageGroup[0]); }} className="flex gap-1.5 overflow-x-auto pb-1">
        {activeImageGroup[1].map(image => <article key={image.id} className="group relative w-fit max-w-28 shrink-0 p-0.5">
          <button type="button" disabled={busyImageId !== null} onClick={() => { setImageSaveError(""); setImagePreview(image); }} title={t("gallery.rename") + " · " + image.title} aria-label={t("quickShelf.previewNamed", { title: image.title })} className="relative block w-fit pb-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50">
            <img src={image.thumbnail} alt="" loading="lazy" decoding="async" className="block h-auto w-auto max-h-20 max-w-28 rounded-md object-contain" />
            <span className="absolute inset-x-0 bottom-0 truncate px-0.5 text-[10px] font-medium text-zinc-200">{image.title}</span>
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 text-white opacity-0 drop-shadow group-hover:opacity-100 group-focus-within:opacity-100"><Pencil className="h-3 w-3" /></span>
          </button>
          <button type="button" disabled={!chatId || busyImageId !== null} onClick={() => void insertImage(image)} title={t("quickShelf.insertImageNamed", { title: image.title })} aria-label={t("quickShelf.insertImageNamed", { title: image.title })} className="absolute bottom-6 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/85 text-brand hover:bg-zinc-900 disabled:opacity-50"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </article>)}
      </div>}
    </section>}
    {imagePreview && <ImageLibraryPreview
      image={imagePreview}
      busy={busyImageId !== null}
      saveError={imageSaveError}
      canInsert={!!chatId}
      categories={[...new Set([...imageCategories, ...images.map(image => image.category).filter(Boolean)])]}
      onClose={() => setImagePreview(null)}
      onInsert={image => void saveAndInsertImage(image)}
      onSave={image => void saveImageEdits(image)}
    />}
    {replyEditor && <QuickReplyPreview
      key={replyEditor.reply.id}
      reply={replyEditor.reply}
      category={replyCategoryLabel(categories.find(category => category.id === replyEditor.reply.category) || categories[0] || { id: "other", label: "other" })}
      categories={flattenQuickReplyCategories(categories).map(({ category, depth }) => ({ id: category.id, label: "　".repeat(depth) + replyCategoryLabel(category) }))}
      disabled={false}
      onChange={patch => setReplyEditor(current => current ? { ...current, reply: { ...current.reply, ...patch } } : current)}
      onInsert={() => {}}
      onClose={() => setReplyEditor(null)}
      onSave={saveReply}
      onDelete={!replyEditor.isNew ? () => deleteReply(replyEditor.reply) : undefined}
      dialogTitle={replyEditor.isNew ? undefined : "quickLibrary.edit"}
    />}
    {actionMenu && typeof document !== "undefined" && createPortal(<div ref={actionMenuRef} role="menu" aria-label={t(actionMenu.kind === "reply" ? "quickShelf.actions" : "quickShelf.imageActions")} className="fixed z-[10060] min-w-48 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl" style={{ left: actionMenu.left, top: actionMenu.top }}>
      <button type="button" role="menuitem" onClick={() => { const kind = actionMenu.kind; setActionMenu(null); const store = useAppStore.getState(); store.setCrmPanelTab(kind === "reply" ? "quick-replies" : "images"); store.setCrmPanelCollapsed(false); }} className="block w-full rounded px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800">{t("quickShelf.manageInSidebar")}</button>
    </div>, document.body)}
  </div>;
}
