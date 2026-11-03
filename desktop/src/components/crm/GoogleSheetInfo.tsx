import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { letter, readGoogleDoc, readSheet, refreshSheets, sheetHeaders, tabRange, updateSheetCell, useGoogleSheets, type SheetCell, type SheetField } from "@/lib/googleSheets";
import { resolveSheetColumn, sheetInternationalPhone } from "@/lib/googleSheetMatch";
import { sheetErrorHint } from "@/lib/googleSheetErrors";
import type { Contact } from "@/types/crm";

function asCells(value: unknown): SheetCell[] {
  if (!Array.isArray(value)) return [];
  return value.map((cell, index) => typeof cell === "string" ? { value: cell, row: index + 1, links: [] } : cell as SheetCell);
}

function SheetValue({ contact, field, cell, columnIndex, active }: { contact: Contact; field: SheetField; cell: SheetCell; columnIndex: number; active: boolean }) {
  const { t } = useI18n();
  const state = useGoogleSheets();
  const [draft, setDraft] = useState(cell.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [docRuns, setDocRuns] = useState<{ text: string; url?: string }[] | null>(null);
  const [docError, setDocError] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(cell.value), [cell.value]);
  useEffect(() => {
    if (!active || field.action !== "content" || !cell.links[0] || docRuns) return;
    let canceled = false;
    void readGoogleDoc(cell.links[0]).then(runs => { if (!canceled) setDocRuns(runs); }).catch(reason => { if (!canceled) setDocError(String(reason)); });
    return () => { canceled = true; };
  }, [active, field.action, cell.links, docRuns]);
  async function save() {
    if (!state.config || busy) return;
    setBusy(true); setError("");
    try {
      if (cell.formula) throw new Error("formula cells are protected");
      const headers = await sheetHeaders(state.config.spreadsheet, state.config.tab, state.config.headerRow);
      const currentColumn = resolveSheetColumn(headers, field.column);
      const phoneColumn = resolveSheetColumn(headers, state.config.phone);
      if (currentColumn === null || currentColumn !== columnIndex || phoneColumn === null) throw new Error("The sheet columns changed. Refresh the data and try again.");
      const check = await readSheet(state.config.spreadsheet, [
        `${tabRange(state.config.tab)}!${letter(phoneColumn)}${cell.row}`,
        `${tabRange(state.config.tab)}!${letter(columnIndex)}${cell.row}`,
      ]);
      const currentPhone = sheetInternationalPhone(String(check.valueRanges?.[0]?.values?.[0]?.[0] ?? ""));
      const currentValue = String(check.valueRanges?.[1]?.values?.[0]?.[0] ?? "");
      if (currentPhone !== sheetInternationalPhone(contact.phone) || currentValue !== cell.value) throw new Error("This row changed since it was loaded. Refresh before editing.");
      await updateSheetCell(state.config.spreadsheet, state.config.tab, columnIndex, cell.row, draft);
      await refreshSheets(true);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  if (field.action === "edit") return <div className="space-y-1">
    <textarea aria-label={field.label} className="ui-control min-h-16 w-full px-2 py-1.5 text-xs" value={draft} onChange={event => setDraft(event.target.value)} />
    <div className="flex items-center gap-2"><button className="text-brand disabled:opacity-50" disabled={busy || draft === cell.value} onClick={() => void save()}>{t(busy ? "sheets.saving" : "sheets.writeBack")}</button>{error && <span role="alert" className="break-words text-red-400">{error === "formula cells are protected" ? t("sheets.formulaEditBlocked") : t(sheetErrorHint(error))}</span>}</div>
  </div>;
  if (field.action === "link") return <div className="break-all">
    {cell.links.length ? cell.links.map(link => <a key={link} className="text-brand underline" href={link} target="_blank" rel="noreferrer">{link}</a>) : cell.value || "—"}
  </div>;
  if (field.action === "content") return <div className="space-y-1">
    {!cell.links.length ? <p className="whitespace-pre-wrap break-words">{cell.value || "—"}</p> : docRuns ? <>
      <div className={`whitespace-pre-wrap break-words ${expanded ? "" : "max-h-24 overflow-hidden"}`}>
        {docRuns.map((run, index) => run.url ? <a key={index} className="text-brand underline" href={run.url} target="_blank" rel="noreferrer">{run.text}</a> : <span key={index}>{run.text}</span>)}
      </div>
      {docRuns.reduce((length, run) => length + run.text.length, 0) > 120 && <button className="text-brand" onClick={() => setExpanded(value => !value)}>{t(expanded ? "sheets.showLess" : "sheets.showMore")}</button>}
      <a className="ml-2 text-zinc-500 underline" href={cell.links[0]} target="_blank" rel="noreferrer">{t("sheets.openSource")}</a>
    </> : docError ? <p role="alert" className="break-words text-amber-400">{t(sheetErrorHint(docError))} <a className="underline" href={cell.links[0]} target="_blank" rel="noreferrer">{t("sheets.openSource")}</a></p> : <p className="text-zinc-500">{t("sheets.loadingContent")}</p>}
  </div>;
  return <p className="whitespace-pre-wrap break-words">{cell.value || "—"}</p>;
}

export function GoogleSheetInfo({ contact, open = false }: { contact: Contact; open?: boolean }) {
  const { t } = useI18n();
  const { email, config, data, error, busy } = useGoogleSheets();
  const [expanded, setExpanded] = useState(open);
  useEffect(() => { if (open) setExpanded(true); }, [open]);
  if (!email || !config || contact.isGroup) return null;
  const phone = sheetInternationalPhone(contact.phone);
  return <details open={expanded || undefined} onToggle={event => setExpanded(event.currentTarget.open)} className="rounded-xl border border-zinc-800 p-2.5">
    <summary className="cursor-pointer text-xs font-medium">{t("sheets.info")}</summary>
    {expanded && <div className="mt-2 space-y-2 text-xs">
      <div className="flex justify-between gap-2 text-zinc-500"><span className="truncate" title={config.tab}>{config.tab}</span><button className="text-brand" disabled={busy} onClick={() => void refreshSheets(true)}>{t("sheets.refresh")}</button></div>
      {error && <p role="alert" className="text-amber-400">{t("sheets.stale")} {t(sheetErrorHint(error))}</p>}
      {!phone ? <p className="text-zinc-500">{t("sheets.noPhone")}</p> : config.fields.map(field => {
        const cached = data[field.id];
        const values = asCells(cached?.values[phone]);
        return <div key={field.id} title={cached ? `${t("sheets.updated")} ${new Date(cached.at).toLocaleString()}` : t("sheets.notLoaded")}>
          <div className="text-zinc-500">{field.label}</div>
          {!cached ? <p>{t("sheets.notLoaded")}</p> : !values.length ? <p>{t("sheets.noMatch")}</p> : values.map((cell, index) => <div key={`${cell.row}-${index}`} className="mb-1">
            {values.length > 1 && <span className="text-zinc-500">{index + 1}. </span>}
            <SheetValue contact={contact} field={field} cell={cell} columnIndex={cached.columnIndex} active={expanded} />
          </div>)}
        </div>;
      })}
    </div>}
  </details>;
}
