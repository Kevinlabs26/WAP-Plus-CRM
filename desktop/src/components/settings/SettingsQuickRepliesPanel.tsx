import { useEffect, useMemo, useRef, useState } from "react";

import { useAppStore } from "@/store/appStore";
import { Button, Input, SectionLabel, Textarea } from "@/components/ui/primitives";
import { useDetailsMenu } from "@/components/ui/useDetailsMenu";
import { baileysRemoveQuickReply, baileysSyncQuickReplies } from "@/lib/baileys";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { filterQuickReplies, quickReplyPreviewText, flattenQuickReplyCategories, getQuickReplyCategories, quickReplyCategoryDescendants, QUICK_REPLY_CATEGORIES, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_CATEGORIES, MAX_QUICK_REPLY_MEDIA_BYTES, MAX_QUICK_REPLY_MEDIA_TOTAL_BYTES, type QuickReplySheetLink } from "@/lib/quickReplies";
import { parseQuickReplyTable, quickReplyRowsToTsv, quickReplySheetRowsWithLinks } from "@/lib/quickReplyImport";
import { spreadsheetId } from "@/lib/googleSheetApi";
import { connectSheets, initializeSheets, readSheet, tabRange, useGoogleSheets } from "@/lib/googleSheets";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import { cancelQuickReplySheetSync, removeQuickReplySheetRow, restoreQuickReplySheetRow, scheduleQuickReplySheetSync } from "@/lib/quickReplySheetSync";
import { QuickReplySheetStatus } from "@/components/chat/QuickReplySheetStatus";
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

const sheetImportKey = (values: readonly string[]) => JSON.stringify([values[0] || "", values[1] || "", values[2] || "", values[3] || "", values[4] || ""]);

