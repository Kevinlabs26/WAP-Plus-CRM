import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { idbGet, idbSet, idbDel } from "./idb";
import { isTauri } from "./bridge";
import { MAX_SHEET_DISPLAY_COLUMNS, resolveSheetColumn, sheetInternationalPhone, sheetRefreshDue, type SheetColumn, type SheetSchedule } from "./googleSheetMatch";
import { sheetErrorHint } from "./googleSheetErrors";

export interface SheetField { id: string; label: string; column: SheetColumn; schedule: SheetSchedule }
export interface SheetConfig { spreadsheet: string; tab: string; headerRow: number; phone: SheetColumn; fields: SheetField[] }
interface FieldData { at: number; values: Record<string, string[]> }
interface SheetState { ready: boolean; configured: boolean; email: string | null; config: SheetConfig | null; data: Record<string, FieldData>; error: string; busy: boolean; failures: number; retryAt: number | null; pauseReason: "authorization" | "configuration" | null }
const resetRetry = { failures: 0, retryAt: null, pauseReason: null } as const;
export const useGoogleSheets = create<SheetState>(() => ({ ready: false, configured: false, email: null, config: null, data: {}, error: "", busy: false, ...resetRetry }));
const KEY = "google-sheet-connection-v1";
let task: Promise<void> | null = null;
let configWrite: Promise<void> | null = null;
let initialized: Promise<void> | null = null;
export function initializeSheets() {
  return initialized ||= (async () => {
    if (!isTauri()) { useGoogleSheets.setState({ ready: true }); return; }
    try {
      const status = await invoke<{ configured: boolean; email: string | null }>("google_sheets_status");
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
    const status = await invoke<{ configured: boolean; email: string }>("google_sheets_connect");
    if (status.email !== useGoogleSheets.getState().email) { await idbDel(KEY); useGoogleSheets.setState({ config: null, data: {} }); }
    useGoogleSheets.setState({ ...status, ...resetRetry });
  } catch (error) { useGoogleSheets.setState({ error: String(error) }); }
  finally { useGoogleSheets.setState({ busy: false }); }
}
export async function disconnectSheets() {
  if (configWrite) await configWrite;
  if (task) await task;
  await invoke("google_sheets_disconnect");
  useGoogleSheets.setState({ email: null, config: null, data: {}, error: "", ...resetRetry });
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
    return sameSource && old && JSON.stringify(old.column) === JSON.stringify(field.column) && previous.data[field.id]
      ? [[field.id, previous.data[field.id]]] : [];
  }));
  configWrite = (async () => {
    await idbSet(KEY, { email: previous.email, config, data });
    useGoogleSheets.setState({ config, data, error: "", ...resetRetry });
  })();
  try { await configWrite; } finally { configWrite = null; }
  await refreshSheets(true);
}
interface SheetResponse { sheets?: { properties: { sheetId: number; title: string } }[]; valueRanges?: { values?: string[][] }[] }
export function readSheet(spreadsheet: string, ranges: string[] = []) {
  return invoke<SheetResponse>("google_sheets_read", { spreadsheetId: spreadsheet, ranges });
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
      const next = { ...data };
      fields.forEach((field, fieldIndex) => {
        const values: Record<string, string[]> = {};
        columns[0].forEach((raw, row) => {
          if (row < config.headerRow) return;
          // WhatsApp stores international numbers without '+'. Sheet local numbers require explicit international formatting.
          const phone = sheetInternationalPhone(String(raw));
          if (phone) (values[phone] ||= []).push(String(columns[fieldIndex + 1][row] ?? ""));
        });
        next[field.id] = { at: Date.now(), values };
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
