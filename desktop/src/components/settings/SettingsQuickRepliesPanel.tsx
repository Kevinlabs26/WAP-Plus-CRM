import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { baileysRemoveQuickReply, baileysSyncQuickReplies } from "@/lib/baileys";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { filterQuickReplies, getQuickReplyCategories, QUICK_REPLY_CATEGORIES, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_CATEGORIES, MAX_QUICK_REPLY_MEDIA_BYTES, MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES } from "@/lib/quickReplies";
import { parseQuickReplyTable } from "@/lib/quickReplyImport";
import type { AppSettings } from "@/store/appStore";
import { useI18n, type TranslationKey } from "@/i18n";

type QuickReply = AppSettings["quickReplies"][number];

const TEMPLATE_KEYS: { title: TranslationKey; body: TranslationKey; category: QuickReply["category"] }[] = [
  {
    title: "settingsQuickReplies.template.greeting.title",
    body: "settingsQuickReplies.template.greeting.body",
    category: "opening",
  },
  {
    title: "settingsQuickReplies.template.requirements.title",
    body: "settingsQuickReplies.template.requirements.body",
    category: "quote",
  },
  {
    title: "settingsQuickReplies.template.followUp.title",
    body: "settingsQuickReplies.template.followUp.body",
    category: "follow-up",
  },
];