export function SettingsQuickRepliesPanel({ importOnly = false, defaultCategory = "all", onClose, onImported }: {
  importOnly?: boolean;
  defaultCategory?: string;
  onClose?: () => void;
  onImported?: (categoryIds: string[]) => void;
} = {}) {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const connection = useAppStore((state) => state.baileysUi.connection);
  const sheets = useGoogleSheets();
  const pushToast = useAppStore((state) => state.pushToast);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const [busy, setBusy] = useState(false);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryParent, setNewCategoryParent] = useState("");
  const newCategoryInput = useRef<HTMLInputElement>(null);
  const [moveCategoryMenu, setMoveCategoryMenu] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [listQuery, setListQuery] = useState("");
  const [listCategory, setListCategory] = useState(defaultCategory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryWidth, setCategoryWidth] = useState(220);
  const draggingCategory = useRef<{ id: string; pointerId: number; x: number; y: number; active: boolean } | null>(null);
  const suppressCategoryClick = useRef(false);
  const [categoryDrop, setCategoryDrop] = useState<{ id: string; after: boolean; inside?: boolean } | null>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [bulkCategory, setBulkCategory] = useState("");
  const [importOpen, setImportOpen] = useState(importOnly);
  const [importText, setImportText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [selectedSheetTabs, setSelectedSheetTabs] = useState<Set<string>>(new Set());
  const [sheetGroupName, setSheetGroupName] = useState("");
  const [categoryMenu, setCategoryMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [sheetOriginalColumn, setSheetOriginalColumn] = useState(0);
  const [sheetTranslationColumn, setSheetTranslationColumn] = useState(1);
  const [sheetTitleSource, setSheetTitleSource] = useState<"original" | "translation">("original");
  const [fetchingTabs, setFetchingTabs] = useState(false);
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaRequests = useRef(new Map<string, symbol>());
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryDeletePending = useRef(false);
  const menuRef = useDetailsMenu();
  const categoryMenuRef = useDetailsMenu();
  const replies = settings.quickReplies || [];
  const customCategories = settings.quickReplyCustomCategories || [];
  const categoryOptions = getQuickReplyCategories(customCategories, settings.quickReplyRemovedCategories, settings.quickReplyCategoryLabels, settings.quickReplyCategoryOrder);
  const categoryTreeRows = useMemo(() => flattenQuickReplyCategories(categoryOptions), [categoryOptions]);
  const visibleCategoryTreeRows = categoryTreeRows.filter(({ category }) => {
    let parentId = category.parentId;
    while (parentId) {
      if (!expandedCategories.includes(parentId)) return false;
      parentId = categoryOptions.find(item => item.id === parentId)?.parentId;
    }
    return true;
  });
  const visibleReplies = useMemo(() => {
    const ids = listCategory === "all" ? null : quickReplyCategoryDescendants(listCategory, categoryOptions);
    const matches = new Set(filterQuickReplies(replies, "all", listQuery).map(reply => reply.id));
    return replies.filter(reply => reply.id === selectedId || matches.has(reply.id) && (!ids || ids.has(reply.category)));
  }, [categoryOptions, listCategory, listQuery, replies, selectedId]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visibleReplies.length / 50) - 1));
  const pageReplies = visibleReplies.slice(currentPage * 50, (currentPage + 1) * 50);
  const editing = replies.find(reply => reply.id === selectedId);
  const categoryLabel = (id: string, source = settings) => source.quickReplyCategoryLabels?.[id] || (QUICK_REPLY_CATEGORIES.some(item => item.id === id)
    ? t(`quickReply.category.${id}` as TranslationKey) : source.quickReplyCustomCategories?.find(item => item.id === id)?.label || id);
  const categoryCount = (id: string) => { const ids = quickReplyCategoryDescendants(id, categoryOptions); return replies.filter(reply => ids.has(reply.category)).length; };
  const menuCategory = categoryOptions.find(item => item.id === categoryMenu?.id);
  const menuDescendants = menuCategory ? quickReplyCategoryDescendants(menuCategory.id, categoryOptions) : new Set<string>();
  const menuCustom = menuCategory && customCategories.some(item => item.id === menuCategory.id);
  const renderCategoryTree = (parentId: string | undefined, depth = 0): React.ReactNode => categoryOptions
    .filter(category => category.parentId === parentId && (category.id === "other" || categoryCount(category.id) > 0 || quickReplyCategoryDescendants(category.id, categoryOptions).has(listCategory)))
    .map(category => {
      const children = categoryOptions.some(item => item.parentId === category.id);
      const expanded = expandedCategories.includes(category.id);
      return <div key={category.id}>
        <div data-category-id={category.id} className={`flex items-center gap-1 ${categoryDropClass(category.id)}`} style={{ paddingLeft: depth * 12 }}>
          {children ? <button type="button" aria-label={t(expanded ? "quickLibrary.collapseCategory" : "quickLibrary.expandCategory", { name: categoryLabel(category.id) })} aria-expanded={expanded} onClick={() => setExpandedCategories(current => expanded ? current.filter(id => id !== category.id) : [...current, category.id])} className="w-5 shrink-0 text-zinc-500">{expanded ? "▾" : "▸"}</button> : <span className="w-5 shrink-0" />}
          <button {...categoryDragProps(category.id)} type="button" title={`${categoryLabel(category.id)} · ${t("quickLibrary.categoryDragHint")}`} aria-label={categoryLabel(category.id)} aria-pressed={listCategory === category.id} onClick={() => { setSelectedId(null); setListCategory(category.id); setPage(0); }} onContextMenu={category.id === "other" ? undefined : event => { event.preventDefault(); setCategoryMenu({ id: category.id, x: event.clientX, y: event.clientY }); }} className={`flex min-w-0 flex-1 cursor-grab select-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs active:cursor-grabbing ${listCategory === category.id ? "bg-brand/15 text-brand" : "text-zinc-400 hover:bg-zinc-800/50"}`}>
            <span className="truncate">{categoryLabel(category.id)}</span><span className="text-2xs opacity-70">{categoryCount(category.id)}</span>
          </button>
        </div>
        {children && expanded && renderCategoryTree(category.id, depth + 1)}
      </div>;
    });
  const importPreview = useMemo(() => {
    try { return { ...parseQuickReplyTable(importText), error: false }; }
    catch { return { rows: [], invalidRows: [], error: true }; }
  }, [importText]);
  useEffect(() => { setSelectedIds(new Set()); }, [listCategory, listQuery]);
  useEffect(() => { void initializeSheets(); }, []);
  useEffect(() => { setMoveCategoryMenu(false); }, [categoryMenu?.id]);
  useEffect(() => { if (newCategoryParent) newCategoryInput.current?.focus(); }, [newCategoryParent, categoriesOpen]);
  useEffect(() => { if (categoryMenu) categoryMenuRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [categoryMenu?.id]);
  useEffect(() => {
    if (listCategory !== "all" && !categoryOptions.some(item => item.id === listCategory)) setListCategory("all");
  }, [listCategory, settings.quickReplyCustomCategories, settings.quickReplyRemovedCategories]);
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
      {importOnly && <header className="flex items-center justify-between gap-2"><SectionLabel>{t("quickLibrary.import")}</SectionLabel><Button size="xs" disabled={sheetBusy || fetchingTabs} onClick={onClose}>{t("common.close")}</Button></header>}
      {!importOnly && <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-100">{t("settingsQuickReplies.title")}</h3>
            <SaveBadge state={saveHint} />
          </div>
        </div>
        <div className="relative flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setImportOpen(open => !open)}>{t("quickLibrary.import")}</Button>
            <Button
              variant="primary"
              size="sm" className="text-2xs"
              disabled={replies.length >= MAX_QUICK_REPLIES}
              onClick={() => addReply()}
            >
              {t("settingsQuickReplies.add")}
            </Button>
            <details ref={menuRef} className="text-xs text-zinc-500" onClick={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false; }}>
              <summary className="ui-control cursor-pointer list-none px-3 py-2" aria-label={t("nav.more")}>•••</summary>
              <div className="absolute right-0 top-full z-20 mt-1 flex w-72 max-w-[80vw] flex-col gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
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
          {!connected && (
            <p className="max-w-[220px] text-2xs leading-snug text-zinc-600">
              {t("settingsQuickReplies.connectFirst")}
            </p>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {t("settingsQuickReplies.description")}
          </p>
          <p className="mt-1 text-2xs text-zinc-600">
            {t("settingsQuickReplies.mediaOnlyLocal")}
          </p>
              </div>
            </details>
          </div>
        </div>
      </header>}


      {importOpen && (
        <section className={`space-y-3 ${importOnly ? "border-b border-zinc-800 pb-3" : "rounded-xl border border-zinc-800 p-4"}`}>
          {!importOnly && <SectionLabel>{t("quickLibrary.import")}</SectionLabel>}
          <p className="text-2xs text-zinc-500">{t("quickLibrary.sheetSyncHint")}</p>
          <div className={`grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] ${importOnly ? "" : "rounded-lg border border-zinc-800 p-3"}`}>
            <label className="text-xs text-zinc-500">{t("quickLibrary.sheetUrl")}
              <Input
                className="mt-1"
                value={sheetUrl}
                disabled={sheetBusy || fetchingTabs}
                aria-label={t("quickLibrary.sheetUrl")}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                onChange={event => {
                  setSheetUrl(event.target.value);
                  setSheetError("");
                  setSheetTabs([]);
                  setSelectedSheetTabs(new Set());
                  setSheetGroupName("");
                }}
              />
            </label>
            {sheets.email && !sheets.needsAccess
              ? <Button size="sm" className="self-end" disabled={fetchingTabs || sheetBusy || sheets.busy || !spreadsheetId(sheetUrl)} onClick={() => void fetchGoogleSheetTabs()}>{fetchingTabs ? t("quickLibrary.fetchTabsLoading") : t("quickLibrary.fetchTabs")}</Button>
              : <Button size="sm" className="self-end" disabled={!sheets.ready || !sheets.configured || sheets.busy} onClick={() => void connectSheets()}>{sheets.email ? t("sheets.authorizeActions") : t("sheets.connect")}</Button>}
          </div>
          {sheetTabs.length > 0 && (
            <div className={`space-y-2 ${importOnly ? "border-t border-zinc-800/80 pt-3" : "rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-300">
                  {t("quickLibrary.selectTabs")} ({selectedSheetTabs.size}/{sheetTabs.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedSheetTabs(new Set(sheetTabs))}
                    disabled={selectedSheetTabs.size === sheetTabs.length || sheetBusy}
                  >
                    {t("quickLibrary.selectAll")}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedSheetTabs(new Set())}
                    disabled={selectedSheetTabs.size === 0 || sheetBusy}
                  >
                    {t("quickLibrary.deselectAll")}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={fetchingTabs || sheetBusy}
                    onClick={() => void fetchGoogleSheetTabs()}
                  >
                    {t("quickLibrary.fetchTabs")}
                  </Button>
                </div>
              </div>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto pt-1">
                {sheetTabs.map(tab => {
                  const checked = selectedSheetTabs.has(tab);
                  return (
                    <label
                      key={tab}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        checked
                          ? "border-brand/40 bg-brand/10 text-zinc-100 font-medium"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        aria-label={tab}
                        checked={checked}
                        disabled={sheetBusy}
                        onChange={e => {
                          setSelectedSheetTabs(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(tab);
                            else next.delete(tab);
                            return next;
                          });
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 text-brand focus:ring-brand focus:ring-offset-0"
                      />
                      <span className="max-w-[200px] truncate" title={tab}>{tab}</span>
                    </label>
                  );
                })}
              </div>
              <div className="grid gap-2 border-t border-zinc-800/80 pt-2 sm:grid-cols-3">
                <label className="text-2xs text-zinc-500">{t("quickLibrary.originalColumn")}
                  <select aria-label={t("quickLibrary.originalColumn")} className="ui-control mt-1 w-full px-2 py-1.5 text-xs" disabled={sheetBusy} value={sheetOriginalColumn} onChange={event => {
                    const column = Number(event.target.value);
                    if (column === sheetTranslationColumn) setSheetTranslationColumn(sheetOriginalColumn);
                    setSheetOriginalColumn(column);
                  }}>
                    <option value={0}>A</option><option value={1}>B</option>
                  </select>
                </label>
                <label className="text-2xs text-zinc-500">{t("quickLibrary.translationColumn")}
                  <select aria-label={t("quickLibrary.translationColumn")} className="ui-control mt-1 w-full px-2 py-1.5 text-xs" disabled={sheetBusy} value={sheetTranslationColumn} onChange={event => {
                    const column = Number(event.target.value);
                    if (column === sheetOriginalColumn) setSheetOriginalColumn(sheetTranslationColumn);
                    setSheetTranslationColumn(column);
                  }}>
                    <option value={0}>A</option><option value={1}>B</option>
                  </select>
                </label>
                <label className="text-2xs text-zinc-500">{t("quickLibrary.titleSource")}
                  <select aria-label={t("quickLibrary.titleSource")} className="ui-control mt-1 w-full px-2 py-1.5 text-xs" disabled={sheetBusy} value={sheetTitleSource} onChange={event => setSheetTitleSource(event.target.value as "original" | "translation")}>
                    <option value="original">{t("quickShelf.insertOriginalShort")}</option>
                    <option value="translation">{t("quickShelf.insertTranslationShort")}</option>
                  </select>
                </label>
              </div>
              <p className="text-2xs text-zinc-500">{t("quickLibrary.columnMappingHint")}</p>
              <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2">
                <span className="text-2xs text-zinc-500">
                  {sheetGroupName ? `${sheetGroupName} · ` : ""}{t("quickLibrary.selectTabs")}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={sheetBusy || selectedSheetTabs.size === 0}
                  onClick={() => void importSelectedGoogleSheets()}
                >
                  {sheetBusy ? t("quickLibrary.sheetLoading") : t("quickLibrary.importSelectedTabs", { count: selectedSheetTabs.size })}
                </Button>
              </div>
            </div>
          )}
          {sheetError && <p role="alert" className="text-xs text-red-400">{sheetError}</p>}
          {sheets.error && <p role="alert" className="text-xs text-red-400">{t(sheetErrorHint(sheets.error))}</p>}
          <details className={importOnly ? "border-t border-zinc-800 pt-3" : "rounded-lg border border-zinc-800 p-3"}>
          <summary className="cursor-pointer text-xs text-zinc-500">{t("quickLibrary.pasteInstead")}</summary>
          <p className="my-2 text-xs text-zinc-500">{t("quickLibrary.importHint")}</p>
          <Textarea rows={5} maxLength={3_000_000} value={importText} aria-label={t("quickLibrary.import")}
            onChange={event => setImportText(event.target.value)} />
          <p role="status" className="text-xs text-zinc-500">
            {importPreview.error ? t("quickLibrary.importError") : importPreview.invalidRows.length
              ? t("quickLibrary.invalidRows", { rows: importPreview.invalidRows.slice(0, 10).join(", ") })
              : t("quickLibrary.importReady", { count: importPreview.rows.length })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={sheetBusy || importPreview.error || !!importPreview.invalidRows.length || !importPreview.rows.length}
              onClick={() => void importReplies(false)}>{t("quickLibrary.confirmImport")}</Button>
            {importPreview.invalidRows.length > 0 && importPreview.rows.length > 0 && (
                <Button variant="secondary" onClick={() => void importReplies(true)}>
                {t("quickLibrary.importValidOnly", { count: importPreview.rows.length })}
              </Button>
            )}
          </div>
          </details>
        </section>
      )}
      {!importOnly && <><section className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/35 lg:flex-row" style={{ "--quick-category-width": `${categoryWidth}px` } as React.CSSProperties}>
        <nav aria-label={t("settingsQuickReplies.category")} title={t("quickLibrary.categoryRightClickHint")} className="w-full space-y-1 border-b border-zinc-800 p-3 lg:max-h-[720px] lg:w-[var(--quick-category-width)] lg:shrink-0 lg:overflow-y-auto lg:border-b-0">
          <div className="flex items-center justify-between gap-1">
            <SectionLabel>{t("settingsQuickReplies.category")}</SectionLabel>
            <Button size="xs" variant="ghost" aria-expanded={categoriesOpen} aria-controls="quick-reply-category-manager" onClick={() => { setNewCategoryParent(""); setCategoriesOpen(open => !open); }}>{t(categoriesOpen ? "common.close" : "settingsQuickReplies.manageCategories")}</Button>
          </div>
          {categoriesOpen && <div id="quick-reply-category-manager" className="space-y-2 py-2">
            {newCategoryParent && <div className="flex items-center justify-between gap-1 text-xs text-brand"><span>{t("quickLibrary.addInside", { name: categoryLabel(newCategoryParent) })}</span><Button size="xs" variant="ghost" onClick={() => setNewCategoryParent("")}>{t("common.cancel")}</Button></div>}
            <form className="flex gap-1" onSubmit={event => { event.preventDefault(); addCategory(); }}>
              <Input ref={newCategoryInput} autoFocus className="min-w-0 flex-1" size="sm" value={newCategory} maxLength={32} placeholder={t("settingsQuickReplies.categoryPlaceholder")} aria-label={t("settingsQuickReplies.categoryPlaceholder")} onChange={event => setNewCategory(event.target.value)} />
              <Button type="submit" size="xs" aria-label={t("settingsQuickReplies.addCategory")} title={t("settingsQuickReplies.addCategory")} disabled={!newCategory.trim() || customCategories.length >= MAX_QUICK_REPLY_CATEGORIES}>＋</Button>
            </form>
            <div data-category-id="__root" className={`rounded px-2 py-1 text-xs text-zinc-500 ${categoryDropClass("__root")}`}>{t("quickLibrary.allCategories")}</div>
            {visibleCategoryTreeRows.filter(({ category }) => category.id !== "other").map(({ category, depth, hasChildren }) => {
              return <div key={category.id} data-category-id={category.id} className={`space-y-1 rounded-lg p-1 ${categoryDropClass(category.id)}`} style={{ marginLeft: depth * 10 }}>
                <div className="flex items-center gap-1">
                  {hasChildren && <button type="button" aria-label={t(expandedCategories.includes(category.id) ? "quickLibrary.collapseCategory" : "quickLibrary.expandCategory", { name: categoryLabel(category.id) })} aria-expanded={expandedCategories.includes(category.id)} onClick={() => setExpandedCategories(current => current.includes(category.id) ? current.filter(id => id !== category.id) : [...current, category.id])} className="w-3 text-zinc-500">{expandedCategories.includes(category.id) ? "▾" : "▸"}</button>}
                  <button {...categoryDragProps(category.id)} type="button" className="shrink-0 touch-none select-none cursor-grab rounded px-1 text-zinc-500 active:cursor-grabbing" aria-label={t("quickLibrary.dragCategory", { name: categoryLabel(category.id) })} title={t("quickLibrary.categoryDragHint")}>⠿</button>
                  <Input size="sm" className="min-w-0 flex-1" maxLength={32} aria-label={t("settingsQuickReplies.renameCategory", { name: categoryLabel(category.id) })}
                    value={categoryDrafts[category.id] ?? categoryLabel(category.id)}
                    onChange={event => setCategoryDrafts(values => ({ ...values, [category.id]: event.target.value }))}
                    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}
                    onBlur={event => { renameCategory(category.id, event.currentTarget.value); setCategoryDrafts(values => { const next = { ...values }; delete next[category.id]; return next; }); }} />
                  {category.id !== "other" && <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-rose-400" aria-label={t("settingsQuickReplies.deleteCategoryNamed", { name: categoryLabel(category.id) })} title={t("settingsQuickReplies.deleteCategoryNamed", { name: categoryLabel(category.id) })} onClick={() => void removeCategory(category.id)}>×</button>}
                </div>
              </div>;
            })}
          </div>}
          {!categoriesOpen && <div className="max-h-[640px] space-y-1 overflow-y-auto py-1">
            <button data-category-id="__root" type="button" aria-pressed={listCategory === "all"} onClick={() => { setSelectedId(null); setListCategory("all"); setPage(0); }} className={`${categoryDropClass("__root")} flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs ${listCategory === "all" ? "bg-brand/15 text-brand" : "text-zinc-400 hover:bg-zinc-800/50"}`}><span>{t("starred.all")}</span><span className="text-2xs opacity-70">{replies.length}</span></button>
            {renderCategoryTree(undefined)}
          </div>}
        </nav>
        <div role="separator" aria-orientation="vertical" aria-label={t("quickLibrary.resizeCategories")} aria-valuemin={180} aria-valuemax={360} aria-valuenow={categoryWidth} tabIndex={0} className="hidden w-1.5 shrink-0 touch-none cursor-col-resize bg-zinc-800/50 hover:bg-brand/40 focus-visible:bg-brand/40 lg:block"
          onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resizeStart.current = { x: event.clientX, width: categoryWidth }; }}
          onPointerMove={event => { if (resizeStart.current) setCategoryWidth(Math.max(180, Math.min(360, resizeStart.current.width + event.clientX - resizeStart.current.x))); }}
          onPointerUp={event => { resizeStart.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onLostPointerCapture={() => { resizeStart.current = null; }}
          onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setCategoryWidth(width => Math.max(180, Math.min(360, width + (event.key === "ArrowRight" ? 20 : -20)))); } }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-zinc-800 p-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <SectionLabel>{t("settingsQuickReplies.list")}</SectionLabel><span>{replies.length} / {MAX_QUICK_REPLIES}</span>
            </div>
            <Input value={listQuery} onChange={event => { setSelectedId(null); setListQuery(event.target.value); setPage(0); }}
              placeholder={t("multi.searchQuickReplies")} aria-label={t("multi.searchQuickReplies")} />
            {!!pageReplies.length && <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={pageReplies.every(reply => selectedIds.has(reply.id))}
                onChange={event => { const next = new Set(selectedIds); pageReplies.forEach(reply => event.target.checked ? next.add(reply.id) : next.delete(reply.id)); setSelectedIds(next); }} />
              {t("quickLibrary.selectPage")} · {selectedIds.size}
            </label>}
            {visibleReplies.length > pageReplies.length && <Button size="xs" variant="ghost" onClick={() => setSelectedIds(new Set(visibleReplies.map(reply => reply.id)))}>{t("quickLibrary.selectAllMatches", { count: visibleReplies.length })}</Button>}
            {!!selectedIds.size && <div className="flex flex-wrap items-center gap-2">
              <select value={bulkCategory} onChange={event => setBulkCategory(event.target.value)} aria-label={t("quickLibrary.moveTo")}
                className="ui-control min-w-0 flex-1 px-2 text-xs">
                <option value="">{t("quickLibrary.moveTo")}</option>
                {categoryTreeRows.map(({ category, depth }) => <option key={category.id} value={category.id}>{"　".repeat(depth)}{categoryLabel(category.id)}</option>)}
              </select>
              <Button size="sm" disabled={!bulkCategory} onClick={moveSelected}>{t("quickLibrary.move")}</Button>
              <Button size="sm" variant="secondary" className="border-rose-900/50 bg-rose-950/20 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300" onClick={() => void removeSelected()}>{t("quickLibrary.deleteSelected", { count: selectedIds.size })}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>{t("common.cancel")}</Button>
            </div>}
          </div>
          <div className="max-h-[70vh] min-h-[200px] flex-1 overflow-y-auto p-2">
            {pageReplies.map(reply => <div
              key={reply.id}
              className={"mb-1 rounded-lg " + (editing?.id === reply.id ? "bg-brand/10" : "hover:bg-zinc-800/40")}
            ><div className="group relative flex items-start gap-2 p-2"
              onContextMenu={event => {
                event.preventDefault();
                void confirmRemoveSingleReply(reply);
              }}
            >
              <input type="checkbox" className="mt-1" aria-label={t("quickLibrary.selectReply", { title: reply.title })} checked={selectedIds.has(reply.id)}
                onChange={event => { const next = new Set(selectedIds); event.target.checked ? next.add(reply.id) : next.delete(reply.id); setSelectedIds(next); }} />
              <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={editing?.id === reply.id} aria-controls={`quick-reply-editor-${reply.id}`} onClick={() => { setSelectedId(current => current === reply.id ? null : reply.id); setConfirmDeleteId(null); }}>
                <span className="block truncate text-sm font-medium text-zinc-200">{reply.title || t("quickLibrary.newReply")}</span>
                <span className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-zinc-500">{quickReplyPreviewText(reply.title, reply.translation || reply.body || reply.media?.fileName || "")}</span>
                {(reply.category !== listCategory || reply.media) && <span className="mt-1 block truncate text-2xs text-zinc-500">{[reply.category !== listCategory ? categoryLabel(reply.category) : "", reply.media?.fileName].filter(Boolean).join(" · ")}</span>}
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400 transition-opacity"
                title={t("settingsQuickReplies.deleteReplyConfirm", { title: reply.title })}
                aria-label={t("settingsQuickReplies.deleteReplyConfirm", { title: reply.title })}
                onClick={e => {
                  e?.stopPropagation?.();
                  void confirmRemoveSingleReply(reply);
                }}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />
                </svg>
              </button>
            </div>{editing?.id === reply.id && renderEditor()}</div>)}
            {!pageReplies.length && <div className="space-y-3 p-4 text-center text-xs text-zinc-500">
              <p>{t(replies.length ? "crmPanel.noMatchingReplies" : "settingsQuickReplies.empty")}</p>
              {!replies.length && <Button size="sm" onClick={applyTemplates}>{t("settingsQuickReplies.applyTemplates")}</Button>}
            </div>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-3 text-xs text-zinc-500">
            <Button size="sm" disabled={!currentPage} aria-label={t("quickLibrary.previousPage")} onClick={() => { setSelectedId(null); setPage(currentPage - 1); }}>‹</Button>
            <span>{currentPage + 1} / {Math.max(1, Math.ceil(visibleReplies.length / 50))} · {visibleReplies.length}</span>
            <Button size="sm" disabled={(currentPage + 1) * 50 >= visibleReplies.length} aria-label={t("quickLibrary.nextPage")} onClick={() => { setSelectedId(null); setPage(currentPage + 1); }}>›</Button>
          </div>
        </div>
      </section>
      <details ref={categoryMenuRef} open={!!menuCategory} onToggle={event => { if (!event.currentTarget.open) setCategoryMenu(null); }} className="fixed z-[10060] w-72 max-w-[calc(100vw-16px)] rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl" style={{ display: menuCategory ? undefined : "none", left: `clamp(8px, ${categoryMenu?.x || 0}px, calc(100vw - 296px))`, top: `clamp(8px, ${categoryMenu?.y || 0}px, calc(100vh - 400px))` }}>
        <summary className="sr-only">{t("nav.more")}</summary>
        {menuCategory && <div className="max-h-[70vh] space-y-3 overflow-y-auto" role="dialog" aria-label={t("quickLibrary.categoryActions", { name: categoryLabel(menuCategory.id) })}>
          <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{categoryLabel(menuCategory.id)}</span><Button size="xs" variant="ghost" onClick={() => setCategoryMenu(null)}>{t("common.close")}</Button></div>
          <Input maxLength={32} aria-label={t("settingsQuickReplies.renameCategory", { name: categoryLabel(menuCategory.id) })} value={categoryDrafts[menuCategory.id] ?? categoryLabel(menuCategory.id)} onChange={event => setCategoryDrafts(values => ({ ...values, [menuCategory.id]: event.target.value }))} onBlur={event => { renameCategory(menuCategory.id, event.currentTarget.value); setCategoryDrafts(values => { const next = { ...values }; delete next[menuCategory.id]; return next; }); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => { setNewCategoryParent(menuCategory.id); setNewCategory(""); setCategoriesOpen(true); setCategoryMenu(null); }}>{t("quickLibrary.newSubcategory")}</Button>
          {menuCustom && <><Button size="sm" variant="ghost" className="w-full justify-start" aria-expanded={moveCategoryMenu} onClick={() => setMoveCategoryMenu(open => !open)}>{t("quickLibrary.moveCategory")}</Button>
            {moveCategoryMenu && <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-1">
              <Button size="xs" variant="ghost" className="w-full justify-start" onClick={() => { moveCategoryTo(menuCategory.id); setCategoryMenu(null); }}>{t("quickLibrary.moveOutside")}</Button>
              {categoryTreeRows.filter(({ category }) => category.id !== "other" && !menuDescendants.has(category.id)).map(({ category, depth }) => <Button key={category.id} size="xs" variant="ghost" className="w-full justify-start" aria-label={t("quickLibrary.moveInside", { name: categoryLabel(category.id) })} onClick={() => { moveCategoryTo(menuCategory.id, category.id); setCategoryMenu(null); }}>{"　".repeat(depth)}{categoryLabel(category.id)}</Button>)}
            </div>}
          </>}
          <div className="space-y-1 border-t border-zinc-800 pt-2">
            <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => { setCategoryMenu(null); void removeCategory(menuCategory.id); }}>{t("quickLibrary.deleteCategoryOnly")}</Button>
            <Button size="sm" variant="ghost" className="w-full justify-start text-rose-400" onClick={() => { setCategoryMenu(null); void removeCategoryAndReplies(menuCategory.id); }}>{t("quickLibrary.deleteCategoryContents", { count: categoryCount(menuCategory.id) })}</Button>
          </div>
        </div>}
      </details></>}
    </div>
  );

  function renderEditor() {
    if (!editing) return null;
    return <section id={`quick-reply-editor-${editing.id}`} aria-label={t("quickLibrary.edit")} className="border-t border-zinc-800 p-3" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setSelectedId(null); setConfirmDeleteId(null); } }}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><SectionLabel>{t("quickLibrary.edit")}</SectionLabel><SaveBadge state={saveHint} /><QuickReplySheetStatus reply={editing} /></div>
              <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setSelectedId(null); setConfirmDeleteId(null); }}>{t("quickLibrary.collapseEditor")}</Button>
                <Button size="sm" disabled={replies.length >= MAX_QUICK_REPLIES} onClick={() => addReply(editing)}>{t("settingsQuickReplies.duplicate")}</Button>
                {confirmDeleteId === editing.id ? <>
                  <Button size="sm" className="text-rose-400" onClick={() => void removeReply(editing.id)}>{t("settingsQuickReplies.confirmDelete")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>{t("common.cancel")}</Button>
                </> : <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(editing.id)}>{t("common.delete")}</Button>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.commandTitle")}</span>
              <Input maxLength={40} value={editing.title} aria-label={t("settingsQuickReplies.commandTitle")} onChange={event => updateReply(editing.id, { title: event.target.value })} />
            </label>
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.category")}</span>
              <select value={editing.category} aria-label={t("settingsQuickReplies.category")} className="ui-control w-full px-2 text-sm" onChange={event => updateReply(editing.id, { category: event.target.value })}>
                {categoryTreeRows.map(({ category, depth }) => <option key={category.id} value={category.id}>{"　".repeat(depth)}{categoryLabel(category.id)}</option>)}
              </select>
            </label>
            </div><div className="grid gap-3 lg:grid-cols-2">
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.originalContent")} · {editing.body.length} / 2000</span>
              <Textarea rows={4} maxLength={2000} value={editing.body} aria-label={t("settingsQuickReplies.content")} placeholder={t("settingsQuickReplies.contentPlaceholder")}
                className="resize-y" onChange={event => updateReply(editing.id, { body: event.target.value })} />
            </label>
            <label className="block space-y-1 text-xs text-zinc-500"><span>{t("settingsQuickReplies.translation")} · {(editing.translation || "").length} / 2000</span>
              <Textarea rows={4} maxLength={2000} value={editing.translation || ""} aria-label={t("settingsQuickReplies.translation")} placeholder={t("settingsQuickReplies.translationPlaceholder")}
                className="resize-y" onChange={event => updateReply(editing.id, { translation: event.target.value })} />
            </label>
            </div>
            {editing.media && <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
              {editing.media.kind === "image" ? <img src={editing.media.dataUrl} alt={editing.media.fileName} className="max-h-40 w-full rounded object-contain" />
                : editing.media.kind === "audio" ? <audio src={editing.media.dataUrl} controls className="w-full" />
                : editing.media.kind === "video" ? <video src={editing.media.dataUrl} controls className="max-h-40 w-full rounded" /> : null}
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
          </div>
    </section>;
  }

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
    const latest = useAppStore.getState().settings;
    const valid = new Set(getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories).map(category => category.id));
    updateSettings({ quickReplies: next.map(reply => valid.has(reply.category) ? reply : { ...reply, category: "other" }) });
    markSavedSoon();
    return true;
  }

  function addCategory() {
    const label = newCategory.trim();
    if (!label || label.length > 32) return;
    const latest = useAppStore.getState().settings;
    if ((latest.quickReplyCustomCategories || []).length >= MAX_QUICK_REPLY_CATEGORIES) { pushToast(t("quickLibrary.categoryLimit"), "error"); return; }
    const options = getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels);
    if (newCategoryParent && !options.some(category => category.id === newCategoryParent && category.id !== "other")) return;
    if (options.some(category => categoryLabel(category.id, latest).toLocaleLowerCase() === label.toLocaleLowerCase())) { pushToast(t("settingsQuickReplies.categoryExists"), "info"); return; }
    const id = "custom-" + crypto.randomUUID();
    updateSettings({ quickReplyCustomCategories: [...(latest.quickReplyCustomCategories || []), { id, label, ...(newCategoryParent ? { parentId: newCategoryParent } : {}) }] });
    if (newCategoryParent) expandCategoryPath(newCategoryParent);
    setNewCategory(""); setNewCategoryParent(""); setCategoriesOpen(false); setSelectedId(null); setListCategory(id); setListQuery(""); setPage(0); markSavedSoon();
  }

  function categoryDropAt(x: number, y: number) {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-category-id]");
    const source = categoryOptions.find(category => category.id === draggingCategory.current?.id);
    if (!source || !element) return null;
    const custom = customCategories.some(category => category.id === source.id);
    if (element.dataset.categoryId === "__root") return custom ? { id: "__root", after: false, inside: true } : null;
    const target = categoryOptions.find(category => category.id === element?.dataset.categoryId);
    if (!target || source.id === target.id || quickReplyCategoryDescendants(source.id, categoryOptions).has(target.id)) return null;
    const rect = element.getBoundingClientRect();
    if (custom && target.id !== "other" && y > rect.top + rect.height * 0.25 && y < rect.top + rect.height * 0.75) return { id: target.id, after: false, inside: true };
    if (!custom && source.parentId !== target.parentId) return null;
    return { id: target.id, after: y >= rect.top + rect.height / 2 };
  }

  function expandCategoryPath(id: string) {
    const expanded = new Set(expandedCategories);
    let category = categoryOptions.find(item => item.id === id);
    while (category) { expanded.add(category.id); category = categoryOptions.find(item => item.id === category?.parentId); }
    setExpandedCategories([...expanded]);
  }

  function categoryDragProps(id: string) {
    const cancel = () => { draggingCategory.current = null; setCategoryDrop(null); };
    return {
      "data-drag-category-id": id,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        suppressCategoryClick.current = false;
        draggingCategory.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        const drag = draggingCategory.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        drag.active = true; event.preventDefault();
        setCategoryDrop(categoryDropAt(event.clientX, event.clientY));
        const nav = event.currentTarget.closest("nav");
        let scroller = event.currentTarget.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
        if (scroller && nav?.contains(scroller)) {
          const rect = scroller.getBoundingClientRect();
          if (event.clientY < rect.top + 32) scroller.scrollTop -= 16;
          else if (event.clientY > rect.bottom - 32) scroller.scrollTop += 16;
        }
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
        const drag = draggingCategory.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (drag?.active) {
          const target = categoryDropAt(event.clientX, event.clientY);
          if (target?.inside) moveCategoryTo(drag.id, target.id === "__root" ? undefined : target.id);
          else if (target) moveCategory(drag.id, target.id, target.after);
          suppressCategoryClick.current = true;
        }
        cancel();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
        if (suppressCategoryClick.current) { suppressCategoryClick.current = false; event.preventDefault(); event.stopPropagation(); }
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") { cancel(); return; }
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const item = categoryOptions.find(category => category.id === id);
        const siblings = categoryOptions.filter(category => category.parentId === item?.parentId);
        const after = event.key === "ArrowDown";
        const target = siblings[siblings.findIndex(category => category.id === id) + (after ? 1 : -1)];
        if (target) moveCategory(id, target.id, after);
      },
    };
  }
  function categoryDropClass(id: string) {
    return categoryDrop?.id === id ? categoryDrop.inside ? "rounded bg-brand/15 ring-1 ring-brand" : (categoryDrop.after ? "border-b-2 border-brand" : "border-t-2 border-brand") : "";
  }

  function moveCategory(id: string, targetId: string, after: boolean) {
    const latest = useAppStore.getState().settings;
    const categories = getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels, latest.quickReplyCategoryOrder);
    const source = categories.find(category => category.id === id), target = categories.find(category => category.id === targetId);
    if (!source || !target || id === targetId) return;
    if (source.parentId !== target.parentId && !moveCategoryTo(id, target.parentId)) return;
    const order = categories.map(category => category.id).filter(categoryId => categoryId !== id);
    order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, id);
    updateSettings({ quickReplyCategoryOrder: order }); markSavedSoon();
  }

  function moveCategoryTo(id: string, parentId?: string) {
    const latest = useAppStore.getState().settings;
    const categories = latest.quickReplyCustomCategories || [];
    const item = categories.find(category => category.id === id);
    const options = getQuickReplyCategories(categories, latest.quickReplyRemovedCategories);
    if (!item || parentId && (!options.some(category => category.id === parentId && category.id !== "other") || quickReplyCategoryDescendants(id, options).has(parentId))) return false;
    updateSettings({ quickReplyCustomCategories: categories.map(category => category.id === id ? { ...category, parentId } : category) }); markSavedSoon();
    if (parentId) expandCategoryPath(parentId);
    return true;
  }

  function renameCategory(id: string, value: string) {
    const label = value.trim();
    if (!label || label.length > 32) { pushToast(t("settingsQuickReplies.categoryInvalid"), "info"); return; }
    const latest = useAppStore.getState().settings;
    const options = getQuickReplyCategories(latest.quickReplyCustomCategories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels);
    if (id === "other" || !options.some(category => category.id === id)) return;
    if (categoryLabel(id, latest) === label) return;
    if (options.some(category => category.id !== id && categoryLabel(category.id, latest).toLocaleLowerCase() === label.toLocaleLowerCase())) { pushToast(t("settingsQuickReplies.categoryExists"), "info"); return; }
    if (QUICK_REPLY_CATEGORIES.some(category => category.id === id)) updateSettings({ quickReplyCategoryLabels: { ...(latest.quickReplyCategoryLabels || {}), [id]: label } });
    else updateSettings({ quickReplyCustomCategories: (latest.quickReplyCustomCategories || []).map(category => category.id === id ? { ...category, label } : category) });
    markSavedSoon();
  }

  async function removeCategory(id: string) {
    if (id === "all" || id === "other" || categoryDeletePending.current) return;
    const before = useAppStore.getState().settings;
    if (!getQuickReplyCategories(before.quickReplyCustomCategories, before.quickReplyRemovedCategories).some(category => category.id === id)) return;
    categoryDeletePending.current = true;
    try {
      if (!await requestConfirm({ title: t("settingsQuickReplies.deleteCategoryConfirm", { name: categoryLabel(id) }), description: t("settingsQuickReplies.deleteCategoryHint"), tone: "danger" })) return;
      const latest = useAppStore.getState().settings;
      const removed = latest.quickReplyRemovedCategories || [];
      updateSettings({
        quickReplyCustomCategories: (latest.quickReplyCustomCategories || []).filter(category => category.id !== id).map(category => category.parentId === id ? { ...category, parentId: before.quickReplyCustomCategories?.find(item => item.id === id)?.parentId } : category),
        quickReplyRemovedCategories: QUICK_REPLY_CATEGORIES.some(category => category.id === id) ? [...new Set([...removed, id])] : removed,
        quickReplies: (latest.quickReplies || []).map(reply => reply.category === id ? { ...reply, category: "other" } : reply),
      });
      setListCategory(current => current === id ? "all" : current); setBulkCategory(current => current === id ? "" : current); setPage(0);
      markSavedSoon();
    } catch { pushToast(t("common.deleteFailed"), "error"); }
    finally { categoryDeletePending.current = false; }
  }

  function updateReply(id: string, patch: Partial<Omit<QuickReply, "id">>) {
    const current = useAppStore.getState().settings.quickReplies || [];
    if (!current.some(item => item.id === id)) return false;
    const committed = commitReplies(current.map(item => item.id === id ? { ...item, ...patch } : item));
    if (committed && (patch.body !== undefined || patch.translation !== undefined)) scheduleQuickReplySheetSync(id, t);
    return committed;
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
    const category = seed?.category ?? (listCategory === "all" ? "other" : listCategory);
    const sheetLink = seed?.sheetLink || current.find(reply => reply.category === category && reply.sheetLink)?.sheetLink;
    const title = seed?.title ?? t("quickLibrary.newReply");
    const item: QuickReply = { id: crypto.randomUUID(), title, body: seed?.body ?? "", ...(seed?.translation ? { translation: seed.translation } : {}),
      category, media: seed?.media, ...(sheetLink ? { sheetLink: { ...sheetLink, row: 0, titleSnapshot: title, originalSnapshot: "", translationSnapshot: "" } } : {}) };
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

  async function importReplies(validOnly = false, preview = importPreview, sources: Record<string, QuickReplySheetLink[]> = {}) {
    if (preview.error || (!validOnly && preview.invalidRows.length) || !preview.rows.length) return;
    const latest = useAppStore.getState().settings;
    const categories = [...(latest.quickReplyCustomCategories || [])];
    const current = latest.quickReplies || [];
    const categoryIds = new Map<string, string>();
    for (const item of getQuickReplyCategories(categories, latest.quickReplyRemovedCategories, latest.quickReplyCategoryLabels)) {
      categoryIds.set(item.id.toLocaleLowerCase(), item.id);
      categoryIds.set(item.label.toLocaleLowerCase(), item.id);
      if (QUICK_REPLY_CATEGORIES.some(base => base.id === item.id)) categoryIds.set(t(`quickReply.category.${item.id}` as TranslationKey).toLocaleLowerCase(), item.id);
    }
    const seen = new Set(current.map(item => JSON.stringify([item.title, item.body, item.category, item.translation || ""])));
    const additions: QuickReply[] = [];
    const linkedUpdates: { reply: QuickReply; source: QuickReplySheetLink; row: typeof preview.rows[number] }[] = [];
    const linkedReplyIds = new Set<string>();
    const sourceCursors = new Map<string, number>();
    for (const row of preview.rows) {
      const sourceKey = sheetImportKey([row.title, row.body, row.category, row.translation || "", row.parent || ""]);
      const sourceIndex = sourceCursors.get(sourceKey) || 0;
      const source = sources[sourceKey]?.[sourceIndex];
      if (source) sourceCursors.set(sourceKey, sourceIndex + 1);
      const linked = source && current.find(reply => reply.sheetLink?.spreadsheetId === source.spreadsheetId && reply.sheetLink.tab === source.tab && reply.sheetLink.row === source.row);
      if (linked) { linkedUpdates.push({ reply: linked, source, row }); continue; }

      let parentId: string | undefined;
      if (row.parent) {
        let parent = categories.find(item => !item.parentId && item.label.toLocaleLowerCase() === row.parent!.toLocaleLowerCase());
        if (!parent) {
          if (categories.length >= MAX_QUICK_REPLY_CATEGORIES) { pushToast(t("quickLibrary.categoryLimit"), "error"); return; }
          parent = { id: "custom-" + crypto.randomUUID(), label: row.parent };
          categories.push(parent);
        }
        parentId = parent.id;
      }
      let category = row.category ? parentId
        ? categories.find(item => item.parentId === parentId && item.label.toLocaleLowerCase() === row.category.toLocaleLowerCase())?.id
        : categoryIds.get(row.category.toLocaleLowerCase())
        : (listCategory === "all" ? "other" : listCategory);
      if (!category) {
        if (categories.length >= MAX_QUICK_REPLY_CATEGORIES) { pushToast(t("quickLibrary.categoryLimit"), "error"); return; }
        category = "custom-" + crypto.randomUUID();
        categories.push({ id: category, label: row.category, ...(parentId ? { parentId } : {}) });
        if (!parentId) categoryIds.set(row.category.toLocaleLowerCase(), category);
      }
      const key = JSON.stringify([row.title, row.body, category, row.translation || ""]);
      if (seen.has(key)) {
        const duplicate = source && current.find(reply => reply.title === row.title && reply.body === row.body && reply.category === category && (reply.translation || "") === (row.translation || "") && !reply.sheetLink && !linkedReplyIds.has(reply.id));
        if (duplicate) { linkedUpdates.push({ reply: duplicate, source, row }); linkedReplyIds.add(duplicate.id); continue; }
        if (!source) continue;
      }
      seen.add(key); additions.push({ id: crypto.randomUUID(), title: row.title, body: row.body, ...(row.translation ? { translation: row.translation } : {}), category, ...(source ? { sheetLink: source } : {}) });
    }

    const hasConflict = linkedUpdates.some(({ reply, source, row }) => {
      const mappingChanged = reply.sheetLink?.originalColumn !== source.originalColumn || reply.sheetLink?.translationColumn !== source.translationColumn;
      const titleSnapshot = reply.sheetLink?.titleSnapshot ?? reply.title;
      const baseline = reply.sheetLink ?? source;
      return !mappingChanged && (
        (reply.title !== titleSnapshot && row.title !== titleSnapshot && reply.title !== row.title) ||
        (reply.body !== baseline.originalSnapshot && row.body !== baseline.originalSnapshot && reply.body !== row.body) ||
        ((reply.translation || "") !== baseline.translationSnapshot && (row.translation || "") !== baseline.translationSnapshot && (reply.translation || "") !== (row.translation || ""))
      );
    });
    const keepAppVersion = hasConflict && await requestConfirm({
      title: t("quickLibrary.sheetConflictTitle"),
      description: t("quickLibrary.sheetImportConflictDescription"),
      confirmLabel: t("quickLibrary.sheetImportKeepApp"),
      cancelLabel: t("quickLibrary.sheetImportUseSheet"),
    });
    const afterConfirm = useAppStore.getState().settings;
    if (afterConfirm.quickReplies !== latest.quickReplies || afterConfirm.quickReplyCustomCategories !== latest.quickReplyCustomCategories) {
      pushToast(t("quickLibrary.importChanged"), "info"); return;
    }
    if (current.length + additions.length > MAX_QUICK_REPLIES) { pushToast(t("settingsQuickReplies.limit"), "error"); return; }
    const syncIds: string[] = [];
    const linkedById = new Map(linkedUpdates.map(update => [update.reply.id, update]));
    const nextReplies = current.map(reply => {
      const update = linkedById.get(reply.id);
      if (!update) return reply;
      const { source, row } = update;
      const remoteBody = row.body;
      const remoteTranslation = row.translation || "";
      const titleSnapshot = reply.sheetLink?.titleSnapshot ?? reply.title;
      const localTitleChanged = reply.title !== titleSnapshot;
      const remoteTitleChanged = row.title !== titleSnapshot;
      const titleConflict = localTitleChanged && remoteTitleChanged && reply.title !== row.title;
      const mappingChanged = reply.sheetLink?.originalColumn !== source.originalColumn || reply.sheetLink?.translationColumn !== source.translationColumn;
      const baseline = reply.sheetLink ?? source;
      const localBodyChanged = !mappingChanged && reply.body !== baseline.originalSnapshot;
      const localTranslationChanged = !mappingChanged && (reply.translation || "") !== baseline.translationSnapshot;
      const remoteBodyChanged = remoteBody !== baseline.originalSnapshot;
      const remoteTranslationChanged = remoteTranslation !== baseline.translationSnapshot;
      const bodyConflict = localBodyChanged && remoteBodyChanged && reply.body !== remoteBody;
      const translationConflict = localTranslationChanged && remoteTranslationChanged && (reply.translation || "") !== remoteTranslation;
      const title = mappingChanged ? row.title : titleConflict ? (keepAppVersion ? reply.title : row.title) : remoteTitleChanged && !localTitleChanged ? row.title : reply.title;
      const body = mappingChanged ? remoteBody : bodyConflict ? (keepAppVersion ? reply.body : remoteBody) : remoteBodyChanged && !localBodyChanged ? remoteBody : reply.body;
      const translation = mappingChanged ? remoteTranslation : translationConflict ? (keepAppVersion ? reply.translation || "" : remoteTranslation) : remoteTranslationChanged && !localTranslationChanged ? remoteTranslation : reply.translation || "";
      if (body !== remoteBody || translation !== remoteTranslation) syncIds.push(reply.id);
      return { ...reply, title, body, ...(translation ? { translation } : { translation: undefined }), sheetLink: source };
    });
    linkedUpdates.forEach(({ reply }) => cancelQuickReplySheetSync(reply.id));
    updateSettings({ quickReplies: [...nextReplies, ...additions], quickReplyCustomCategories: categories });
    syncIds.forEach(id => scheduleQuickReplySheetSync(id, t));
    markSavedSoon(); setImportOpen(false); setImportText(""); setListQuery(""); setListCategory("all");
    const firstImported = additions[0] || linkedUpdates[0]?.reply;
    if (firstImported) {
      setSelectedId(null); setListCategory(firstImported.category); setPage(0);
      const expanded = new Set(expandedCategories);
      let category = categories.find(item => item.id === firstImported.category);
      while (category) { expanded.add(category.id); category = categories.find(item => item.id === category?.parentId); }
      setExpandedCategories([...expanded]);
    }
    pushToast(t("quickLibrary.imported", { count: additions.length + linkedUpdates.length, skipped: preview.rows.length - additions.length - linkedUpdates.length }), "success");
    onImported?.([...new Set([...additions.map(reply => reply.category), ...linkedUpdates.map(update => update.reply.category)])]);
  }

  async function fetchGoogleSheetTabs() {
    const id = spreadsheetId(sheetUrl);
    if (!id || fetchingTabs || sheetBusy || !sheets.email || sheets.needsAccess) return;
    setFetchingTabs(true);
    setSheetError("");
    try {
      const metadata = await readSheet(id);
      const tabs = metadata.sheets?.map(item => item.properties.title) || [];
      if (!tabs.length) throw new Error("empty");
      const groupName = metadata.properties?.title || t("quickLibrary.sheetGroup");
      setSheetTabs(tabs);
      setSelectedSheetTabs(new Set(tabs));
      setSheetGroupName(groupName);
    } catch (error) {
      const message = String(error);
      setSheetError(message.includes("empty") ? t("quickLibrary.sheetEmpty") : t(sheetErrorHint(message)));
    } finally {
      setFetchingTabs(false);
    }
  }

  async function importSelectedGoogleSheets() {
    const id = spreadsheetId(sheetUrl);
    if (!id || sheetBusy || !sheets.email || sheets.needsAccess) return;
    const tabsToImport = sheetTabs.filter(tab => selectedSheetTabs.has(tab));
    if (!tabsToImport.length) {
      setSheetError(t("quickLibrary.noTabsSelected"));
      return;
    }
    setSheetBusy(true);
    setSheetError("");
    try {
      const groupName = sheetGroupName || t("quickLibrary.sheetGroup");
      const allRows: string[][] = [];
      const sourceByKey: Record<string, QuickReplySheetLink[]> = {};
      for (let index = 0; index < tabsToImport.length; index += 4) {
        const currentTabs = tabsToImport.slice(index, index + 4);
        const responses = await Promise.all(currentTabs.map(tab => readSheet(id, [`${tabRange(tab)}!A1:B1001`])));
        const { rows, links } = quickReplySheetRowsWithLinks(responses.map((response, sheetIndex) => {
          if (response.valueRanges?.length !== 1) throw new Error("Incomplete Google Sheets response");
          return { name: currentTabs[sheetIndex], columns: response.valueRanges[0].values || [] };
        }), groupName, id, {
          originalColumn: sheetOriginalColumn,
          translationColumn: sheetTranslationColumn,
          titleSource: sheetTitleSource,
        });
        rows.forEach((row, rowIndex) => {
          const key = sheetImportKey(row);
          (sourceByKey[key] ||= []).push(links[rowIndex]);
        });
        allRows.push(...rows);
        if (allRows.length > MAX_QUICK_REPLIES) throw new Error("limit");
      }
      if (!allRows.length) throw new Error("empty");
      const preview = { ...parseQuickReplyTable(quickReplyRowsToTsv(allRows)), error: false };
      await importReplies(false, preview, sourceByKey);
    } catch (error) {
      const message = String(error);
      setSheetError(message.includes("contentTooLong") ? t("quickLibrary.sheetCellTooLong") : message.includes("limit") ? t("quickLibrary.importError") : message.includes("empty") ? t("quickLibrary.sheetEmpty") : t(sheetErrorHint(message)));
    } finally {
      setSheetBusy(false);
    }
  }

  async function confirmRemoveSingleReply(reply: QuickReply) {
    const ok = await requestConfirm({
      title: t("settingsQuickReplies.deleteReplyConfirm", { title: reply.title || t("quickLibrary.newReply") }),
      description: t(reply.sheetLink?.row ? "quickLibrary.sheetDeleteHint" : "settingsQuickReplies.deleteReplyHint"),
      tone: "danger",
    });
    if (!ok) return;
    await removeReply(reply.id);
  }

  async function removeSelected(ids: ReadonlySet<string> = selectedIds, categoryName?: string) {
    if (!ids.size) return true;
    const count = ids.size;
    const current = useAppStore.getState().settings.quickReplies || [];
    const selected = current.filter(reply => ids.has(reply.id));
    const hasSheetRows = selected.some(reply => !!reply.sheetLink?.row);
    const ok = await requestConfirm({
      title: categoryName ? t("settingsQuickReplies.deleteCategoryConfirm", { name: categoryName }) : t("settingsQuickReplies.bulkDeleteConfirm", { count }),
      description: (categoryName ? t("quickLibrary.deleteCategoryTreeRepliesHint", { count }) + " " : "") + t(hasSheetRows ? "quickLibrary.sheetDeleteBulkHint" : "settingsQuickReplies.bulkDeleteHint"),
      tone: "danger",
    });
    if (!ok) return false;

    const idsToDelete = new Set(ids);
    for (const reply of selected) if (reply.sheetLink) {
      cancelQuickReplySheetSync(reply.id);
      if (!reply.sheetLink.row) continue;
      try { await removeQuickReplySheetRow(reply.sheetLink); }
      catch (error) {
        idsToDelete.delete(reply.id);
        scheduleQuickReplySheetSync(reply.id, t);
        pushToast(String(error).includes("quickReplySheetConflict") ? t("quickLibrary.sheetDeleteConflict") : error instanceof Error ? error.message : t(sheetErrorHint(String(error))), "error");
      }
    }
    if (!idsToDelete.size) return false;
    if (connected) {
      for (const id of idsToDelete) {
        try { await baileysRemoveQuickReply(id, accountId); }
        catch (error) {
          idsToDelete.delete(id);
          const link = selected.find(reply => reply.id === id)?.sheetLink;
          if (link?.row) {
            try { await restoreQuickReplySheetRow(link); }
            catch { pushToast(t("quickLibrary.sheetRestoreFailed"), "error"); }
          }
          scheduleQuickReplySheetSync(id, t);
          pushToast(error instanceof Error ? error.message : t("settingsQuickReplies.deleteFailed"), "error");
        }
      }
    }
    if (!idsToDelete.size) return false;
    for (const id of idsToDelete) {
      mediaRequests.current.delete(id);
    }
    commitReplies((useAppStore.getState().settings.quickReplies || []).filter(reply => !idsToDelete.has(reply.id)));
    setSelectedIds(new Set([...ids].filter(id => !idsToDelete.has(id))));
    if (selectedId && idsToDelete.has(selectedId)) {
      setSelectedId(null);
    }
    pushToast(t("settingsQuickReplies.bulkDeleted", { count: idsToDelete.size }), "info");
    return idsToDelete.size === selected.length;
  }

  async function removeCategoryAndReplies(id: string) {
    if (id === "all" || id === "other" || categoryDeletePending.current) return;
    categoryDeletePending.current = true;
    try {
      const before = useAppStore.getState().settings;
      const ids = quickReplyCategoryDescendants(id, getQuickReplyCategories(before.quickReplyCustomCategories, before.quickReplyRemovedCategories));
      const replies = (before.quickReplies || []).filter(reply => ids.has(reply.category));
      if (replies.length) {
        if (!await removeSelected(new Set(replies.map(reply => reply.id)), categoryLabel(id))) return;
      } else if (!await requestConfirm({ title: t("settingsQuickReplies.deleteCategoryConfirm", { name: categoryLabel(id) }), description: t("quickLibrary.deleteCategoryTreeHint"), tone: "danger" })) return;
      const latest = useAppStore.getState().settings;
      if ((latest.quickReplies || []).some(reply => ids.has(reply.category))) return;
      updateSettings({ quickReplyCustomCategories: (latest.quickReplyCustomCategories || []).filter(category => !ids.has(category.id)), quickReplyRemovedCategories: [...new Set([...(latest.quickReplyRemovedCategories || []), ...QUICK_REPLY_CATEGORIES.filter(category => ids.has(category.id)).map(category => category.id)])] });
      setSelectedId(null); setListCategory("all"); setPage(0); markSavedSoon();
    } catch { pushToast(t("common.deleteFailed"), "error"); }
    finally { categoryDeletePending.current = false; }
  }

  async function removeReply(id: string) {
    setConfirmDeleteId(null);
    const reply = useAppStore.getState().settings.quickReplies?.find(item => item.id === id);
    if (reply?.sheetLink) cancelQuickReplySheetSync(id);
    if (reply?.sheetLink?.row) {
      try { await removeQuickReplySheetRow(reply.sheetLink); }
      catch (error) { scheduleQuickReplySheetSync(id, t); pushToast(String(error).includes("quickReplySheetConflict") ? t("quickLibrary.sheetDeleteConflict") : error instanceof Error ? error.message : t(sheetErrorHint(String(error))), "error"); return; }
    }
    if (connected) {
      try { await baileysRemoveQuickReply(id, accountId); }
      catch (error) {
        let restoreFailed = false;
        if (reply?.sheetLink?.row) try { await restoreQuickReplySheetRow(reply.sheetLink); } catch { restoreFailed = true; }
        pushToast(restoreFailed ? t("quickLibrary.sheetRestoreFailed") : error instanceof Error ? error.message : t("settingsQuickReplies.deleteFailed"), "error"); return;
      }
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
