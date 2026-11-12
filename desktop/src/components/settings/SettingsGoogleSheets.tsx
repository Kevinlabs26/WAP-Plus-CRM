import { useEffect, useState } from "react";
import { ExternalLink, Link2, RefreshCw, TableProperties } from "lucide-react";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import { spreadsheetId } from "@/lib/googleSheetApi";
import { MAX_SHEET_DISPLAY_COLUMNS } from "@/lib/googleSheetMatch";
import { cancelSheetsConnect, connectSheets, disconnectSheets, initializeSheets, letter, readSheet, refreshSheets, saveSheetConfig, sheetHeaders, useGoogleSheets, sheetConnections, removeSheetConnection, DEFAULT_SHEET_ID, type SheetAction, type SheetField } from "@/lib/googleSheets";

export interface SheetCloseGuard {
  dirty: boolean; busy: boolean; canSave: boolean;
  save: () => Promise<boolean>;
}
export function SettingsGoogleSheets({ onCloseGuardChange }: { onCloseGuardChange?: (guard: SheetCloseGuard | null) => void } = {}) {
  const { t } = useI18n();
  const allState = useGoogleSheets();
  const [connectionId,setConnectionId]=useState<string|null>(null);
  const [name,setName]=useState("");
  const connections=sheetConnections(allState),connection=connections.find(item=>item.id===connectionId);
  const state={...allState,config:connection?.config||null,data:connection?.data||{},error:connection?connection.error:allState.error,pauseReason:connection?.pauseReason||null,retryAt:connection?.retryAt||null};
  const requestConfirm = useAppStore(s => s.requestConfirm);
  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [row, setRow] = useState(1);
  const [phone, setPhone] = useState("");
  const [fields, setFields] = useState<SheetField[]>([]);
  const [actions, setActions] = useState<Record<string, SheetAction>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => { void initializeSheets(); }, []);
  useEffect(()=>{setConnectionId(null);setName("");},[allState.email]);
  useEffect(() => {
    setDraftReady(true);
    if (!state.config) {
      setUrl(""); setTabs([]); setTab(""); setHeaders([]); setRow(1); setPhone(""); setFields([]); setActions({});
      return;
    }
    setUrl(`https://docs.google.com/spreadsheets/d/${state.config.spreadsheet}/edit`);
    setTabs([state.config.tab]); setTab(state.config.tab); setRow(state.config.headerRow);
    setFields(state.config.fields);
    setActions({ ...(state.config.actions || {}), ...Object.fromEntries(state.config.fields.flatMap(field => field.action ? [["heading" in field.column ? field.column.heading : letter(field.column.position), field.action]] : [])) });
    setPhone("heading" in state.config.phone ? state.config.phone.heading : "");
  }, [state.config,connectionId]);
  const draft = { spreadsheet: spreadsheetId(url) || url.trim(), tab, headerRow: row, phone: { heading: phone }, fields, actions };
  const baseline = state.config ? { ...state.config, actions: state.config.actions || {} } : { spreadsheet: "", tab: "", headerRow: 1, phone: { heading: "" }, fields: [], actions: {} };
  const dirty = connectionId!==null&&draftReady && (JSON.stringify(draft) !== JSON.stringify(baseline)||name.trim()!==(connection?.name||""));
  const canSave = draftReady&&!!name.trim()&&!!spreadsheetId(url) && !!tab && Number.isInteger(row) && row >= 1 && row <= 1000 && !!phone && fields.length > 0 && fields.length <= MAX_SHEET_DISPLAY_COLUMNS && fields.every(field => !!field.label.trim() && (field.schedule.kind !== "interval" || (Number.isInteger(field.schedule.minutes) && field.schedule.minutes >= 1 && field.schedule.minutes <= 525600)) && (field.schedule.kind !== "daily" || /^([01]\d|2[0-3]):[0-5]\d$/.test(field.schedule.time)));
  async function saveDraft() {
    if (!canSave || !connectionId||!name.trim()||busy || state.busy) return false;
    setBusy(true); setError("");
    try { await saveSheetConfig(draft,connectionId,name);setConnectionId(null);return true; }
    catch (error) { setError(String(error)); return false; }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!onCloseGuardChange) return;
    onCloseGuardChange({ dirty, busy: busy || state.busy, canSave, save: saveDraft });
    return () => { onCloseGuardChange(null); };
  }, [onCloseGuardChange, dirty, busy, state.busy, canSave, url, tab, row, phone, fields,name,connectionId]);
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
  async function editConnection(id:string|null,label=""){
    if(id===connectionId)return;
    if(dirty&&!await requestConfirm({title:t("sheets.discardTitle"),description:t("sheets.discardHint"),confirmLabel:t("sheets.discard"),tone:"danger"}))return;
    setDraftReady(false);setConnectionId(id);setName(label);setError("");
  }
  return <div className="mx-auto max-w-3xl space-y-5">
    <header className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-100"><TableProperties className="h-5 w-5 text-brand" />Google Sheets</h3>
      {state.email&&<Button size="sm" disabled={busy||state.busy} onClick={()=>void editConnection(connections.length?crypto.randomUUID():DEFAULT_SHEET_ID,t("sheets.newName",{count:connections.length+1}))}>{t("sheets.add")}</Button>}
    </header>
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
    {state.email&&<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-zinc-500"><tr>{(["name","tab","fields","status","operations"] as const).map(key=><th key={key} className="px-2 py-2 font-medium">{t(`sheets.table.${key}`)}</th>)}</tr></thead><tbody className="divide-y divide-zinc-800">{connections.map(item=><tr key={item.id} className={connectionId===item.id?"bg-brand/5":""}>
      <td className="max-w-40 truncate px-2 py-3 font-medium" title={item.name}>{item.name}</td><td className="max-w-40 truncate px-2 py-3" title={item.config.tab}>{item.config.tab}</td><td className="px-2 py-3">{item.config.fields.length}</td><td className="px-2 py-3" title={item.error}>{t(item.error?"sheets.table.error":"sheets.table.ready")}</td>
      <td className="px-2 py-2"><div className="flex gap-2"><Button size="xs" disabled={busy||state.busy} onClick={()=>void editConnection(item.id,item.name)}>{t("sheets.edit")}</Button><Button size="xs" disabled={busy||state.busy} onClick={()=>void refreshSheets(true,item.id)}>{t("sheets.refresh")}</Button><Button size="xs" disabled={busy||state.busy} onClick={()=>void run(async()=>{if(await requestConfirm({title:t("sheets.removeTitle",{name:item.name}),description:t("sheets.removeHint"),confirmLabel:t("common.delete"),tone:"danger"})){await removeSheetConnection(item.id);if(connectionId===item.id)setConnectionId(null);}})}>{t("common.delete")}</Button></div></td>
    </tr>)}</tbody></table>{!connections.length&&<p className="py-4 text-xs text-zinc-500">{t("sheets.empty")}</p>}</div>}
    {state.email && connectionId && <>
      <div className="flex flex-wrap items-center gap-2"><input aria-label={t("sheets.table.name")} className="ui-control min-w-40 flex-1 px-3 py-2 text-sm" maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder={t("sheets.table.name")}/><Button size="sm" variant="primary" disabled={busy||state.busy||!canSave||!name.trim()} onClick={()=>void saveDraft()}>{t("sheets.save")}</Button><Button size="sm" disabled={busy||state.busy} onClick={()=>void editConnection(null)}>{t("common.close")}</Button><span role="status" className="text-xs text-zinc-500">{t(busy?"sheets.saving":dirty?"sheets.unsaved":"sheets.explicitSave")}</span></div>
      <fieldset disabled={busy || state.busy} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/35 p-4 disabled:opacity-60">
      <SectionLabel className="flex items-center gap-2"><Link2 className="h-3.5 w-3.5" />{t("sheets.sourceStep")}</SectionLabel>
      <label className="block text-xs">{t("sheets.url")}<input className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 w-full" value={url} onChange={e => { setUrl(e.target.value); setHeaders([]); setTabs([]); setFields([]); setActions({}); }} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
      <Button variant="secondary" disabled={busy || state.busy || !spreadsheetId(url)} onClick={() => void run(async () => { const result = await readSheet(spreadsheetId(url)!); const names = result.sheets?.map(sheet => sheet.properties.title) || []; const selected = names.includes(tab) ? tab : names[0] || ""; setTabs(names); setTab(selected); setHeaders([]); if (selected !== tab) { setFields([]); setPhone(""); setActions({}); } })}>{t("sheets.load")}</Button>
      {tabs.length > 0 && <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">{t("sheets.tab")}<select className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 block" value={tab} onChange={e => { setTab(e.target.value); setHeaders([]); setFields([]); setActions({}); }}>{tabs.map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="text-xs">{t("sheets.header")}<input type="number" min={1} max={1000} className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 block w-24" value={row} onChange={e => { setRow(Number(e.target.value)); setHeaders([]); setFields([]); setActions({}); }} /></label>
        <Button variant="secondary" disabled={busy || !tab || !Number.isInteger(row) || row < 1 || row > 1000} onClick={() => void run(async () => { const values = await sheetHeaders(spreadsheetId(url)!, tab, row); setHeaders(values); setPhone(current => values.includes(current) ? current : ""); setFields(current => current.filter(field => "heading" in field.column && values.filter(value => value === (field.column as { heading: string }).heading).length === 1)); })}>{t("sheets.columns")}</Button>
      </div>}
      </fieldset>
      {headers.length > 0 && <>
        <fieldset disabled={busy || state.busy} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/35 p-4 disabled:opacity-60">
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
            <label className="flex min-w-32 items-center gap-2 text-sm leading-5"><input type="checkbox" checked={!!field} disabled={!field && fields.length >= MAX_SHEET_DISPLAY_COLUMNS} onChange={e => setFields(values => e.target.checked ? values.length >= MAX_SHEET_DISPLAY_COLUMNS ? values : [...values, { id: crypto.randomUUID(), label: header, column: { heading: header }, schedule: { kind: "interval", minutes: 15 }, action: actions[header] }] : values.filter(value => value.id !== field?.id))} />{letter(index)} · {header}</label>
            {field && <>
              <input aria-label={t("sheets.label")} className="ui-control px-3 py-2 text-sm leading-5 font-normal w-36" value={field.label} onChange={e => update({ label: e.target.value })} />
              <select aria-label={t("sheets.schedule")} className="ui-control px-3 py-2 text-sm leading-5 font-normal" value={field.schedule.kind} onChange={e => update({ schedule: e.target.value === "daily" ? { kind: "daily", time: "09:00" } : e.target.value === "manual" ? { kind: "manual" } : { kind: "interval", minutes: 15 } })}><option value="interval">{t("sheets.interval")}</option><option value="daily">{t("sheets.daily")}</option><option value="manual">{t("sheets.manual")}</option></select>
              {field.schedule.kind === "interval" && <input aria-label={t("sheets.minutes")} type="number" min={1} max={525600} className="ui-control px-3 py-2 text-sm leading-5 font-normal w-24" value={field.schedule.minutes} onChange={e => update({ schedule: { kind: "interval", minutes: Number(e.target.value) } })} />}
              {field.schedule.kind === "daily" && <input aria-label={t("sheets.daily")} type="time" className="ui-control px-3 py-2 text-sm leading-5 font-normal" value={field.schedule.time} onChange={e => update({ schedule: { kind: "daily", time: e.target.value } })} />}
            </>}
            <label className="ml-auto flex shrink-0 items-center gap-2 text-xs"><span>{t("sheets.action")}</span><select aria-label={`${t("sheets.action")} ${header}`} className="ui-control px-2 py-2 text-sm leading-5" value={actions[header] || ""} onChange={e => setAction((e.target.value || undefined) as SheetAction | undefined)}><option value="">—</option><option value="edit">{t("sheets.action.edit")}</option><option value="link">{t("sheets.action.link")}</option><option value="content">{t("sheets.action.content")}</option></select></label>
          </div>;
        })}
        <p className="text-xs text-zinc-500">{t("sheets.timing")}</p>
        <p className="text-xs text-zinc-500">{t("sheets.actionHint")}</p>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3"><p className="text-xs leading-5 text-zinc-500">{t("sheets.displayHint")}</p><Button variant="primary" className="shrink-0" disabled={busy || state.busy || !canSave} onClick={() => void saveDraft()}>{t(busy ? "sheets.saving" : "sheets.save")}</Button></div>
        </fieldset>
      </>}
    </>}
    {!state.email && <div className="rounded-xl border border-dashed border-zinc-800 p-5 text-xs leading-6 text-zinc-500"><p className="font-medium text-zinc-400">{t("sheets.nextTitle")}</p><p>{t("sheets.nextDescription")}</p></div>}
  </div>;
}