export function SettingsQuickRepliesPanel() {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const connection = useAppStore((state) => state.baileysUi.connection);
  const pushToast = useAppStore((state) => state.pushToast);
  const [busy, setBusy] = useState(false);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [listCategory, setListCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [bulkCategory, setBulkCategory] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaRequests = useRef(new Map<string, symbol>());
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replies = settings.quickReplies || [];
  const customCategories = settings.quickReplyCustomCategories || [];
  const categoryOptions = getQuickReplyCategories(customCategories);
  const visibleReplies = useMemo(() => filterQuickReplies(replies, listCategory, listQuery), [listCategory, listQuery, replies]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visibleReplies.length / 50) - 1));
  const pageReplies = visibleReplies.slice(currentPage * 50, (currentPage + 1) * 50);
  const editing = visibleReplies.find(reply => reply.id === selectedId) || pageReplies[0];
  const categoryLabel = (id: string) => QUICK_REPLY_CATEGORIES.some(item => item.id === id)
    ? t(`quickReply.category.${id}` as TranslationKey) : categoryOptions.find(item => item.id === id)?.label || id;
  const importPreview = useMemo(() => {
    try { return { ...parseQuickReplyTable(importText), error: false }; }
    catch { return { rows: [], invalidRows: [], error: true }; }
  }, [importText]);
  useEffect(() => { setSelectedIds(new Set()); }, [listCategory, listQuery]);
  useEffect(() => {
    if (listCategory !== "all" && !categoryOptions.some(item => item.id === listCategory)) setListCategory("all");
  }, [listCategory, settings.quickReplyCustomCategories]);
  const accountId =
    settings.liveBaileysAccountId || settings.activeAccountId || null;
  const connected = isWaAccountConnected(
    settings.waAccounts,
    accountId,
    settings.liveBaileysAccountId,
    connection
  );

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      mediaRequests.current.clear();
    };
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-100">{t("settingsQuickReplies.title")}</h3>
            <SaveBadge state={saveHint} />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {t("settingsQuickReplies.description")}
          </p>
          <p className="mt-1 text-2xs text-zinc-600">
            {t("settingsQuickReplies.mediaOnlyLocal")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm" className="text-2xs"
              disabled={replies.length >= MAX_QUICK_REPLIES}
              onClick={() => addReply()}
            >
              {t("settingsQuickReplies.add")}
            </Button>
            <Button size="sm" onClick={() => setImportOpen(open => !open)}>{t("quickLibrary.import")}</Button>
            <Button
              variant="secondary"
              size="sm" className="text-2xs"
              onClick={() => setCategoriesOpen((open) => !open)}
            >
              {t("settingsQuickReplies.manageCategories")}
            </Button>
            <Button
              variant="secondary"
              size="sm" className="text-2xs"
              disabled={busy || !connected || replies.length === 0}
              title={
                !connected
                  ? t("settingsQuickReplies.connectFirst")
                  : replies.length === 0
                    ? t("settingsQuickReplies.nothingToSync")
                    : t("settingsQuickReplies.syncHint")
              }
              onClick={() => void syncReplies()}
            >
              {busy ? t("settingsQuickReplies.syncing") : t("settingsQuickReplies.sync")}
            </Button>
          </div>
          {!connected && (
            <p className="max-w-[220px] text-right text-2xs leading-snug text-zinc-600">
              {t("settingsQuickReplies.connectFirst")}
            </p>
          )}
        </div>
      </header>

      {categoriesOpen && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionLabel>{t("settingsQuickReplies.categoryList")}</SectionLabel>
            <span className="text-2xs text-zinc-600">{customCategories.length} / {MAX_QUICK_REPLY_CATEGORIES}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newCategory}
              maxLength={32}
              placeholder={t("settingsQuickReplies.categoryPlaceholder")}
              aria-label={t("settingsQuickReplies.categoryPlaceholder")}
              onChange={(event) => setNewCategory(event.target.value)}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!newCategory.trim() || customCategories.length >= MAX_QUICK_REPLY_CATEGORIES}
              onClick={() => {
                const label = newCategory.trim();
                if (!label) return;
                const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
                updateSettings({
                  quickReplyCustomCategories: [...customCategories, { id, label }],
                });
                setNewCategory("");
                markSavedSoon();
              }}
            >
              {t("settingsQuickReplies.addCategory")}
            </Button>
          </div>
          {customCategories.length > 0 && (
            <div className="mt-3 space-y-2">
              {customCategories.map((category) => (
                <div key={category.id} className="flex items-center gap-2">
                  <Input
                    value={category.label}
                    maxLength={32}
                    aria-label={category.label}
                    onChange={(event) => {
                      const label = event.target.value;
                      updateSettings({
                        quickReplyCustomCategories: customCategories.map((item) =>
                          item.id === category.id ? { ...item, label } : item
                        ),
                      });
                      markSavedSoon();
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-2xs text-zinc-500"
                    onClick={() => {
                      const used = replies.some((reply) => reply.category === category.id);
                      if (used) {
                        pushToast(t("settingsQuickReplies.categoryInUse"), "info");
                        return;
                      }
                      updateSettings({
                        quickReplyCustomCategories: customCategories.filter((item) => item.id !== category.id),
                      });
                      markSavedSoon();
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {importOpen && (
        <section className="space-y-3 rounded-xl border border-zinc-800 p-4">
          <SectionLabel>{t("quickLibrary.import")}</SectionLabel>
          <p className="text-xs text-zinc-500">{t("quickLibrary.importHint")}</p>
          <Textarea rows={5} maxLength={3_000_000} value={importText} aria-label={t("quickLibrary.import")}
            onChange={event => setImportText(event.target.value)} />
          <p role="status" className="text-xs text-zinc-500">
            {importPreview.error ? t("quickLibrary.importError") : importPreview.invalidRows.length
              ? t("quickLibrary.invalidRows", { rows: importPreview.invalidRows.slice(0, 10).join(", ") })
              : t("quickLibrary.importReady", { count: importPreview.rows.length })}
          </p>
          <Button variant="primary" disabled={importPreview.error || !!importPreview.invalidRows.length || !importPreview.rows.length}
            onClick={importReplies}>{t("quickLibrary.confirmImport")}</Button>
        </section>
      )}
      <section className="grid overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/35 lg:grid-cols-[160px_minmax(240px,0.85fr)_minmax(300px,1.2fr)]">
        <nav aria-label={t("settingsQuickReplies.category")} className="space-y-1 border-b border-zinc-800 p-3 lg:max-h-[720px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <SectionLabel>{t("settingsQuickReplies.category")}</SectionLabel>
          {[{ id: "all", label: t("starred.all") }, ...categoryOptions].map(category => (
            <button key={category.id} type="button" aria-pressed={listCategory === category.id}
              onClick={() => { setListCategory(category.id); setPage(0); }}
              className={"flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs " + (listCategory === category.id ? "bg-brand/15 text-brand" : "text-zinc-400 hover:bg-zinc-800/50")}>
              <span className="truncate">{category.id === "all" ? category.label : categoryLabel(category.id)}</span>
              <span className="text-2xs opacity-70">{category.id === "all" ? replies.length : replies.filter(item => item.category === category.id).length}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col border-b border-zinc-800 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-zinc-800 p-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <SectionLabel>{t("settingsQuickReplies.list")}</SectionLabel><span>{replies.length} / {MAX_QUICK_REPLIES}</span>
            </div>
            <Input value={listQuery} onChange={event => { setListQuery(event.target.value); setPage(0); }}
              placeholder={t("multi.searchQuickReplies")} aria-label={t("multi.searchQuickReplies")} />
            {!!pageReplies.length && <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={pageReplies.every(reply => selectedIds.has(reply.id))}
                onChange={event => { const next = new Set(selectedIds); pageReplies.forEach(reply => event.target.checked ? next.add(reply.id) : next.delete(reply.id)); setSelectedIds(next); }} />
              {t("quickLibrary.selectPage")} · {selectedIds.size}
            </label>}
            {!!selectedIds.size && <div className="flex flex-wrap gap-2">
              <select value={bulkCategory} onChange={event => setBulkCategory(event.target.value)} aria-label={t("quickLibrary.moveTo")}
                className="ui-control min-w-0 flex-1 px-2 text-xs">
                <option value="">{t("quickLibrary.moveTo")}</option>
                {categoryOptions.map(category => <option key={category.id} value={category.id}>{categoryLabel(category.id)}</option>)}
              </select>
              <Button size="sm" disabled={!bulkCategory} onClick={moveSelected}>{t("quickLibrary.move")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>{t("common.cancel")}</Button>
            </div>}
          </div>
          <div className="max-h-[540px] min-h-[200px] flex-1 overflow-y-auto p-2">
            {pageReplies.map(reply => <div key={reply.id} className={"mb-1 flex items-start gap-2 rounded-lg p-2 " + (editing?.id === reply.id ? "bg-brand/10" : "hover:bg-zinc-800/40")}>
              <input type="checkbox" className="mt-1" aria-label={t("quickLibrary.selectReply", { title: reply.title })} checked={selectedIds.has(reply.id)}
                onChange={event => { const next = new Set(selectedIds); event.target.checked ? next.add(reply.id) : next.delete(reply.id); setSelectedIds(next); }} />
              <button type="button" className="min-w-0 flex-1 text-left" aria-pressed={editing?.id === reply.id} onClick={() => setSelectedId(reply.id)}>
                <span className="block truncate text-sm font-medium text-zinc-200">{reply.title || t("quickLibrary.newReply")}</span>
                <span className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-zinc-500">{reply.body || reply.media?.fileName || t("settingsQuickReplies.contentPlaceholder")}</span>
                <span className="mt-1 block truncate text-2xs text-zinc-500">{categoryLabel(reply.category)}{reply.media ? " · " + reply.media.fileName : ""}</span>
              </button>
            </div>)}
            {!pageReplies.length && <div className="space-y-3 p-4 text-center text-xs text-zinc-500">
              <p>{t(replies.length ? "crmPanel.noMatchingReplies" : "settingsQuickReplies.empty")}</p>
              {!replies.length && <Button size="sm" onClick={applyTemplates}>{t("settingsQuickReplies.applyTemplates")}</Button>}
            </div>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-3 text-xs text-zinc-500">
            <Button size="sm" disabled={!currentPage} aria-label={t("quickLibrary.previousPage")} onClick={() => setPage(currentPage - 1)}>‹</Button>
            <span>{currentPage + 1} / {Math.max(1, Math.ceil(visibleReplies.length / 50))} · {visibleReplies.length}</span>
            <Button size="sm" disabled={(currentPage + 1) * 50 >= visibleReplies.length} aria-label={t("quickLibrary.nextPage")} onClick={() => setPage(currentPage + 1)}>›</Button>
          </div>
        </div>
        <div className="min-w-0 p-4">
          {editing ? <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>{t("quickLibrary.edit")}</SectionLabel>
              <div className="flex gap-1">
                <Button size="sm" disabled={replies.length >= MAX_QUICK_REPLIES} onClick={() => addReply(editing)}>{t("settingsQuickReplies.duplicate")}</Button>
                {confirmDeleteId === editing.id ? <>
                  <Button size="sm" className="text-rose-400" onClick={() => void removeReply(editing.id)}>{t("settingsQuickReplies.confirmDelete")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>{t("common.cancel")}</Button>
                </> : <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(editing.id)}>{t("common.delete")}</Button>}
              </div>
            </div>
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.commandTitle")}</span>
              <Input maxLength={40} value={editing.title} aria-label={t("settingsQuickReplies.commandTitle")} onChange={event => updateReply(editing.id, { title: event.target.value })} />
            </label>
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.category")}</span>
              <select value={editing.category} aria-label={t("settingsQuickReplies.category")} className="ui-control w-full px-2 text-sm" onChange={event => updateReply(editing.id, { category: event.target.value })}>
                {categoryOptions.map(category => <option key={category.id} value={category.id}>{categoryLabel(category.id)}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.content")} · {editing.body.length} / 2000</span>
              <Textarea rows={10} maxLength={2000} value={editing.body} aria-label={t("settingsQuickReplies.content")} placeholder={t("settingsQuickReplies.contentPlaceholder")}
                className="resize-y" onChange={event => updateReply(editing.id, { body: event.target.value })} />
            </label>
            {editing.media && <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
              {editing.media.kind === "image" ? <img src={editing.media.dataUrl} alt={editing.media.fileName} className="max-h-60 w-full rounded object-contain" />
                : editing.media.kind === "audio" ? <audio src={editing.media.dataUrl} controls className="w-full" />
                : editing.media.kind === "video" ? <video src={editing.media.dataUrl} controls className="max-h-60 w-full rounded" /> : null}
              <p className="break-all text-xs text-zinc-400">{editing.media.fileName} · {(editing.media.size / 1024 / 1024).toFixed(2)} MB</p>
              <Button size="sm" variant="ghost" onClick={() => removeMedia(editing.id)}>{t("settingsQuickReplies.removeMedia")}</Button>
            </div>}
            <input ref={fileInput} type="file" className="hidden" aria-label={t("settingsQuickReplies.addMedia")}
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
              onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void attachMedia(editing.id, file); }} />
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              {editing.media ? t("settingsQuickReplies.replaceMedia") : t("settingsQuickReplies.addMedia")}
            </Button>
            {mediaBusyId === editing.id && <p role="status" className="text-xs text-brand">{t("quickLibrary.readingMedia")}</p>}
            <p className="text-xs text-zinc-500">{t("settingsQuickReplies.mediaHint")} · {t("quickLibrary.mediaCapacity")}</p>
          </div> : <p className="py-12 text-center text-sm text-zinc-500">{t("quickLibrary.chooseReply")}</p>}
        </div>
      </section>
    </div>
  );

  function markSavedSoon() {
    setSaveHint("saving");
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      setSaveHint("saved");
      hintTimer.current = setTimeout(() => setSaveHint("idle"), 1600);
    }, 280);
  }

  function commitReplies(next: QuickReply[]) {
    if (next.length > MAX_QUICK_REPLIES) { pushToast(t("settingsQuickReplies.limit"), "info"); return false; }
    if (next.reduce((bytes, reply) => bytes + (reply.media?.size || 0), 0) > MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES) {
      pushToast(t("quickLibrary.mediaCapacity"), "error"); return false;
    }
    updateSettings({ quickReplies: next });
    markSavedSoon();
    return true;
  }

  function updateReply(id: string, patch: Partial<Omit<QuickReply, "id">>) {
    const current = useAppStore.getState().settings.quickReplies || [];
    if (!current.some(item => item.id === id)) return false;
    return commitReplies(current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  async function attachMedia(id: string, file: File) {
    if (file.size > MAX_QUICK_REPLY_MEDIA_BYTES) { pushToast(t("settingsQuickReplies.mediaTooLarge"), "info"); return; }
    const request = Symbol();
    mediaRequests.current.set(id, request);
    setMediaBusyId(id);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reader.onabort = () => reject(reader.error || new Error("read failed"));
        reader.readAsDataURL(file);
      });
      if (mediaRequests.current.get(id) !== request) return;
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(";base64,")) throw new Error("invalid media");
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "file";
      if (updateReply(id, { media: { dataUrl, fileName: file.name.slice(0, 180), mimeType: file.type || "application/octet-stream", kind, size: file.size } })) {
        pushToast(t("settingsQuickReplies.mediaAdded"), "success");
      }
    } catch {
      if (mediaRequests.current.get(id) === request) pushToast(t("settingsQuickReplies.mediaReadFailed"), "error");
    } finally {
      if (mediaRequests.current.get(id) === request) { mediaRequests.current.delete(id); setMediaBusyId(current => current === id ? null : current); }
    }
  }

  function removeMedia(id: string) {
    mediaRequests.current.delete(id);
    setMediaBusyId(current => current === id ? null : current);
    updateReply(id, { media: undefined });
  }

  function addReply(seed?: Omit<QuickReply, "id">) {
    const current = useAppStore.getState().settings.quickReplies || [];
    const item: QuickReply = { id: crypto.randomUUID(), title: seed?.title ?? t("quickLibrary.newReply"), body: seed?.body ?? "",
      category: seed?.category ?? (listCategory === "all" ? "other" : listCategory), media: seed?.media };
    if (commitReplies([...current, item])) {
      setListQuery(""); setListCategory(item.category); setSelectedId(item.id);
      setPage(Math.floor(current.filter(reply => reply.category === item.category).length / 50));
    }
  }

  function applyTemplates() {
    const current = useAppStore.getState().settings.quickReplies || [];
    const stamped = TEMPLATE_KEYS.map(item => ({ id: crypto.randomUUID(), title: t(item.title), body: t(item.body), category: item.category }));
    if (commitReplies([...current, ...stamped])) pushToast(t("settingsQuickReplies.templatesAdded", { count: stamped.length }), "success");
  }

  function moveSelected() {
    if (!categoryOptions.some(category => category.id === bulkCategory)) return;
    const current = useAppStore.getState().settings.quickReplies || [];
    if (commitReplies(current.map(item => selectedIds.has(item.id) ? { ...item, category: bulkCategory } : item))) {
      setSelectedIds(new Set()); setListCategory(bulkCategory); setPage(0);
    }
  }

  function importReplies() {
    if (importPreview.error || importPreview.invalidRows.length || !importPreview.rows.length) return;
    const latest = useAppStore.getState().settings;
    const categories = [...(latest.quickReplyCustomCategories || [])];
    const current = latest.quickReplies || [];
    const categoryIds = new Map<string, string>();
    for (const item of getQuickReplyCategories(categories)) {
      categoryIds.set(item.id.toLocaleLowerCase(), item.id);
      categoryIds.set(item.label.toLocaleLowerCase(), item.id);
      if (QUICK_REPLY_CATEGORIES.some(base => base.id === item.id)) {
        categoryIds.set(t(`quickReply.category.${item.id}` as TranslationKey).toLocaleLowerCase(), item.id);
      }
    }
    const seen = new Set(current.map(item => JSON.stringify([item.title, item.body, item.category])));
    const additions: QuickReply[] = [];
    for (const row of importPreview.rows) {
      let category = row.category ? categoryIds.get(row.category.toLocaleLowerCase()) : (listCategory === "all" ? "other" : listCategory);
      if (!category) {
        if (categories.length >= MAX_QUICK_REPLY_CATEGORIES) { pushToast(t("quickLibrary.categoryLimit"), "error"); return; }
        category = "custom-" + crypto.randomUUID();
        categories.push({ id: category, label: row.category });
        categoryIds.set(row.category.toLocaleLowerCase(), category);
      }
      const key = JSON.stringify([row.title, row.body, category]);
      if (seen.has(key)) continue;
      seen.add(key); additions.push({ id: crypto.randomUUID(), title: row.title, body: row.body, category });
    }
    if (current.length + additions.length > MAX_QUICK_REPLIES) { pushToast(t("settingsQuickReplies.limit"), "error"); return; }
    updateSettings({ quickReplies: [...current, ...additions], quickReplyCustomCategories: categories });
    markSavedSoon(); setImportOpen(false); setImportText(""); setListQuery(""); setListCategory("all");
    if (additions[0]) { setSelectedId(additions[0].id); setPage(Math.floor(current.length / 50)); }
    pushToast(t("quickLibrary.imported", { count: additions.length, skipped: importPreview.rows.length - additions.length }), "success");
  }

  async function removeReply(id: string) {
    setConfirmDeleteId(null);
    if (connected) {
      try { await baileysRemoveQuickReply(id, accountId); }
      catch (error) { pushToast(error instanceof Error ? error.message : t("settingsQuickReplies.deleteFailed"), "error"); return; }
    }
    mediaRequests.current.delete(id);
    const current = useAppStore.getState().settings.quickReplies || [];
    commitReplies(current.filter(reply => reply.id !== id));
    setSelectedIds(ids => { const next = new Set(ids); next.delete(id); return next; });
    pushToast(t("settingsQuickReplies.deleted"), "info");
  }

  async function syncReplies() {
    if (!connected) {
      pushToast(t("settingsQuickReplies.connectFirst"), "error");
      return;
    }
    const items = (useAppStore.getState().settings.quickReplies || []).filter(reply => (!selectedIds.size || selectedIds.has(reply.id)) && reply.body.trim());
    if (items.length > 40) { pushToast(t("quickLibrary.syncLimit"), "info"); return; }
    setBusy(true);
    try {
      // WhatsApp 快捷指令只接受文字；媒体话术仍保留在本机，在聊天输入条中使用。
      const result = await baileysSyncQuickReplies(
        items.map(({ media: _media, ...reply }) => reply),
        accountId
      );
      pushToast(t("settingsQuickReplies.synced", { count: result.synced }), "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : t("settingsQuickReplies.syncFailed"),
        "error"
      );
    } finally {
      setBusy(false);
    }
  }
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" }) {
  const { t } = useI18n();
  if (state === "idle") return null;
  return (
    <span
      className={
        state === "saving"
          ? "rounded-full bg-zinc-800 px-2 py-0.5 text-2xs text-zinc-500"
          : "rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs text-emerald-400/90"
      }
    >
      {state === "saving" ? t("common.saving") : t("settingsQuickReplies.autoSaved")}
    </span>
  );
}
