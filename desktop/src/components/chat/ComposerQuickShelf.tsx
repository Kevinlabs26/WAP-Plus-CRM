import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Play, Plus, Send, X } from "lucide-react";
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
import { flattenQuickReplyCategories, getQuickReplyCategories, MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES, QUICK_REPLY_CATEGORIES, type QuickReplyCategoryOption } from "@/lib/quickReplies";
import { useAppStore } from "@/store/appStore";
import type { ComposerQuickAccessTab, SettingsQuickReply } from "@/store/settingsDefaults";
import { ImageLibraryPreview } from "./ImageLibraryPanel";
import { QuickReplyPreview } from "./QuickReplyBrowser";
import { addQuickMedia, listQuickMedia, quickMediaFileType, QUICK_MEDIA_CHANGED, readQuickMedia, removeQuickMedia, type QuickMedia } from "@/lib/quickMediaLibrary";
import { Button } from "@/components/ui/primitives";
import { LibraryThumbnail } from "./LibraryThumbnail";
import { ANDROID_MEDIA_MAX_BYTES } from "@shared/protocol";

type ShelfActionMenu = { kind: "reply" | "image"; left: number; top: number };
type ReplyEditor = { reply: SettingsQuickReply; isNew: boolean };

type ShelfCollapseState = {
  "quick-replies": boolean;
  images: boolean;
  activeReplyFolder: string | null;
  activeImageFolder: string | null;
  replyHeight: number;
};

