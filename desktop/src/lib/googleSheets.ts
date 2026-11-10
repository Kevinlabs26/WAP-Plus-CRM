import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { idbGet, idbSet, idbDel } from "./idb";
import { isTauri } from "./bridge";
import { MAX_SHEET_DISPLAY_COLUMNS, resolveSheetColumn, sheetInternationalPhone, sheetRefreshDue, type SheetColumn, type SheetSchedule } from "./googleSheetMatch";
import { sheetErrorHint } from "./googleSheetErrors";

export type SheetAction = "edit" | "link" | "content";
export interface SheetField { id: string; label: string; column: SheetColumn; schedule: SheetSchedule; action?: SheetAction }
export interface SheetConfig { spreadsheet: string; tab: string; headerRow: number; phone: SheetColumn; fields: SheetField[]; actions?: Record<string, SheetAction> }
export interface SheetCell { value: string; row: number; links: string[]; formula?: boolean }
interface FieldData { at: number; columnIndex?: number; values: Record<string, (SheetCell | string)[]> }
interface SheetState { ready: boolean; configured: boolean; email: string | null; needsAccess: boolean; config: SheetConfig | null; data: Record<string, FieldData>; error: string; busy: boolean; authorizing: boolean; failures: number; retryAt: number | null; pauseReason: "authorization" | "configuration" | null }
const resetRetry = { failures: 0, retryAt: null, pauseReason: null } as const;
export const useGoogleSheets = create<SheetState>(() => ({ ready: false, configured: false, email: null, needsAccess: false, config: null, data: {}, error: "", busy: false, authorizing: false, ...resetRetry }));
const KEY = "google-sheet-connection-v1";
let task: Promise<void> | null = null;
let configWrite: Promise<void> | null = null;
let initialized: Promise<void> | null = null;
export function initializeSheets() {
  return initialized ||= (async () => {
    if (!isTauri()) { useGoogleSheets.setState({ ready: true }); return; }
    try {
      const status = await invoke<{ configured: boolean; email: string | null; needsAccess: boolean }>("google_sheets_status");
      const stored = await idbGet<{ email: string; config: SheetConfig; data: Record<string, FieldData> }>(KEY, true);
      useGoogleSheets.setState({ ...status, ...(stored?.email === status.email ? { config: stored.config, data: stored.data } : {}), ready: true });
    } catch (error) { useGoogleSheets.setState({ ready: true, error: String(error) }); }
  })();
}
async function persist() {
  const { email, config, data } = useGoogleSheets.getState();
  await idbSet(KEY, { email, config, data });
}
export async function connectSheets() {
  useGoogleSheets.setState({ busy: true, error: "" });
  try {
    await invoke("google_sheets_prepare_connect");
    useGoogleSheets.setState({ authorizing: true });
    const status = await invoke<{ configured: boolean; email: string; needsAccess: boolean }>("google_sheets_connect");
    if (status.email !== useGoogleSheets.getState().email) { await idbDel(KEY); useGoogleSheets.setState({ config: null, data: {} }); }
    useGoogleSheets.setState({ ...status, ...resetRetry });
  } catch (error) { const message = String(error); useGoogleSheets.setState({ error: message.includes("Google authorization was cancelled") ? "" : message }); }
  finally { useGoogleSheets.setState({ busy: false, authorizing: false }); }
}
export async function cancelSheetsConnect() { await invoke("google_sheets_cancel_connect"); }
export async function disconnectSheets() {
  if (configWrite) await configWrite;
  if (task) await task;
  await invoke("google_sheets_disconnect");
  useGoogleSheets.setState({ email: null, needsAccess: false, config: null, data: {}, error: "", ...resetRetry });
  await idbDel(KEY);
}
export async function clearSheetConfig() {
  if (configWrite) await configWrite;
  if (task) await task;
  await idbDel(KEY);
  useGoogleSheets.setState({ config: null, data: {}, error: "", ...resetRetry });
}
export async function saveSheetConfig(config: SheetConfig) {
  if (config.fields.length > MAX_SHEET_DISPLAY_COLUMNS) throw new Error(`Invalid column selection: maximum ${MAX_SHEET_DISPLAY_COLUMNS} display columns`);
  if (configWrite) await configWrite;
  if (task) await task;
  const previous = useGoogleSheets.getState();
  const sameSource = previous.config?.spreadsheet === config.spreadsheet && previous.config?.tab === config.tab && previous.config?.headerRow === config.headerRow && JSON.stringify(previous.config?.phone) === JSON.stringify(config.phone);
  const data = Object.fromEntries(config.fields.flatMap(field => {
    const old = previous.config?.fields.find(item => item.id === field.id);
    return sameSource && old && JSON.stringify(old.column) === JSON.stringify(field.column) && old.action === field.action && previous.data[field.id]
      ? [[field.id, previous.data[field.id]]] : [];
  }));
  configWrite = (async () => {
    await idbSet(KEY, { email: previous.email, config, data });
    useGoogleSheets.setState({ config, data, error: "", ...resetRetry });
  })();
  try { await configWrite; } finally { configWrite = null; }
  await refreshSheets(true);
}
interface SheetResponse { properties?: { title?: string }; sheets?: { properties: { sheetId: number; title: string } }[]; valueRanges?: { values?: string[][] }[] }
interface GridCell { formattedValue?: string; hyperlink?: string; userEnteredValue?: { formulaValue?: string }; textFormatRuns?: { format?: { link?: { uri?: string } } }[] }
interface GridResponse { sheets?: { data?: { rowData?: { values?: GridCell[] }[] }[] }[] }
export function readSheet(spreadsheet: string, ranges: string[] = []) {
  return invoke<SheetResponse>("google_sheets_read", { spreadsheetId: spreadsheet, ranges });
}
function validWebLink(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
function cellLinks(cell: GridCell | undefined, value: string): string[] {
  const links = [cell?.hyperlink, ...(cell?.textFormatRuns || []).map(run => run.format?.link?.uri)];
  const formula = cell?.userEnteredValue?.formulaValue;
  const formulaUrl = formula && /HYPERLINK\s*\(\s*"((?:[^"]|"")+)"/i.exec(formula)?.[1]?.replaceAll('""', '"');
  const directUrl = /^https?:\/\//i.test(value.trim()) ? value.trim() : undefined;
  return [...new Set([...links, formulaUrl, directUrl].map(validWebLink).filter((link): link is string => !!link))];
}
async function readSheetGrid(spreadsheet: string, ranges: string[]) {
  return invoke<GridResponse>("google_sheets_read_grid", { spreadsheetId: spreadsheet, ranges });
}
export function updateSheetCell(spreadsheet: string, tab: string, column: number, row: number, value: string) {
  return invoke<void>("google_sheets_update_cell", { spreadsheetId: spreadsheet, tab, column, row, value });
}
export function updateSheetCells(spreadsheet: string, tab: string, row: number, updates: [number, string][]) {
  return invoke<void>("google_sheets_update_cells", { spreadsheetId: spreadsheet, tab, row, updates });
}
export function appendSheetRow(spreadsheet: string, tab: string, values: string[]) {
  return invoke<void>("google_sheets_append_row", { spreadsheetId: spreadsheet, tab, values });
}
export async function readGoogleDoc(urlValue: string) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") throw new Error("Only Google Docs links can be read");
  const documentId = /^\/document\/d\/([\w-]+)(?:\/|$)/.exec(url.pathname)?.[1];
  if (!documentId) throw new Error("This link is not a Google document");
  const document = await invoke<Record<string, unknown>>("google_docs_read", { documentId });
  const tabs = document.tabs as { tabProperties?: { tabId?: string }; documentTab?: { body?: { content?: unknown[] } }; childTabs?: unknown[] }[] | undefined;
  const tabId = url.searchParams.get("tab");
  const flat: typeof tabs = [];
  const visit = (items: typeof tabs) => items?.forEach(item => { flat!.push(item); visit(item.childTabs as typeof tabs); });
  visit(tabs);
  const selected = (tabId && flat?.find(tab => tab.tabProperties?.tabId === tabId)) || flat?.[0];
  const runs: { text: string; url?: string }[] = [];
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (item.textRun && typeof item.textRun === "object") {
      const run = item.textRun as { content?: string; textStyle?: { link?: { url?: string } } };
      if (run.content) runs.push({ text: run.content, ...(validWebLink(run.textStyle?.link?.url || undefined) ? { url: validWebLink(run.textStyle?.link?.url) || undefined } : {}) });
    }
    Object.values(item).forEach(collect);
  };
  collect(selected?.documentTab?.body?.content);
  return runs;
}
export function tabRange(tab: string) { return `'${tab.replace(/'/g, "''")}'`; }
export function letter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
export async function sheetHeaders(spreadsheet: string, tab: string, row: number) {
  const response = await readSheet(spreadsheet, [`${tabRange(tab)}!${row}:${row}`]);
  return (response.valueRanges?.[0]?.values || []).map(column => String(column[0] ?? ""));
}
export function refreshSheets(force = false): Promise<void> {
  if (configWrite) return configWrite;
  if (task) return task;
  const { config, email, data, failures, retryAt, pauseReason } = useGoogleSheets.getState();
  if (!config || !email) return Promise.resolve();
  if (!force && (pauseReason || (retryAt && Date.now() < retryAt))) return Promise.resolve();
  const fields = config.fields.filter(field => force || sheetRefreshDue(field.schedule, data[field.id]?.at || null, new Date()));
  if (!fields.length) return Promise.resolve();
  task = (async () => {
    useGoogleSheets.setState({ busy: true, error: "" });
    try {
      const headers = config.headerRow ? await sheetHeaders(config.spreadsheet, config.tab, config.headerRow) : [];
      const indices = [config.phone, ...fields.map(field => field.column)].map(column => resolveSheetColumn(headers, column));
      if (indices.some(index => index === null)) throw new Error("Column headings changed or are duplicated. Please configure the mapping again.");
      const ranges = indices.map(index => `${tabRange(config.tab)}!${letter(index!)}:${letter(index!)}`);
      if (config.headerRow) ranges.push(`${tabRange(config.tab)}!${config.headerRow}:${config.headerRow}`);
      const response = await readSheet(config.spreadsheet, ranges);
      if (response.valueRanges?.length !== ranges.length) throw new Error("Incomplete Google Sheets response");
      const currentHeaders = (response.valueRanges.at(-1)?.values || []).map(column => String(column[0] ?? ""));
      if (config.headerRow && JSON.stringify(currentHeaders) !== JSON.stringify(headers)) throw new Error("The sheet changed during refresh. Please try again.");
      const columns = response.valueRanges.map(range => range.values?.[0] || []);
      const actionFields = fields.filter(field => !!field.action);
      const grid = actionFields.length ? await readSheetGrid(config.spreadsheet, actionFields.map(field => {
        const index = resolveSheetColumn(headers, field.column)!;
        return `${tabRange(config.tab)}!${letter(index)}:${letter(index)}`;
      })) : null;
      const gridColumns = grid?.sheets?.flatMap(sheet => sheet.data || []).map(data => data.rowData || []) || [];
      const next = { ...data };
      fields.forEach((field, fieldIndex) => {
        const values: Record<string, (SheetCell | string)[]> = {};
        const actionCells = field.action ? gridColumns[actionFields.indexOf(field)] || [] : [];
        columns[0].forEach((raw, row) => {
          if (row < config.headerRow) return;
          // WhatsApp stores international numbers without '+'. Sheet local numbers require explicit international formatting.
          const phone = sheetInternationalPhone(String(raw));
          if (phone) {
            const value = String(columns[fieldIndex + 1][row] ?? "");
            const gridCell = actionCells[row]?.values?.[0];
            (values[phone] ||= []).push(field.action ? { value, row: row + 1, links: field.action === "link" || field.action === "content" ? cellLinks(gridCell, value) : [], formula: !!gridCell?.userEnteredValue?.formulaValue } : value);
          }
        });
        next[field.id] = { at: Date.now(), ...(field.action ? { columnIndex: indices[fieldIndex + 1]! } : {}), values };
      });
      useGoogleSheets.setState({ data: next });
      await persist();
      useGoogleSheets.setState(resetRetry);
    } catch (error) {
      const message = String(error), hint = sheetErrorHint(message);
      const count = failures + 1;
      const pauseReason = hint === "sheets.error.authorize" ? "authorization" : ["sheets.error.mapping", "sheets.error.forbidden", "sheets.error.notFound", "sheets.error.request", "sheets.error.storage", "sheets.error.build"].includes(hint) ? "configuration" : null;
      const delay = Math.min(30 * 60_000, (hint === "sheets.error.quota" ? 5 * 60_000 : 60_000) * 2 ** Math.min(count - 1, 5));
      useGoogleSheets.setState({ error: message, failures: count, pauseReason, retryAt: pauseReason ? null : Date.now() + delay });
    }
    finally { useGoogleSheets.setState({ busy: false }); }
  })().finally(() => { task = null; });
  return task;
}
