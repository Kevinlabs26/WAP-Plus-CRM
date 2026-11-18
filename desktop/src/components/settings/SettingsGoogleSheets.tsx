import { useEffect, useState } from "react";
import { Check, ExternalLink, Link2, Pencil, Plus, RefreshCw, Star, TableProperties, Trash2, X } from "lucide-react";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import { spreadsheetId } from "@/lib/googleSheetApi";
import { MAX_SHEET_DISPLAY_COLUMNS } from "@/lib/googleSheetMatch";
import { cancelSheetsConnect, connectSheets, disconnectSheets, initializeSheets, letter, normalizeSheetTagStyle, readSheet, refreshSheets, saveSheetConfig, saveSheetConfigs, sheetHeaders, useGoogleSheets, sheetConnections, removeSheetConnection, DEFAULT_SHEET_ID, SHEET_TAG_COLORS, type SheetAction, type SheetField, type SheetTagColor, type SheetTagStyle } from "@/lib/googleSheets";
import { activeFolderSheetIds, foldersBoundToSheet } from "@/lib/folderSheetBinding";

export interface SheetCloseGuard {
  dirty: boolean; busy: boolean; canSave: boolean;
  save: () => Promise<boolean>;
}
type TabDraft = { name: string; row: number; phone: string; fields: SheetField[]; primaryTagFieldId: string; actions: Record<string, SheetAction>; headers: string[] };
const emptyTabDraft = (name: string): TabDraft => ({ name, row: 1, phone: "", fields: [], primaryTagFieldId: "", actions: {}, headers: [] });
const sheetTagColorLabel = { amber: "sheets.tagColor.amber", emerald: "sheets.tagColor.emerald", red: "sheets.tagColor.red", blue: "sheets.tagColor.blue", violet: "sheets.tagColor.violet", zinc: "sheets.tagColor.zinc" } as const;
function validTabDraft(draft: TabDraft, tab: string, url: string) {
  return !!draft.name.trim() && !!spreadsheetId(url) && !!tab && Number.isInteger(draft.row) && draft.row >= 1 && draft.row <= 1000 && !!draft.phone && draft.fields.length > 0 && draft.fields.length <= MAX_SHEET_DISPLAY_COLUMNS && draft.fields.every(field => !!field.label.trim() && (field.schedule.kind !== "interval" || (Number.isInteger(field.schedule.minutes) && field.schedule.minutes >= 1 && field.schedule.minutes <= 525600)) && (field.schedule.kind !== "daily" || /^([01]\d|2[0-3]):[0-5]\d$/.test(field.schedule.time)));
}
export function SettingsGoogleSheets({ onCloseGuardChange }: { onCloseGuardChange?: (guard: SheetCloseGuard | null) => void } = {}) {
  const { t } = useI18n();
  const allState = useGoogleSheets();
  const [connectionId,setConnectionId]=useState<string|null>(null);
  const [batchAdd,setBatchAdd]=useState(false);
  const [name,setName]=useState("");
  const connections=sheetConnections(allState),connection=connections.find(item=>item.id===connectionId);
  const state={...allState,config:connection?.config||null,data:connection?.data||{},error:connection?connection.error:allState.error,pauseReason:connection?.pauseReason||null,retryAt:connection?.retryAt||null};
  const requestConfirm = useAppStore(s => s.requestConfirm);
  const chatFolders = useAppStore(s => s.settings.chatFolders);
  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabListLoaded, setTabListLoaded] = useState(false);
  const [selectedTabs,setSelectedTabs]=useState<string[]>([]);
  const [tabDrafts,setTabDrafts]=useState<Record<string,TabDraft>>({});
  const [batchConnectionIds,setBatchConnectionIds]=useState<Record<string,string>>({});
  const [tabSearch,setTabSearch]=useState("");
  const [tab, setTab] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [row, setRow] = useState(1);
  const [phone, setPhone] = useState("");
  const [fields, setFields] = useState<SheetField[]>([]);
  const [primaryTagFieldId, setPrimaryTagFieldId] = useState("");
  const [tagStyleEditor, setTagStyleEditor] = useState<{ fieldId: string; draft: SheetTagStyle } | null>(null);
  const [actions, setActions] = useState<Record<string, SheetAction>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => { void initializeSheets(); }, []);
  useEffect(()=>{setConnectionId(null);setBatchAdd(false);setSelectedTabs([]);setTabDrafts({});setBatchConnectionIds({});setName("");setTabListLoaded(false);},[allState.email]);
  useEffect(() => {
    setDraftReady(true);
    if (batchAdd) return;
    if (!state.config) {
      setUrl(""); setTabs([]); setTabListLoaded(false); setTab(""); setHeaders([]); setRow(1); setPhone(""); setFields([]); setPrimaryTagFieldId(""); setActions({});
      setSelectedTabs([]); setTabDrafts({}); setBatchConnectionIds({});
      return;
    }
    setUrl(`https://docs.google.com/spreadsheets/d/${state.config.spreadsheet}/edit`);
    setTabs([state.config.tab]); setTabListLoaded(false); setTab(state.config.tab); setRow(state.config.headerRow);
    setSelectedTabs([state.config.tab]); setTabDrafts({}); setBatchConnectionIds({});
    setFields(state.config.fields);
    setPrimaryTagFieldId(state.config.primaryTagFieldId || "");
    setActions({ ...(state.config.actions || {}), ...Object.fromEntries(state.config.fields.flatMap(field => field.action ? [["heading" in field.column ? field.column.heading : letter(field.column.position), field.action]] : [])) });
    setPhone("heading" in state.config.phone ? state.config.phone.heading : "");
  }, [state.config,connectionId,batchAdd]);
  const currentTabDraft: TabDraft = { name, row, phone, fields, primaryTagFieldId, actions, headers };
  const draft = { spreadsheet: spreadsheetId(url) || url.trim(), tab, headerRow: row, phone: { heading: phone }, fields, primaryTagFieldId: primaryTagFieldId || undefined, actions };
  const baseline = state.config ? { ...state.config, actions: state.config.actions || {} } : { spreadsheet: "", tab: "", headerRow: 1, phone: { heading: "" }, fields: [], actions: {} };
  const existingConnectionForTab = (tabName: string) => connections.find(item => item.config.spreadsheet === spreadsheetId(url) && item.config.tab === tabName);
  const draftForTab = (tabName: string) => tabName === tab ? currentTabDraft : tabDrafts[tabName] || emptyTabDraft(tabName);
  const dirty = connectionId!==null&&draftReady && (JSON.stringify(draft) !== JSON.stringify(baseline)||name.trim()!==(connection?.name||"")||(batchAdd&&selectedTabs.length>0&&!connection)||(batchAdd&&!!connection&&selectedTabs.length>1));
  const canSave = draftReady && (batchAdd
    ? selectedTabs.length > 0 && selectedTabs.includes(tab) && validTabDraft(currentTabDraft, tab, url)
    : validTabDraft(currentTabDraft, tab, url));
  async function saveDraft() {
    if (!canSave || !connectionId||busy || state.busy) return false;
    setBusy(true); setError("");
    try {
      const currentState = useAppStore.getState();
      const activeSheetIds = activeFolderSheetIds(currentState.settings,currentState.chats.filter(chat=>!chat.isGroup&&!chat.localOnly).map(chat=>chat.id));
      if (batchAdd) {
        const drafts: Record<string, TabDraft> = { [tab]: currentTabDraft };
        const ids = { ...batchConnectionIds };
        for (const tabName of selectedTabs) if (!ids[tabName]) ids[tabName] = existingConnectionForTab(tabName)?.id || (tabName === tab ? connectionId || crypto.randomUUID() : crypto.randomUUID());
        for (const tabName of selectedTabs) {
          if (tabName === tab) continue;
          const fieldIds = new Map(fields.map(field => [field.id, crypto.randomUUID()]));
          drafts[tabName] = {
            ...(tabDrafts[tabName] || emptyTabDraft(tabName)), row, phone,
            fields: fields.map(field => ({ ...field, id: fieldIds.get(field.id)!, column: { ...field.column }, schedule: { ...field.schedule } })),
            primaryTagFieldId: fieldIds.get(primaryTagFieldId) || "", actions: { ...actions },
          };
        }
        setBatchConnectionIds(ids);
        const configs=selectedTabs.map(tabName=>{
          const configDraft = drafts[tabName];
          return {config:{spreadsheet:spreadsheetId(url)!,tab:tabName,headerRow:configDraft.row,phone:{heading:configDraft.phone},fields:configDraft.fields,primaryTagFieldId:configDraft.primaryTagFieldId||undefined,actions:configDraft.actions},connectionId:ids[tabName]!,name:configDraft.name||connections.find(item=>item.id===ids[tabName])?.name||tabName};
        });
        await saveSheetConfigs(configs,new Set(configs.filter(config=>activeSheetIds.has(config.connectionId)).map(config=>config.connectionId)));
      } else {
        if (!name.trim()) return false;
        await saveSheetConfig(draft,connectionId,name,activeSheetIds.has(connectionId));
      }
      setConnectionId(null);setBatchAdd(false);return true;
    }
    catch (error) { setError(String(error)); return false; }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!onCloseGuardChange) return;
    onCloseGuardChange({ dirty, busy: busy || state.busy, canSave, save: saveDraft });
    return () => { onCloseGuardChange(null); };
  }, [onCloseGuardChange, dirty, busy, state.busy, canSave, url, tab, row, phone, fields, primaryTagFieldId, actions, headers, name, connectionId, batchAdd, selectedTabs, tabDrafts, batchConnectionIds]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function confirmDisconnect() {
    const confirmed = await requestConfirm({
      title: t("sheets.disconnectTitle"),
      description: t("sheets.disconnectDescription") + (dirty ? ` ${t("sheets.disconnectDraft")}` : ""),
      confirmLabel: t("sheets.disconnectConfirm"), cancelLabel: t("common.cancel"), tone: "danger",
    });
    if (confirmed) await run(disconnectSheets);
  }
  const unique = (header: string) => !!header && headers.filter(value => value === header).length === 1;
  const editingTagField = fields.find(field => field.id === tagStyleEditor?.fieldId);
  function editTagStyle(field: SheetField) {
    setTagStyleEditor({ fieldId: field.id, draft: normalizeSheetTagStyle(field.primaryTagStyle) });
  }
  function applyTagStyle() {
    if (!tagStyleEditor) return;
    const style = normalizeSheetTagStyle(tagStyleEditor.draft);
    setFields(current => current.map(field => field.id === tagStyleEditor.fieldId
      ? { ...field, primaryTagStyle: style.defaultColor === "amber" && !style.rules.length ? undefined : style }
      : field));
    setTagStyleEditor(null);
  }
  function tabsLoaded(names: string[]) {
    setTabs(names); setTabListLoaded(true);
    if (!batchAdd) {
      const selected = names.includes(tab) ? tab : names[0] || "";
      setTab(selected); setHeaders([]);
      if (selected !== tab) { setFields([]); setPrimaryTagFieldId(""); setPhone(""); setActions({}); }
      return;
    }
    const retained = selectedTabs.filter(tabName => names.includes(tabName));
    const nextSelected = selectedTabs.length ? retained : names;
    const nextTab = nextSelected.includes(tab) ? tab : nextSelected[0] || "";
    const nextDrafts = { ...tabDrafts, ...(tab ? { [tab]: snapshotTabDraft() } : {}) };
    const nextIds = { ...batchConnectionIds };
    for (const [index, tabName] of nextSelected.entries()) {
      nextDrafts[tabName] ||= emptyTabDraft(tabName);
      if (!nextIds[tabName]) nextIds[tabName] = existingConnectionForTab(tabName)?.id || (!tab && index === 0 ? connectionId || crypto.randomUUID() : crypto.randomUUID());
    }
    setSelectedTabs(nextSelected); setTabDrafts(nextDrafts); setBatchConnectionIds(nextIds);
    if (nextTab && nextTab !== tab) restoreTabDraft(nextTab, nextDrafts[nextTab]);
    else if (!nextTab && tab) { setTab(""); setName(""); setRow(1); setPhone(""); setFields([]); setPrimaryTagFieldId(""); setActions({}); setHeaders([]); }
  }
  function snapshotTabDraft(): TabDraft { return { name, row, phone, fields, primaryTagFieldId, actions, headers }; }
  function restoreTabDraft(tabName: string, value: TabDraft) {
    setTab(tabName); setName(value.name); setRow(value.row); setPhone(value.phone); setFields(value.fields); setPrimaryTagFieldId(value.primaryTagFieldId); setActions(value.actions); setHeaders(value.headers);
  }
  function switchBatchTab(tabName: string) {
    if (!selectedTabs.includes(tabName) || tabName === tab) return;
    setTabDrafts(current => ({ ...current, [tab]: snapshotTabDraft() }));
    restoreTabDraft(tabName, tabDrafts[tabName] || emptyTabDraft(tabName));
  }
  function addBatchTabs(tabNames: string[], activate = false) {
    const added = tabNames.filter(tabName => !selectedTabs.includes(tabName));
    if (!added.length) return;
    const nextDrafts = { ...tabDrafts, ...(tab ? { [tab]: snapshotTabDraft() } : {}) };
    const nextIds = { ...batchConnectionIds };
    for (const [index, tabName] of added.entries()) {
      nextDrafts[tabName] ||= emptyTabDraft(tabName);
      if (!nextIds[tabName]) nextIds[tabName] = existingConnectionForTab(tabName)?.id || (!tab && index === 0 ? connectionId || crypto.randomUUID() : crypto.randomUUID());
    }
    setTabDrafts(nextDrafts); setBatchConnectionIds(nextIds); setSelectedTabs(current => [...current, ...added]);
    if ((activate || !tab) && added[0]) restoreTabDraft(added[0], nextDrafts[added[0]]);
  }
  function toggleBatchTab(tabName: string, checked: boolean) {
    if (checked) { addBatchTabs([tabName], true); return; }
    const remaining = selectedTabs.filter(value => value !== tabName);
    setSelectedTabs(remaining);
    setTabDrafts(current => { const next = { ...current }; delete next[tabName]; return next; });
    setBatchConnectionIds(current => { const next = { ...current }; delete next[tabName]; return next; });
    if (tabName === tab) {
      if (remaining.length) restoreTabDraft(remaining[0], tabDrafts[remaining[0]] || emptyTabDraft(remaining[0]));
      else { setTab(""); setName(""); setRow(1); setPhone(""); setFields([]); setPrimaryTagFieldId(""); setActions({}); setHeaders([]); }
    }
  }
  function clearBatchTabs() {
    setSelectedTabs([]); setTabDrafts({}); setBatchConnectionIds({}); setTab(""); setName(""); setRow(1); setPhone(""); setFields([]); setPrimaryTagFieldId(""); setActions({}); setHeaders([]);
  }
  function selectCurrentTabOnly() {
    if (!tab || !tabs.includes(tab)) return;
    setSelectedTabs([tab]); setTabDrafts({ [tab]: snapshotTabDraft() });
    setBatchConnectionIds(current => ({ [tab]: current[tab] || existingConnectionForTab(tab)?.id || connectionId || crypto.randomUUID() }));
  }
  async function editConnection(id:string|null,label="",multiple=false){
    if(id===connectionId)return;
    if(dirty&&!await requestConfirm({title:t("sheets.discardTitle"),description:t("sheets.discardHint"),confirmLabel:t("sheets.discard"),tone:"danger"}))return;
    setDraftReady(false);setConnectionId(id);setBatchAdd(multiple);setSelectedTabs([]);setTabDrafts({});setBatchConnectionIds({});setTabListLoaded(false);setTabSearch("");setName(label);setError("");
    const existing = multiple ? connections.find(item => item.id === id) : undefined;
    if(existing){
      const config=existing.config,selected=config.tab;
      setUrl(`https://docs.google.com/spreadsheets/d/${config.spreadsheet}/edit`);setTabs([selected]);setSelectedTabs([selected]);setTab(selected);setHeaders([]);setRow(config.headerRow);setPhone("heading" in config.phone?config.phone.heading:"");setFields(config.fields);setPrimaryTagFieldId(config.primaryTagFieldId||"");setActions({...(config.actions||{}),...Object.fromEntries(config.fields.flatMap(field=>field.action?[["heading"in field.column?field.column.heading:letter(field.column.position),field.action]]:[]))});setBatchConnectionIds({[selected]:id||DEFAULT_SHEET_ID});
    }else if(multiple){setUrl("");setTabs([]);setTab("");setHeaders([]);setRow(1);setPhone("");setFields([]);setPrimaryTagFieldId("");setActions({});}
  }
  return <div className="mx-auto max-w-3xl space-y-5">
    <header className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-100"><TableProperties className="h-5 w-5 text-brand" />Google Sheets</h3>
      {state.email&&<Button size="sm" disabled={busy||state.busy} onClick={()=>void editConnection(connections.length?crypto.randomUUID():DEFAULT_SHEET_ID,t("sheets.newName",{count:connections.length+1}),true)}>{t("sheets.add")}</Button>}
    </header>
    <p className="text-xs leading-5 text-zinc-500">{t("sheets.description")}</p>
    <section className="space-y-2 border-b border-zinc-800 pb-3">
      <div className="flex items-center justify-between gap-3"><SectionLabel className="!mb-0">{t("sheets.accountStep")}</SectionLabel><span role="status" className={`rounded-full px-2 py-1 text-[10px] ${state.email ? "bg-brand/10 text-brand" : "bg-zinc-800 text-zinc-500"}`}>{state.email ? t("sheets.connected") : t("sheets.disconnected")}</span></div>
    {state.email ? <div className="flex flex-wrap items-center justify-between gap-3"><span className="min-w-0 break-all text-sm text-zinc-200">{state.email}</span><div className="flex items-center gap-2">{state.authorizing ? <Button variant="secondary" size="xs" onClick={() => void cancelSheetsConnect()}>{t("sheets.cancelAuthorization")}</Button> : <>{state.needsAccess && <Button variant="secondary" size="xs" disabled={busy || state.busy} onClick={() => void connectSheets()}>{t("sheets.authorizeActions")}</Button>}<Button variant="ghost" size="xs" disabled={busy || state.busy} onClick={() => void confirmDisconnect()}>{t("sheets.disconnect")}</Button></>}</div></div> : <>
      <p className="text-xs leading-5 text-zinc-500">{t("sheets.connectHint")}</p>
      <Button variant="primary" className="gap-2" disabled={!state.ready || !state.configured || state.busy} onClick={() => void connectSheets()}>{state.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}{state.busy ? t("sheets.authorizing") : t("sheets.connect")}</Button>
      {state.authorizing && <Button variant="secondary" size="xs" onClick={() => void cancelSheetsConnect()}>{t("sheets.cancelAuthorization")}</Button>}
      {state.ready && !state.configured && <p className="text-xs text-zinc-500">{t("sheets.notConfigured")}</p>}
    </>}
      <details className="border-t border-zinc-800 pt-3 text-xs text-zinc-500"><summary className="cursor-pointer">{t("sheets.accessDetails")}</summary><p className="mt-2 leading-5">{t("sheets.permission")}</p></details>
    </section>
    {(error || state.error) && <div role="alert" className="break-words rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-400"><p>{t(sheetErrorHint(error || state.error))}</p><details className="mt-2 text-zinc-500"><summary className="cursor-pointer">{t("sheets.error.details")}</summary><p className="mt-1 whitespace-pre-wrap">{error || state.error}</p></details></div>}
    {state.pauseReason && <p role="status" className="text-xs text-amber-500">{t(state.pauseReason === "authorization" ? "sheets.retry.authorization" : "sheets.retry.configuration")}</p>}
    {state.retryAt && <p role="status" className="text-xs text-zinc-500">{t("sheets.retry.waiting", { time: new Date(state.retryAt).toLocaleTimeString() })}</p>}
    {state.email&&<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-zinc-500"><tr>{(["name","tab","fields","binding","status","operations"] as const).map(key=><th key={key} className="px-2 py-2 font-medium">{t(`sheets.table.${key}`)}</th>)}</tr></thead><tbody className="divide-y divide-zinc-800">{connections.map(item=>{
      const bindings=foldersBoundToSheet({chatFolders},item.id);
      const bindingLabel=bindings.map(binding=>binding.inherited?t("sheets.table.inherited",{folder:binding.folderName,source:binding.sourceName}):binding.folderName).join(" · ");
      return <tr key={item.id} className={connectionId===item.id?"bg-brand/5":""}>
      <td className="max-w-40 truncate px-2 py-3 font-medium" title={item.name}>{item.name}</td><td className="max-w-40 truncate px-2 py-3" title={item.config.tab}>{item.config.tab}</td><td className="px-2 py-3">{item.config.fields.length}</td><td className="max-w-48 truncate px-2 py-3" title={bindingLabel||t("sheets.table.unbound")}>{bindingLabel||t("sheets.table.unbound")}</td><td className="px-2 py-3" title={item.error}>{t(item.error?"sheets.table.error":"sheets.table.ready")}</td>
      <td className="px-2 py-2"><div className="flex gap-1"><Button size="xs" aria-label={t("sheets.edit")} title={t("sheets.edit")} disabled={busy||state.busy} onClick={()=>void editConnection(item.id,item.name,true)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="xs" aria-label={t("sheets.refresh")} title={t("sheets.refresh")} disabled={busy||state.busy} onClick={()=>void refreshSheets(true,item.id)}><RefreshCw className="h-3.5 w-3.5" /></Button><Button size="xs" variant="ghost" className="text-rose-400 hover:text-rose-300" aria-label={t("common.delete")} title={t("common.delete")} disabled={busy||state.busy} onClick={()=>void run(async()=>{if(await requestConfirm({title:t("sheets.removeTitle",{name:item.name}),description:t("sheets.removeHint"),confirmLabel:t("common.delete"),tone:"danger"})){await removeSheetConnection(item.id);if(connectionId===item.id)setConnectionId(null);}})}><Trash2 className="h-3.5 w-3.5" /></Button></div></td>
    </tr>})}</tbody></table>{!connections.length&&<p className="py-4 text-xs text-zinc-500">{t("sheets.empty")}</p>}</div>}
    {state.email && connectionId && <>
      <div className="flex flex-wrap items-center gap-2"><input aria-label={t("sheets.table.name")} className="ui-control min-w-40 flex-1 px-3 py-2 text-sm" maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder={t("sheets.table.name")}/><Button size="sm" variant="primary" disabled={busy||state.busy||!canSave||!name.trim()} onClick={()=>void saveDraft()}>{t("sheets.save")}</Button><Button size="sm" disabled={busy||state.busy} onClick={()=>void editConnection(null)}>{t("common.close")}</Button><span role="status" className="text-xs text-zinc-500">{t(busy?"sheets.saving":dirty?"sheets.unsaved":"sheets.explicitSave")}</span></div>
      <fieldset disabled={busy || state.busy} className="space-y-4 border-t border-zinc-800 pt-4 disabled:opacity-60">
        <SectionLabel className="flex items-center gap-2"><Link2 className="h-3.5 w-3.5" />{t("sheets.sourceStep")}</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block min-w-0 text-xs">{t("sheets.url")}<input className="ui-control mt-1 w-full min-w-0 px-3 py-2 text-sm leading-5 font-normal" value={url} onChange={e => { setUrl(e.target.value); setHeaders([]); setTabs([]); setTabListLoaded(false); setFields([]); setPrimaryTagFieldId(""); setActions({}); if (batchAdd) { setSelectedTabs([]); setTabDrafts({}); setBatchConnectionIds({}); setTab(""); setName(""); setRow(1); setPhone(""); } }} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
          <Button variant="secondary" className="sm:min-w-40" disabled={busy || state.busy || !spreadsheetId(url)} onClick={() => void run(async () => { const result = await readSheet(spreadsheetId(url)!); tabsLoaded(result.sheets?.map(sheet => sheet.properties.title) || []); })}>{t("sheets.load")}</Button>
        </div>
        {tabs.length > 0 && (batchAdd ? <div className="space-y-3 border-t border-zinc-800/70 pt-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("sheets.selectedTabs", { count: selectedTabs.length })}>
            <Button size="xs" variant={selectedTabs.length === 1 && selectedTabs[0] === tab ? "primary" : "secondary"} aria-pressed={selectedTabs.length === 1 && selectedTabs[0] === tab} onClick={selectCurrentTabOnly}>{t("sheets.onlyCurrentTab")}</Button>
            {(!connection || tabListLoaded)
              ? <Button size="xs" variant={selectedTabs.length === tabs.length ? "primary" : "secondary"} aria-pressed={selectedTabs.length === tabs.length} onClick={() => { setTabSearch(""); addBatchTabs(tabs); }}>{t("sheets.allTabs")}</Button>
              : <span className="self-center text-xs text-zinc-500">{t("sheets.loadTabsFirst")}</span>}
          </div>
          <details className="border-b border-zinc-800/70 pb-3">
            <summary className="cursor-pointer py-2 text-xs font-medium">{t("sheets.selectedTabs", { count: selectedTabs.length })}</summary>
            <div className="space-y-2 pt-2">
              <div className="flex flex-wrap gap-2">
                <input className="ui-control min-w-40 flex-1 px-3 py-2 text-xs" value={tabSearch} onChange={event => setTabSearch(event.target.value)} placeholder={t("sheets.searchTabs")} />
                <Button size="xs" variant="secondary" onClick={() => addBatchTabs(tabs.filter(tabName => tabName.toLocaleLowerCase().includes(tabSearch.trim().toLocaleLowerCase())))}>{t("sheets.selectFiltered")}</Button>
                <Button size="xs" variant="secondary" onClick={clearBatchTabs}>{t("sheets.clearSelection")}</Button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {tabs.filter(tabName => tabName.toLocaleLowerCase().includes(tabSearch.trim().toLocaleLowerCase())).map(tabName => <label key={tabName} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-800/70">
                  <input type="checkbox" checked={selectedTabs.includes(tabName)} onChange={event => toggleBatchTab(tabName, event.target.checked)} />
                  <span className="min-w-0 truncate">{tabName}</span>
                </label>)}
                {!tabs.some(tabName => tabName.toLocaleLowerCase().includes(tabSearch.trim().toLocaleLowerCase())) && <p className="px-2 py-2 text-xs text-zinc-500">{t("sheets.noTabsFound")}</p>}
              </div>
            </div>
          </details>
          {selectedTabs.length > 0 && <div className="flex flex-wrap gap-1.5">
            {selectedTabs.map(tabName => <button key={tabName} type="button" aria-pressed={tab === tabName} className={`inline-flex max-w-48 items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${tab === tabName ? "border-brand/40 bg-brand/10 text-brand" : "border-zinc-800 text-zinc-400 hover:bg-zinc-800"}`} onClick={() => switchBatchTab(tabName)}>{validTabDraft(draftForTab(tabName), tabName, url) && <Check className="h-3 w-3 shrink-0 text-emerald-500" />}<span className="min-w-0 truncate">{tabName}</span></button>)}
          </div>}
          <p className="text-xs text-zinc-500">{t("sheets.batchConfigHint")}</p>
          {selectedTabs.includes(tab) && <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
            <label className="block min-w-0 text-xs">{t("sheets.tab")}<input className="ui-control mt-1 block w-full px-3 py-2 text-sm leading-5 font-normal" value={tab} readOnly /></label>
            <label className="block text-xs">{t("sheets.header")}<input type="number" min={1} max={1000} className="ui-control mt-1 block w-full px-3 py-2 text-sm leading-5 font-normal" value={row} onChange={e => { setRow(Number(e.target.value)); setHeaders([]); setFields([]); setPrimaryTagFieldId(""); setActions({}); }} /></label>
            <Button variant="secondary" className="sm:min-w-28" disabled={busy || !tab || !Number.isInteger(row) || row < 1 || row > 1000} onClick={() => void run(async () => { const values = await sheetHeaders(spreadsheetId(url)!, tab, row); setHeaders(values); setPhone(current => values.includes(current) ? current : ""); setFields(current => current.filter(field => "heading" in field.column && values.filter(value => value === (field.column as { heading: string }).heading).length === 1)); })}>{t("sheets.columns")}</Button>
          </div>}
        </div> : <div className="grid gap-3 border-t border-zinc-800/70 pt-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
          <label className="block min-w-0 text-xs">{t("sheets.tab")}<select className="ui-control mt-1 block w-full px-3 py-2 text-sm leading-5 font-normal" value={tab} onChange={e => { setTab(e.target.value); setHeaders([]); setFields([]); setPrimaryTagFieldId(""); setActions({}); }}>{tabs.map(name => <option key={name}>{name}</option>)}</select></label>
          <label className="block text-xs">{t("sheets.header")}<input type="number" min={1} max={1000} className="ui-control mt-1 block w-full px-3 py-2 text-sm leading-5 font-normal" value={row} onChange={e => { setRow(Number(e.target.value)); setHeaders([]); setFields([]); setPrimaryTagFieldId(""); setActions({}); }} /></label>
          <Button variant="secondary" className="sm:min-w-28" disabled={busy || !tab || !Number.isInteger(row) || row < 1 || row > 1000} onClick={() => void run(async () => { const values = await sheetHeaders(spreadsheetId(url)!, tab, row); setHeaders(values); setPhone(current => values.includes(current) ? current : ""); setFields(current => current.filter(field => "heading" in field.column && values.filter(value => value === (field.column as { heading: string }).heading).length === 1)); })}>{t("sheets.columns")}</Button>
        </div>)}
      </fieldset>
      {headers.length > 0 && <>
        <fieldset disabled={busy || state.busy} className="space-y-3 border-t border-zinc-800 pt-4 disabled:opacity-60">
        <div className="flex items-center justify-between gap-2"><SectionLabel className="!mb-0">{t("sheets.fieldsStep")}</SectionLabel><span className="text-xs text-zinc-500">{t("sheets.selectedCount", { count: fields.length })}</span></div>
        <label className="block text-xs">{t("sheets.phone")}<select className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 block w-full" value={phone} onChange={e => setPhone(e.target.value)}><option value="">—</option>{headers.map((header, index) => <option key={index} value={header} disabled={!unique(header)}>{letter(index)} · {header || "—"}</option>)}</select></label>
        <p className="text-xs text-zinc-500">{t("sheets.phoneHint")}</p>
        <p className="text-xs">{t("sheets.fields")}</p>
        <p className="text-xs text-zinc-500">{t("sheets.columnLimit", { max: MAX_SHEET_DISPLAY_COLUMNS })}</p>
        {headers.map((header, index) => {
          if (!unique(header)) return null;
          const field = fields.find(field => "heading" in field.column && field.column.heading === header);
          const update = (patch: Partial<SheetField>) => setFields(values => values.map(value => value.id === field?.id ? { ...value, ...patch } : value));
          const setAction = (action: SheetAction | undefined) => {
            setActions(values => { const next = { ...values }; if (action) next[header] = action; else delete next[header]; return next; });
            if (field) update({ action });
          };
          return <div key={index} className="flex flex-wrap items-center gap-2 border-b border-zinc-800/70 py-2">
            <label className="flex min-w-32 items-center gap-2 text-sm leading-5"><input type="checkbox" checked={!!field} disabled={!field && fields.length >= MAX_SHEET_DISPLAY_COLUMNS} onChange={e => {
              if (e.target.checked) setFields(values => values.length >= MAX_SHEET_DISPLAY_COLUMNS ? values : [...values, { id: crypto.randomUUID(), label: header, column: { heading: header }, schedule: { kind: "interval", minutes: 15 }, action: actions[header] }]);
              else { setFields(values => values.filter(value => value.id !== field?.id)); if (field && primaryTagFieldId === field.id) setPrimaryTagFieldId(""); }
            }} />{letter(index)} · {header}</label>
            {field && <>
              <button type="button" aria-label={`${t(primaryTagFieldId === field.id ? "sheets.primaryTagUnset" : "sheets.primaryTagSet")}. ${t("sheets.primaryTagHelp")}`} title={t("sheets.primaryTagHelp")} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-amber-500/10 ${primaryTagFieldId === field.id ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400"}`} onClick={() => setPrimaryTagFieldId(current => current === field.id ? "" : field.id)} onContextMenu={event => { event.preventDefault(); editTagStyle(field); }}><Star className="h-3.5 w-3.5" fill={primaryTagFieldId === field.id ? "currentColor" : "none"} /></button>
              <input aria-label={t("sheets.label")} className="ui-control px-3 py-2 text-sm leading-5 font-normal w-36" value={field.label} onChange={e => update({ label: e.target.value })} />
              <select aria-label={t("sheets.schedule")} className="ui-control px-3 py-2 text-sm leading-5 font-normal" value={field.schedule.kind} onChange={e => update({ schedule: e.target.value === "daily" ? { kind: "daily", time: "09:00" } : e.target.value === "manual" ? { kind: "manual" } : { kind: "interval", minutes: 15 } })}><option value="interval">{t("sheets.interval")}</option><option value="daily">{t("sheets.daily")}</option><option value="manual">{t("sheets.manual")}</option></select>
              {field.schedule.kind === "interval" && <input aria-label={t("sheets.minutes")} type="number" min={1} max={525600} className="ui-control px-3 py-2 text-sm leading-5 font-normal w-24" value={field.schedule.minutes} onChange={e => update({ schedule: { kind: "interval", minutes: Number(e.target.value) } })} />}
              {field.schedule.kind === "daily" && <input aria-label={t("sheets.daily")} type="time" className="ui-control px-3 py-2 text-sm leading-5 font-normal" value={field.schedule.time} onChange={e => update({ schedule: { kind: "daily", time: e.target.value } })} />}
            </>}
            <label className="ml-auto flex shrink-0 items-center gap-2 text-xs"><span>{t("sheets.action")}</span><select aria-label={`${t("sheets.action")} ${header}`} className="ui-control px-2 py-2 text-sm leading-5" value={actions[header] || ""} onChange={e => setAction((e.target.value || undefined) as SheetAction | undefined)}><option value="">—</option><option value="edit">{t("sheets.action.edit")}</option><option value="link">{t("sheets.action.link")}</option><option value="content">{t("sheets.action.content")}</option></select></label>
          </div>;
        })}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">{t("sheets.configurationNotes")}</summary>
          <div className="mt-2 space-y-1.5 leading-5">
            <p>{t("sheets.timing")}</p>
            <p>{t("sheets.actionHint")}</p>
            <p>{t("sheets.displayHint")}</p>
          </div>
        </details>
        <div className="flex justify-end border-t border-zinc-800 pt-3"><Button variant="primary" className="shrink-0" disabled={busy || state.busy || !canSave} onClick={() => void saveDraft()}>{t(busy ? "sheets.saving" : "sheets.save")}</Button></div>
        </fieldset>
      </>}
    </>}
    {!state.email && <div className="rounded-lg border border-dashed border-zinc-800 p-5 text-xs leading-6 text-zinc-500"><p className="font-medium text-zinc-400">{t("sheets.nextTitle")}</p><p>{t("sheets.nextDescription")}</p></div>}
    {tagStyleEditor && editingTagField && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setTagStyleEditor(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="sheet-tag-style-title" className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTagStyleEditor(null); }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, input:not(:disabled)')].filter(control => control.getClientRects().length > 0);
          const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined;
          if (target) { event.preventDefault(); target.focus(); }
        }
      }}>
        <header className="mb-4 flex items-start justify-between gap-3">
          <div><h3 id="sheet-tag-style-title" className="text-sm font-semibold text-zinc-100">{t("sheets.tagStyleTitle", { field: editingTagField.label })}</h3><p className="mt-1 text-xs leading-5 text-zinc-400">{t("sheets.tagStyleHint")}</p></div>
          <button type="button" autoFocus className="ui-btn-ghost h-8 w-8 shrink-0 !px-0" onClick={() => setTagStyleEditor(null)} title={t("common.close")} aria-label={t("common.close")}><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4">
          <label className="block text-xs">{t("sheets.tagDefaultColor")}
            <select className="ui-control mt-1 w-full px-3 py-2" value={tagStyleEditor.draft.defaultColor} onChange={event => setTagStyleEditor(current => current ? { ...current, draft: { ...current.draft, defaultColor: event.target.value as SheetTagColor } } : current)}>
              {SHEET_TAG_COLORS.map(color => <option key={color} value={color}>{t(sheetTagColorLabel[color])}</option>)}
            </select>
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{t("sheets.tagRules")}</span><Button size="xs" variant="secondary" disabled={tagStyleEditor.draft.rules.length >= 10} onClick={() => setTagStyleEditor(current => current ? { ...current, draft: { ...current.draft, rules: [...current.draft.rules, { contains: "", color: current.draft.defaultColor }] } } : current)}><Plus className="h-3 w-3" />{t("sheets.tagRuleAdd")}</Button></div>
            <p className="text-[11px] leading-4 text-zinc-500">{t("sheets.tagRulesHint")}</p>
            {tagStyleEditor.draft.rules.map((rule, index) => <div key={index} className="flex items-end gap-2 rounded-lg border border-zinc-800 p-2">
              <label className="min-w-0 flex-1 text-[11px]">{t("sheets.tagRuleContains")}
                <input className="ui-control mt-1 w-full px-2.5 py-2 text-xs" maxLength={100} value={rule.contains} placeholder={t("sheets.tagRulePlaceholder")} onChange={event => setTagStyleEditor(current => current ? { ...current, draft: { ...current.draft, rules: current.draft.rules.map((item, itemIndex) => itemIndex === index ? { ...item, contains: event.target.value } : item) } } : current)} />
              </label>
              <label className="w-32 shrink-0 text-[11px]">{t("sheets.tagRuleColor")}
                <select className="ui-control mt-1 w-full px-2 py-2 text-xs" value={rule.color} onChange={event => setTagStyleEditor(current => current ? { ...current, draft: { ...current.draft, rules: current.draft.rules.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value as SheetTagColor } : item) } } : current)}>
                  {SHEET_TAG_COLORS.map(color => <option key={color} value={color}>{t(sheetTagColorLabel[color])}</option>)}
                </select>
              </label>
              <button type="button" className="ui-btn-ghost h-9 w-9 shrink-0 !px-0 text-zinc-400 hover:text-rose-400" title={t("sheets.tagRuleRemove")} aria-label={t("sheets.tagRuleRemove")} onClick={() => setTagStyleEditor(current => current ? { ...current, draft: { ...current.draft, rules: current.draft.rules.filter((_item, itemIndex) => itemIndex !== index) } } : current)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>)}
          </div>
        </div>
        <footer className="mt-5 flex justify-end gap-2 border-t border-zinc-800 pt-3">
          <Button variant="ghost" onClick={() => setTagStyleEditor(null)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={applyTagStyle}>{t("sheets.tagStyleApply")}</Button>
        </footer>
      </section>
    </div>}
  </div>;
}