function formatClipDuration(seconds: number) {
  const total = Math.floor(seconds);
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

const COLLAPSE_STORAGE_KEY = "wap-composer-shelf-collapsed";
const DEFAULT_REPLY_HEIGHT = 108;
const MIN_REPLY_HEIGHT = 72;
const MAX_REPLY_HEIGHT = 324;
const REPLIES_PER_PAGE = 96;
const MEDIA_PER_PAGE = 24;

function clampReplyHeight(height: number) {
  return Math.min(MAX_REPLY_HEIGHT, Math.max(MIN_REPLY_HEIGHT, height));
}

function readCollapseState(): ShelfCollapseState {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || "{}") as Partial<ShelfCollapseState>;
    return {
      "quick-replies": saved["quick-replies"] === true,
      images: saved.images === true,
      activeReplyFolder: typeof saved.activeReplyFolder === "string" ? saved.activeReplyFolder : null,
      activeImageFolder: typeof saved.activeImageFolder === "string" ? saved.activeImageFolder : null,
      replyHeight: typeof saved.replyHeight === "number" && Number.isFinite(saved.replyHeight) ? clampReplyHeight(saved.replyHeight) : DEFAULT_REPLY_HEIGHT,
    };
  } catch {
    return { "quick-replies": false, images: false, activeReplyFolder: null, activeImageFolder: null, replyHeight: DEFAULT_REPLY_HEIGHT };
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
  const [clips, setClips] = useState<QuickMedia[]>([]);
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | QuickMedia["kind"]>("all");
  const [clipPreview, setClipPreview] = useState<{ item: QuickMedia; url: string } | null>(null);
  const [confirmClipDelete, setConfirmClipDelete] = useState(false);
  const [clipPlaybackFailed, setClipPlaybackFailed] = useState(false);
  const clipDialog = useRef<HTMLDialogElement>(null);
  const clipLoading = useRef(0);
  const insertingMedia = useRef(false);
  const [insertingClip, setInsertingClip] = useState(false);
  const currentChat = useRef(chatId);
  currentChat.current = chatId;
  const [imageCategories, setImageCategories] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imagePreview, setImagePreview] = useState<LibraryImage | null>(null);
  const [imageSaveError, setImageSaveError] = useState("");
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [importingImages, setImportingImages] = useState(false);
  const [mediaImportFailures, setMediaImportFailures] = useState<string[]>([]);
  const [replyEditor, setReplyEditor] = useState<ReplyEditor | null>(null);
  const [actionMenu, setActionMenu] = useState<ShelfActionMenu | null>(null);
  const [collapsed, setCollapsed] = useState<ShelfCollapseState>(readCollapseState);
  const [resizingReplies, setResizingReplies] = useState(false);
  const [replyPageState, setReplyPage] = useState({ key: "", page: 0 });
  const [mediaPageState, setMediaPage] = useState({ key: "", page: 0 });
  const replyResize = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const imageStripRefs = useRef(new Map<string, HTMLDivElement>());
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const replyInsertClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushToast = useAppStore(state => state.pushToast);
  const sendChannel = useAppStore(state => state.settings?.sendChannel);
  const exceedsAndroidLimit = (item: { size?: number }) => sendChannel === "android_bridge" && (item.size ?? 0) > ANDROID_MEDIA_MAX_BYTES;
  const requestConfirm = useAppStore(state => state.requestConfirm);
  const replyGroups = useMemo(() => {
    const groups = new Map<string, SettingsQuickReply[]>();
    for (const reply of quickReplies) {
      if (!groups.has(reply.category)) groups.set(reply.category, []);
      groups.get(reply.category)!.push(reply);
    }
    return flattenQuickReplyCategories(categories)
    .map(({ category, depth }) => ({
      category,
      depth,
      replies: groups.get(category.id) || [],
    }))
    .filter(group => group.replies.length > 0);
  }, [categories, quickReplies]);
  const imageGroups = useMemo(() => {
    const groups = new Map<string, LibraryImage[]>();
    groups.set("", []);
    for (const folder of imageCategories) if (!groups.has(folder)) groups.set(folder, []);
    for (const image of images) {
      if (!groups.has(image.category)) groups.set(image.category, []);
      groups.get(image.category)!.push(image);
    }
    return [...groups.entries()];
  }, [imageCategories, images]);
  const activeReplyGroup = replyGroups.find(group => group.category.id === collapsed.activeReplyFolder) || replyGroups[0];
  const activeImageGroup = imageGroups.find(([folder]) => folder === collapsed.activeImageFolder) || imageGroups[0];
  const replyKey = activeReplyGroup?.category.id || "";
  const replyPageCount = Math.max(1, Math.ceil((activeReplyGroup?.replies.length || 0) / REPLIES_PER_PAGE));
  const replyPage = replyPageState.key === replyKey ? Math.min(replyPageState.page, replyPageCount - 1) : 0;
  const mediaKey = `${mediaFilter}:${mediaFilter === "image" ? activeImageGroup?.[0] || "" : ""}`;
  const mediaImages = mediaFilter === "all" ? images : mediaFilter === "image" ? activeImageGroup?.[1] || [] : [];
  const mediaClips = useMemo(() => mediaFilter === "all"
    ? [...clips.filter(item => item.kind === "audio"), ...clips.filter(item => item.kind === "video")]
    : clips.filter(item => item.kind === mediaFilter), [clips, mediaFilter]);
  const mediaPageCount = Math.max(1, Math.ceil((mediaImages.length + mediaClips.length) / MEDIA_PER_PAGE));
  const mediaPage = mediaPageState.key === mediaKey ? Math.min(mediaPageState.page, mediaPageCount - 1) : 0;
  const start = mediaPage * MEDIA_PER_PAGE;
  const end = start + MEDIA_PER_PAGE;
  const visibleImages = mediaImages.slice(start, end);
  const visibleClips = mediaClips.slice(Math.max(0, start - mediaImages.length), Math.max(0, end - mediaImages.length));
  const visibleAudio = visibleClips.filter(item => item.kind === "audio");
  const visibleVideo = visibleClips.filter(item => item.kind === "video");
  const stackAudio = visibleAudio.length > 1 && (visibleImages.length > 0 || visibleVideo.length > 0);
  const mediaColumnCount = visibleImages.length + visibleVideo.length + (stackAudio ? Math.ceil(visibleAudio.length / 2) : visibleAudio.length);
  const stripKey = activeImageGroup?.[0] || "";

  useEffect(() => {
    if (!hasImages || !isTauri()) return;
    let active = true;
    const load = () => void listQuickMedia().then(items => { if (active) setClips(items); })
      .catch(error => { if (active) pushToast(String(error), "error"); });
    load();
    window.addEventListener(QUICK_MEDIA_CHANGED, load);
    return () => { active = false; window.removeEventListener(QUICK_MEDIA_CHANGED, load); };
  }, [hasImages, pushToast]);

  useEffect(() => {
    if (!clipPreview) return;
    const dialog = clipDialog.current;
    dialog?.showModal();
    return () => { dialog?.close(); URL.revokeObjectURL(clipPreview.url); };
  }, [clipPreview]);

  useEffect(() => () => { clipLoading.current++; }, []);

  async function openClip(item: QuickMedia) {
    const request = ++clipLoading.current;
    try {
      const file = await readQuickMedia(item);
      if (request !== clipLoading.current) return;
      setConfirmClipDelete(false);
      setClipPlaybackFailed(false);
      setClipPreview({ item, url: URL.createObjectURL(file) });
    } catch (error) { pushToast(String(error), "error"); }
  }

  async function insertClip(item: QuickMedia) {
    if (!chatId || !canSendReply || insertingMedia.current) return;
    if (exceedsAndroidLimit(item)) { pushToast(t("quickMedia.androidFileTooLarge"), "error"); return; }
    insertingMedia.current = true;
    setInsertingClip(true);
    try {
      const file = await readQuickMedia(item);
      if (chatId !== currentChat.current) return;
      if (useAppStore.getState().settings?.sendChannel === "android_bridge" && file.size > ANDROID_MEDIA_MAX_BYTES) {
        pushToast(t("quickMedia.androidFileTooLarge"), "error");
        return;
      }
      if (!emitQuickReplyMedia({ file, dataUrl: "", fileName: item.title, mimeType: item.mime, kind: item.kind, token: crypto.randomUUID(), target: "main", chatId })) {
        pushToast(t("quickShelf.insertUnavailable"), "info");
        return;
      }
      setClipPreview(null);
      pushToast(t("quickShelf.mediaInserted"), "success");
    } catch (error) { pushToast(String(error), "error"); }
    finally { insertingMedia.current = false; setInsertingClip(false); }
  }

  useEffect(() => {
    if (resizingReplies) return;
    try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed)); } catch { /* UI preference only. */ }
  }, [collapsed, resizingReplies]);

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
    if (current.reduce((bytes, item) => bytes + (item.id === reply.id ? 0 : item.media?.size || 0), 0) + (reply.media?.size || 0) > MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES) {
      pushToast(t("quickLibrary.mediaCapacity"), "error"); return;
    }
    const options = getQuickReplyCategories(store.settings.quickReplyCustomCategories, store.settings.quickReplyRemovedCategories, store.settings.quickReplyCategoryLabels, store.settings.quickReplyCategoryOrder);
    const category = options.some(item => item.id === reply.category) ? reply.category : "other";
    const titleSource = reply.body || reply.translation || reply.media?.fileName || t("quickLibrary.newReply");
    const title = reply.title.trim() || titleSource.trim().split(/\r?\n/, 1)[0];
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

  const addMedia = async (files: File[]) => {
    if (!files.length || importingImages) return;
    setImportingImages(true);
    try {
      let added = 0, duplicates = 0;
      const failures: string[] = [];
      const addedKinds = new Set<"image" | "audio" | "video">();
      setMediaImportFailures([]);
      const category = activeImageGroup?.[0] ?? "";
      for (const file of files) {
        try {
          const mime = quickMediaFileType(file);
          const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "video";
          const saved = kind === "image" ? (await addLibraryImage(file, category)).added : await addQuickMedia(file);
          if (saved) { added++; addedKinds.add(kind); } else duplicates++;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const message = reason === "quickMedia.fileTooLarge" || reason === "quickMedia.unsupportedFile" || reason === "quickMedia.emptyFile"
            ? t(reason) : reason;
          failures.push(`${file.name} · ${message}`);
        }
      }
      setMediaImportFailures(failures);
      if (addedKinds.size) setMediaFilter(current => current === "all" || addedKinds.has(current) ? current : addedKinds.size === 1 ? [...addedKinds][0] : "all");
      window.dispatchEvent(new Event("wap:image-library"));
      pushToast(failures.length === 1 && files.length === 1 ? failures[0] : t("quickMedia.importResult", { added, duplicates, failures: failures.length }), failures.length === files.length ? "error" : "success");
    } finally {
      setImportingImages(false);
    }
  };

  useEffect(() => {
    if (!hasImages || !isTauri()) return;
    let stopped = false;
    let generation = 0;
    const load = async (event?: Event) => {
      const request = ++generation;
      try {
        const [next, folderNames] = await Promise.all([listLibraryImages(true, event), listLibraryCategories(event).catch(() => [])]);
        if (!stopped && request === generation) { setImages(next); setImageCategories(folderNames); setImageError(""); }
      } catch (error) {
        if (!stopped && request === generation) setImageError(String(error));
      } finally {
        if (!stopped && request === generation) setLoadingImages(false);
      }
    };
    setLoadingImages(true);
    void load();
    window.addEventListener("wap:image-library", load);
    return () => { stopped = true; window.removeEventListener("wap:image-library", load); };
  }, [hasImages]);

  const insertImage = async (image: LibraryImage) => {
    if (!chatId || busyImageId || insertingMedia.current) return;
    insertingMedia.current = true;
    setBusyImageId(image.id);
    try {
      const dataUrl = await readLibraryImage(image.id);
      if (chatId !== currentChat.current) return;
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
      insertingMedia.current = false;
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
  const pageControls = (page: number, count: number, setPage: (page: number) => void, label: string) => <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5 text-2xs">
    <button type="button" aria-label={t("quickLibrary.previousPage")} disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded p-1 hover:bg-zinc-800 disabled:opacity-40"><ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" /></button>
    <span className="tabular-nums">{page + 1}/{count}</span>
    <button type="button" aria-label={t("quickLibrary.nextPage")} disabled={page + 1 === count} onClick={() => setPage(page + 1)} className="rounded p-1 hover:bg-zinc-800 disabled:opacity-40"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></button>
  </div>;
  if (!tabs.length) return null;

  return <div className="mb-1.5 flex max-h-[min(50dvh,36rem)] min-h-0 flex-col space-y-1 overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-2">
    {tabs.includes("quick-replies") && <section className="flex min-h-0 flex-1 flex-col">
      {!collapsed["quick-replies"] && !!activeReplyGroup?.replies.length && <div role="separator" aria-orientation="horizontal" aria-label={t("composerShelf.resizeReplies")} title={t("composerShelf.resizeReplies")} tabIndex={0}
        aria-valuemin={MIN_REPLY_HEIGHT} aria-valuemax={MAX_REPLY_HEIGHT} aria-valuenow={collapsed.replyHeight}
        className="group -mt-1 flex h-3 shrink-0 touch-none cursor-row-resize items-center justify-center rounded hover:bg-brand/10 focus-visible:bg-brand/10"
        onPointerDown={event => {
          if (event.button !== 0 || replyResize.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          replyResize.current = { pointerId: event.pointerId, y: event.clientY, height: collapsed.replyHeight };
          setResizingReplies(true);
        }} onPointerMove={event => {
          const start = replyResize.current;
          if (start?.pointerId !== event.pointerId) return;
          const height = clampReplyHeight(start.height + start.y - event.clientY);
          setCollapsed(current => current.replyHeight === height ? current : { ...current, replyHeight: height });
        }} onLostPointerCapture={event => {
          if (replyResize.current?.pointerId === event.pointerId) {
            replyResize.current = null;
            setResizingReplies(false);
          }
        }} onKeyDown={event => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const delta = event.key === "ArrowUp" ? 36 : -36;
          setCollapsed(current => ({ ...current, replyHeight: clampReplyHeight(current.replyHeight + delta) }));
        }}>
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-zinc-600 group-hover:bg-brand group-focus-visible:bg-brand" />
      </div>}
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
          {!collapsed["quick-replies"] && replyPageCount > 1 && pageControls(replyPage, replyPageCount, page => setReplyPage({ key: replyKey, page }), t("crmPanel.quickReplies"))}
          <button type="button" aria-haspopup="menu" aria-expanded={actionMenu?.kind === "reply"} aria-label={t("quickShelf.actions")} title={t("quickShelf.actions")} onClick={event => openActionMenu("reply", event)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={t("settingsQuickReplies.add")} title={t("settingsQuickReplies.add")} onClick={addReply} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-brand"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={t("composerShelf.hidePanel", { panel: t("crmPanel.quickReplies") })} title={t("composerShelf.hidePanel", { panel: t("crmPanel.quickReplies") })} onClick={() => onToggleTab("quick-replies")} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
      </header>
      {!collapsed["quick-replies"] && (activeReplyGroup?.replies.length ? <div key={`${replyKey}:${replyPage}`} className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: collapsed.replyHeight }}><div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))" }}>
              {activeReplyGroup.replies.slice(replyPage * REPLIES_PER_PAGE, (replyPage + 1) * REPLIES_PER_PAGE).map(reply => {
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
      <input ref={imageInputRef} type="file" className="hidden" accept="image/png,image/jpeg,image/gif,image/webp,audio/*,video/*,.m4a,.opus,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp" multiple aria-label={t("quickMedia.add")} onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void addMedia(files); }} />
      <header className={`flex min-w-0 items-start gap-2 text-[11px] font-semibold text-zinc-300 ${collapsed.images ? "" : "mb-1.5"}`}>
        <div role="group" aria-label={t("quickMedia.title")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" aria-expanded={!collapsed.images} aria-label={t(collapsed.images ? "composerShelf.expandPanel" : "composerShelf.collapsePanel", { panel: t("quickMedia.title") })} title={t(collapsed.images ? "composerShelf.expandPanel" : "composerShelf.collapsePanel", { panel: t("quickMedia.title") })} onClick={() => toggleSection("images")} className="flex shrink-0 items-center gap-1.5 rounded py-1 text-left hover:text-zinc-100">
            {collapsed.images ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            <span>{t("quickMedia.title")}</span><span className="font-normal text-zinc-500">{images.length + clips.length}</span>
          </button>
          {!collapsed.images && (mediaFilter === "all" || mediaFilter === "image") && imageGroups.map(([folder, items]) => {
            const selected = mediaFilter === "image" && activeImageGroup?.[0] === folder;
            return <button key={folder || "__uncategorized__"} type="button" aria-pressed={selected} onClick={() => {
              setCollapsed(current => ({ ...current, activeImageFolder: folder }));
              setMediaFilter("image");
            }} className={`shrink-0 rounded-md px-2 py-1 font-medium transition-colors ${selected ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}>
              {folder || t("gallery.uncategorized")} <span className="ml-0.5 text-[10px] opacity-70">{items.length}</span>
            </button>;
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!collapsed.images && mediaPageCount > 1 && pageControls(mediaPage, mediaPageCount, page => setMediaPage({ key: mediaKey, page }), t("quickMedia.title"))}
          <button type="button" aria-haspopup="menu" aria-expanded={actionMenu?.kind === "image"} aria-label={t("quickShelf.imageActions")} title={t("quickShelf.imageActions")} onClick={event => openActionMenu("image", event)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={t("quickMedia.add")} title={t("quickMedia.add")} disabled={!isTauri() || importingImages} onClick={() => imageInputRef.current?.click()} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-brand disabled:opacity-40"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
          {!collapsed.images && mediaColumnCount > 5 && <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" aria-label={t("composerShelf.scrollImagesLeft")} onClick={() => scrollImageFolder(stripKey, -420)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label={t("composerShelf.scrollImagesRight")} onClick={() => scrollImageFolder(stripKey, 420)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
          </div>}
          <button type="button" aria-label={t("composerShelf.hidePanel", { panel: t("quickMedia.title") })} title={t("composerShelf.hidePanel", { panel: t("quickMedia.title") })} onClick={() => onToggleTab("images")} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
      </header>
      {!collapsed.images && loadingImages && <p role="status" className="py-1 text-xs text-zinc-500">{t("gallery.loading")}</p>}
      {!collapsed.images && importingImages && <p role="status" className="py-1 text-xs text-zinc-500">{t("quickMedia.importing")}</p>}
      {!collapsed.images && mediaImportFailures.length > 0 && <ul role="alert" className="max-h-20 overflow-auto break-words py-1 text-xs text-rose-400">
        {mediaImportFailures.map((failure, index) => <li key={index}>{failure}</li>)}
      </ul>}
      {!collapsed.images && imageError && <p role="alert" className="py-1 text-xs text-rose-400">{imageError}</p>}
      {!collapsed.images && <div role="group" aria-label={t("quickMedia.filter")} className="mb-1 flex gap-1">
        {(["all", "image", "audio", "video"] as const).map(kind => <button key={kind} type="button" aria-pressed={mediaFilter === kind}
          onClick={() => setMediaFilter(kind)} className={`rounded px-2 py-0.5 text-[11px] ${mediaFilter === kind ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-800"}`}>
          {t(`quickMedia.${kind}`)}
        </button>)}
      </div>}
      {!collapsed.images && !loadingImages && !imageError && !visibleImages.length && !visibleClips.length && <p className="py-1 text-xs text-zinc-500">{t("quickMedia.empty")}</p>}
      {!collapsed.images && <div key={`${mediaKey}:${mediaPage}`} ref={element => { if (element) imageStripRefs.current.set(stripKey, element); else imageStripRefs.current.delete(stripKey); }} className="flex gap-1.5 overflow-x-auto pb-1">
        {visibleImages.map(image => <article key={image.id} className="group relative w-fit max-w-28 shrink-0 p-0.5">
          <button type="button" disabled={busyImageId !== null} onClick={() => { setImageSaveError(""); setImagePreview(image); }} title={t("gallery.rename") + " · " + image.title} aria-label={t("quickShelf.previewNamed", { title: image.title })} className="relative block w-fit pb-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50">
            <LibraryThumbnail image={image} alt="" className="block h-auto w-auto max-h-20 max-w-28 rounded-md object-contain" />
            <span className="absolute inset-x-0 bottom-0 truncate px-0.5 text-[10px] font-medium text-zinc-200">{image.title}</span>
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 text-white opacity-0 drop-shadow group-hover:opacity-100 group-focus-within:opacity-100"><Pencil className="h-3 w-3" /></span>
          </button>
          <button type="button" disabled={!chatId || busyImageId !== null || insertingClip} onClick={event => { if (event.detail <= 1) void insertImage(image); }} title={t("quickShelf.insertImageNamed", { title: image.title })} aria-label={t("quickShelf.insertImageNamed", { title: image.title })} className="absolute bottom-6 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/85 text-brand hover:bg-zinc-900 disabled:opacity-50"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </article>)}
        {!!visibleAudio.length && <div className={stackAudio ? "grid shrink-0 auto-cols-max grid-flow-col grid-rows-2 gap-1.5 self-stretch" : "flex shrink-0 gap-1.5 self-start"}>
        {visibleAudio.map(item => <article key={item.id} className="flex w-36 shrink-0 items-center gap-1 rounded-md bg-zinc-800/60 p-1">
          <button type="button" onClick={() => void openClip(item)} title={item.title}
            aria-label={t("quickShelf.previewNamed", { title: item.title })}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left">
            <Play aria-hidden="true" className="m-1 h-4 w-4 shrink-0 text-brand" />
            <span className="min-w-0">
              <span className="block truncate text-[11px] leading-4">{item.title}</span>
              {item.duration !== undefined && <span className="block text-[10px] tabular-nums text-zinc-500">{formatClipDuration(item.duration)}</span>}
            </span>
          </button>
          <button type="button" disabled={!chatId || !canSendReply || insertingClip || busyImageId !== null} onClick={event => { if (event.detail <= 1) void insertClip(item); }}
            aria-label={t("quickMedia.insert", { title: item.title })} title={exceedsAndroidLimit(item) ? t("quickMedia.androidFileTooLarge") : t("quickMedia.insert", { title: item.title })}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-brand hover:bg-zinc-700 disabled:opacity-50"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </article>)}
        </div>}
        {visibleVideo.map(item => <article key={item.id} className="relative w-28 shrink-0 rounded-md bg-zinc-800/60">
          <button type="button" onClick={() => void openClip(item)} title={item.title} aria-label={t("quickShelf.previewNamed", { title: item.title })}
            className="flex h-[82px] w-full flex-col justify-end overflow-hidden rounded-md text-left">
            {item.thumbnail ? <img src={item.thumbnail} alt="" className="absolute inset-0 h-full w-full rounded-md object-cover" /> : <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 text-brand" />}
            {item.duration !== undefined && <span className="absolute right-1 top-1 rounded bg-black/65 px-1 text-[10px] text-white">{formatClipDuration(item.duration)}</span>}
            <span className="relative w-full truncate bg-zinc-900/85 px-1 py-0.5 text-[10px]">{item.title}</span>
          </button>
          <button type="button" disabled={!chatId || !canSendReply || insertingClip || busyImageId !== null} onClick={event => { if (event.detail <= 1) void insertClip(item); }}
            aria-label={t("quickMedia.insert", { title: item.title })} title={exceedsAndroidLimit(item) ? t("quickMedia.androidFileTooLarge") : t("quickMedia.insert", { title: item.title })}
            className="absolute bottom-5 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/85 text-brand disabled:opacity-50"><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </article>)}
      </div>}
    </section>}
    {clipPreview && createPortal(<dialog ref={clipDialog} aria-label={clipPreview.item.title}
      onCancel={event => { event.preventDefault(); setClipPreview(null); }}
      className="m-auto w-[min(92vw,36rem)] rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 backdrop:bg-black/60">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate font-medium" title={clipPreview.item.title}>{clipPreview.item.title}</h2>
        <Button size="xs" onClick={() => setClipPreview(null)}>{t("common.close")}</Button>
      </header>
      {clipPlaybackFailed && <p role="status" className="text-sm text-amber-500">{t("quickShelf.previewUnavailable")}</p>}
      {clipPreview.item.kind === "video"
        ? <video className="max-h-[55vh] w-full" src={clipPreview.url} controls preload="metadata" onError={() => setClipPlaybackFailed(true)} />
        : <audio className="w-full" src={clipPreview.url} controls preload="metadata" onError={() => setClipPlaybackFailed(true)} />}
      <footer className="mt-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={() => {
          if (!confirmClipDelete) { setConfirmClipDelete(true); return; }
          void removeQuickMedia(clipPreview.item.id).then(() => setClipPreview(null)).catch(error => pushToast(String(error), "error"));
        }}>{t(confirmClipDelete ? "common.confirm" : "common.delete")}</Button>
        <Button size="sm" variant="primary" disabled={!chatId || !canSendReply || insertingClip || busyImageId !== null} onClick={() => void insertClip(clipPreview.item)}>
          {t("quickMedia.insert", { title: clipPreview.item.title })}
        </Button>
      </footer>
    </dialog>, document.body)}
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
