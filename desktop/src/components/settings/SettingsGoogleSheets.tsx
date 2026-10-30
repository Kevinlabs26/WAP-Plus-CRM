import { useEffect, useState } from "react";
import { Check, ExternalLink, Link2, RefreshCw, TableProperties } from "lucide-react";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import { spreadsheetId } from "@/lib/googleSheetApi";
import { MAX_SHEET_DISPLAY_COLUMNS } from "@/lib/googleSheetMatch";
import { connectSheets, disconnectSheets, initializeSheets, letter, readSheet, refreshSheets, saveSheetConfig, sheetHeaders, useGoogleSheets, type SheetField } from "@/lib/googleSheets";

export interface SheetCloseGuard {
  dirty: boolean; busy: boolean; canSave: boolean;
  save: () => Promise<boolean>;
}
export function SettingsGoogleSheets({ onCloseGuardChange }: { onCloseGuardChange?: (guard: SheetCloseGuard | null) => void } = {}) {
  const { t } = useI18n();
  const state = useGoogleSheets();
  const requestConfirm = useAppStore(s => s.requestConfirm);
  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [row, setRow] = useState(1);
  const [phone, setPhone] = useState("");
  const [fields, setFields] = useState<SheetField[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => { void initializeSheets(); }, []);
  useEffect(() => {
    setDraftReady(true);
    if (!state.config) {
      setUrl(""); setTabs([]); setTab(""); setHeaders([]); setRow(1); setPhone(""); setFields([]);
      return;
    }
    setUrl(`https://docs.google.com/spreadsheets/d/${state.config.spreadsheet}/edit`);
    setTabs([state.config.tab]); setTab(state.config.tab); setRow(state.config.headerRow);
    setFields(state.config.fields);
    setPhone("heading" in state.config.phone ? state.config.phone.heading : "");
  }, [state.config]);
  const draft = { spreadsheet: spreadsheetId(url) || url.trim(), tab, headerRow: row, phone: { heading: phone }, fields };
  const baseline = state.config || { spreadsheet: "", tab: "", headerRow: 1, phone: { heading: "" }, fields: [] };
  const dirty = draftReady && JSON.stringify(draft) !== JSON.stringify(baseline);
  const canSave = !!spreadsheetId(url) && !!tab && Number.isInteger(row) && row >= 1 && row <= 1000 && !!phone && fields.length > 0 && fields.length <= MAX_SHEET_DISPLAY_COLUMNS && fields.every(field => !!field.label.trim() && (field.schedule.kind !== "interval" || (Number.isInteger(field.schedule.minutes) && field.schedule.minutes >= 1 && field.schedule.minutes <= 525600)) && (field.schedule.kind !== "daily" || /^([01]\d|2[0-3]):[0-5]\d$/.test(field.schedule.time)));
  async function saveDraft() {
    if (!canSave || busy || state.busy) return false;
    setBusy(true); setError("");
    try { await saveSheetConfig(draft); return true; }
    catch (error) { setError(String(error)); return false; }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!onCloseGuardChange) return;
    onCloseGuardChange({ dirty, busy: busy || state.busy, canSave, save: saveDraft });
    return () => { onCloseGuardChange(null); };
  }, [onCloseGuardChange, dirty, busy, state.busy, canSave, url, tab, row, phone, fields]);
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
  return <div className="mx-auto max-w-3xl space-y-5">
    <header>
      <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-100"><TableProperties className="h-5 w-5 text-brand" />Google Sheets</h3>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{t("sheets.description")}</p>
      <p role="status" className="mt-2 text-xs text-zinc-500">{t(busy ? "sheets.saving" : dirty ? "sheets.unsaved" : "sheets.explicitSave")}</p>
    </header>
    <ol aria-label={t("sheets.setup")} className="grid grid-cols-3 gap-2">
      {[{ label: t("sheets.accountStep"), complete: !!state.email }, { label: t("sheets.sourceStep"), complete: !!state.config || !!headers.length }, { label: t("sheets.fieldsStep"), complete: !!state.config }].map((step, index) => <li key={step.label} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-500"><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${step.complete ? "bg-brand/10 text-brand" : "bg-zinc-800 text-zinc-400"}`}>{step.complete ? <Check className="h-3 w-3" /> : index + 1}</span><span>{step.label}</span></li>)}
    </ol>
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
      <div className="flex items-center justify-between gap-3"><SectionLabel className="!mb-0">{t("sheets.accountStep")}</SectionLabel><span role="status" className={`rounded-full px-2 py-1 text-[10px] ${state.email ? "bg-brand/10 text-brand" : "bg-zinc-800 text-zinc-500"}`}>{state.email ? t("sheets.connected") : t("sheets.disconnected")}</span></div>
    {state.email ? <div className="flex flex-wrap items-center justify-between gap-3"><span className="min-w-0 break-all text-sm text-zinc-200">{state.email}</span><Button variant="ghost" size="xs" disabled={busy || state.busy} onClick={() => void confirmDisconnect()}>{t("sheets.disconnect")}</Button></div> : <>
      <p className="text-xs leading-5 text-zinc-500">{t("sheets.connectHint")}</p>
      <Button variant="primary" className="gap-2" disabled={!state.ready || !state.configured || state.busy} onClick={() => void connectSheets()}>{state.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}{state.busy ? t("sheets.authorizing") : t("sheets.connect")}</Button>
      {state.ready && !state.configured && <p className="text-xs text-zinc-500">{t("sheets.notConfigured")}</p>}
    </>}
      <details className="border-t border-zinc-800 pt-3 text-xs text-zinc-500"><summary className="cursor-pointer">{t("sheets.accessDetails")}</summary><p className="mt-2 leading-5">{t("sheets.permission")}</p></details>
    </section>
    {(error || state.error) && <div role="alert" className="break-words rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-400"><p>{t(sheetErrorHint(error || state.error))}</p><details className="mt-2 text-zinc-500"><summary className="cursor-pointer">{t("sheets.error.details")}</summary><p className="mt-1 whitespace-pre-wrap">{error || state.error}</p></details></div>}
    {state.pauseReason && <p role="status" className="text-xs text-amber-500">{t(state.pauseReason === "authorization" ? "sheets.retry.authorization" : "sheets.retry.configuration")}</p>}
    {state.retryAt && <p role="status" className="text-xs text-zinc-500">{t("sheets.retry.waiting", { time: new Date(state.retryAt).toLocaleTimeString() })}</p>}
    {state.email && <>
      {state.config && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand/5 p-3"><p role="status" className="text-xs text-brand">{t("sheets.saved", { tab: state.config.tab, count: state.config.fields.length })}</p><Button size="xs" disabled={busy || state.busy} onClick={() => void refreshSheets(true)} className="gap-1.5"><RefreshCw className={`h-3 w-3 ${state.busy ? "animate-spin" : ""}`} />{t("sheets.refresh")}</Button></div>}
      <fieldset disabled={busy || state.busy} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/35 p-4 disabled:opacity-60">
      <SectionLabel className="flex items-center gap-2"><Link2 className="h-3.5 w-3.5" />{t("sheets.sourceStep")}</SectionLabel>
      <label className="block text-xs">{t("sheets.url")}<input className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 w-full" value={url} onChange={e => { setUrl(e.target.value); setHeaders([]); setTabs([]); setFields([]); }} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
      <Button variant="secondary" disabled={busy || state.busy || !spreadsheetId(url)} onClick={() => void run(async () => { const result = await readSheet(spreadsheetId(url)!); const names = result.sheets?.map(sheet => sheet.properties.title) || []; const selected = names.includes(tab) ? tab : names[0] || ""; setTabs(names); setTab(selected); setHeaders([]); if (selected !== tab) { setFields([]); setPhone(""); } })}>{t("sheets.load")}</Button>
      {tabs.length > 0 && <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">{t("sheets.tab")}<select className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 block" value={tab} onChange={e => { setTab(e.target.value); setHeaders([]); setFields([]); }}>{tabs.map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="text-xs">{t("sheets.header")}<input type="number" min={1} max={1000} className="ui-control px-3 py-2 text-sm leading-5 font-normal mt-1 block w-24" value={row} onChange={e => { setRow(Number(e.target.value)); setHeaders([]); setFields([]); }} /></label>
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
          return <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 p-2">
            <label className="flex min-w-32 items-center gap-2 text-sm leading-5"><input type="checkbox" checked={!!field} disabled={!field && fields.length >= MAX_SHEET_DISPLAY_COLUMNS} onChange={e => setFields(values => e.target.checked ? values.length >= MAX_SHEET_DISPLAY_COLUMNS ? values : [...values, { id: crypto.randomUUID(), label: header, column: { heading: header }, schedule: { kind: "interval", minutes: 15 } }] : values.filter(value => value.id !== field?.id))} />{letter(index)} · {header}</label>
            {field && <>
              <input aria-label={t("sheets.label")} className="ui-control px-3 py-2 text-sm leading-5 font-normal w-36" value={field.label} onChange={e => update({ label: e.target.value })} />
              <select aria-label={t("sheets.schedule")} className="ui-control px-3 py-2 text-sm leading-5 font-normal" value={field.schedule.kind} onChange={e => update({ schedule: e.target.value === "daily" ? { kind: "daily", time: "09:00" } : e.target.value === "manual" ? { kind: "manual" } : { kind: "interval", minutes: 15 } })}><option value="interval">{t("sheets.interval")}</option><option value="daily">{t("sheets.daily")}</option><option value="manual">{t("sheets.manual")}</option></select>
              {field.schedule.kind === "interval" && <label className="flex items-center gap-2 text-sm leading-5"><input aria-label={t("sheets.minutes")} type="number" min={1} max={525600} className="ui-control px-3 py-2 text-sm leading-5 font-normal w-24" value={field.schedule.minutes} onChange={e => update({ schedule: { kind: "interval", minutes: Number(e.target.value) } })} />{t("sheets.minutes")}</label>}
              {field.schedule.kind === "daily" && <input aria-label={t("sheets.daily")} type="time" className="ui-control px-3 py-2 text-sm leading-5 font-normal" value={field.schedule.time} onChange={e => update({ schedule: { kind: "daily", time: e.target.value } })} />}
            </>}
          </div>;
        })}
        <p className="text-xs text-zinc-500">{t("sheets.timing")}</p>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3"><p className="text-xs leading-5 text-zinc-500">{t("sheets.displayHint")}</p><Button variant="primary" className="shrink-0" disabled={busy || state.busy || !canSave} onClick={() => void saveDraft()}>{t(busy ? "sheets.saving" : "sheets.save")}</Button></div>
        </fieldset>
      </>}
    </>}
    {!state.email && <div className="rounded-xl border border-dashed border-zinc-800 p-5 text-xs leading-6 text-zinc-500"><p className="font-medium text-zinc-400">{t("sheets.nextTitle")}</p><p>{t("sheets.nextDescription")}</p></div>}
  </div>;
}
