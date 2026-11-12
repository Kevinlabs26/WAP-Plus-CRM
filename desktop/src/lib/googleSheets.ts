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
export const DEFAULT_SHEET_ID="default";
export interface SheetConnection { id:string; name:string; config:SheetConfig; data:Record<string,FieldData>; error:string; failures:number; retryAt:number|null; pauseReason:"authorization"|"configuration"|null }
interface SheetState { ready: boolean; configured: boolean; email: string | null; needsAccess: boolean; config: SheetConfig | null; data: Record<string, FieldData>; error: string; busy: boolean; authorizing: boolean; failures: number; retryAt: number | null; pauseReason: "authorization" | "configuration" | null; connections:Record<string,SheetConnection>; defaultName:string }
const resetRetry = { failures: 0, retryAt: null, pauseReason: null } as const;
export const useGoogleSheets = create<SheetState>(() => ({ ready: false, configured: false, email: null, needsAccess: false, config: null, data: {}, error: "", busy: false, authorizing: false, connections:{},defaultName:"", ...resetRetry }));
export function sheetConnections(state=useGoogleSheets.getState()):SheetConnection[]{
  return [...(state.config?[{id:DEFAULT_SHEET_ID,name:state.defaultName||state.config.tab,config:state.config,data:state.data,error:state.error,failures:state.failures,retryAt:state.retryAt,pauseReason:state.pauseReason}]:[]),...Object.values(state.connections||{})];
}
function updateConnection(id:string,patch:Partial<Omit<SheetConnection,"id"|"name">>){
  if(id===DEFAULT_SHEET_ID)useGoogleSheets.setState(patch);
  else useGoogleSheets.setState(state=>state.connections[id]?{connections:{...state.connections,[id]:{...state.connections[id],...patch}}}:{});
}
const KEY = "google-sheet-connection-v1";
let task: Promise<void> | null = null;
let configWrite: Promise<void> | null = null;
let initialized: Promise<void> | null = null;
const refreshes=new Map<string,Promise<void>>();
export function initializeSheets() {
  return initialized ||= (async () => {
    if (!isTauri()) { useGoogleSheets.setState({ ready: true }); return; }
    try {
      const status = await invoke<{ configured: boolean; email: string | null; needsAccess: boolean }>("google_sheets_status");
      const stored = await idbGet<{ email: string; config: SheetConfig; data: Record<string, FieldData>; connections?:Record<string,SheetConnection>;defaultName?:string }>(KEY, true);
      const connections=Object.fromEntries(Object.entries(stored?.connections||{}).filter(([id,entry])=>id!==DEFAULT_SHEET_ID&&/^[\w-]{1,120}$/.test(id)&&entry?.config?.spreadsheet&&Array.isArray(entry.config.fields)).map(([id,entry])=>[id,{...entry,id,name:String(entry.name||entry.config.tab).slice(0,120),data:entry.data||{},error:"",...resetRetry}]));
      useGoogleSheets.setState({ ...status, ...(stored?.email === status.email ? { config: stored.config||null, data: stored.data||{},connections,defaultName:stored.defaultName||"" } : {}), ready: true });
    } catch (error) { useGoogleSheets.setState({ ready: true, error: String(error) }); }
  })();
}
async function persist() {
  const { email, config, data, connections,defaultName } = useGoogleSheets.getState();
  await idbSet(KEY, { email, config, data,connections,defaultName });
}
export async function connectSheets() {
  useGoogleSheets.setState({ busy: true, error: "" });
  try {
    await invoke("google_sheets_prepare_connect");
    useGoogleSheets.setState({ authorizing: true });
    const status = await invoke<{ configured: boolean; email: string; needsAccess: boolean }>("google_sheets_connect");
    if (status.email !== useGoogleSheets.getState().email) { if(task)await task;await idbDel(KEY); useGoogleSheets.setState({ config: null, data: {},connections:{},defaultName:"" }); }
    useGoogleSheets.setState({ ...status, ...resetRetry });
  } catch (error) { const message = String(error); useGoogleSheets.setState({ error: message.includes("Google authorization was cancelled") ? "" : message }); }
  finally { useGoogleSheets.setState({ busy: false, authorizing: false }); }
}
export async function cancelSheetsConnect() { await invoke("google_sheets_cancel_connect"); }
export async function disconnectSheets() {
  while(configWrite||task){if(configWrite)await configWrite;if(task)await task;}
  await invoke("google_sheets_disconnect");
  useGoogleSheets.setState({ email: null, needsAccess: false, config: null, data: {},connections:{},defaultName:"", error: "", ...resetRetry });
  await idbDel(KEY);
}
export async function clearSheetConfig() {
  while(configWrite||task){if(configWrite)await configWrite;if(task)await task;}
  await idbDel(KEY);
  useGoogleSheets.setState({ config: null, data: {},connections:{},defaultName:"", error: "", ...resetRetry });
}
export async function saveSheetConfig(config: SheetConfig,connectionId=DEFAULT_SHEET_ID,name?:string) {
  if(!/^[\w-]{1,120}$/.test(connectionId))throw Error("Invalid sheet connection ID");
  if(name!==undefined&&!name.trim())throw Error("Sheet name is required");
  if (config.fields.length > MAX_SHEET_DISPLAY_COLUMNS) throw new Error(`Invalid column selection: maximum ${MAX_SHEET_DISPLAY_COLUMNS} display columns`);
  while(configWrite||task){if(configWrite)await configWrite;if(task)await task;}
  const previous = useGoogleSheets.getState();
  const oldConnection=sheetConnections(previous).find(item=>item.id===connectionId);
  const oldConfig=oldConnection?.config,oldData=oldConnection?.data||{};
  const sameSource = oldConfig?.spreadsheet === config.spreadsheet && oldConfig?.tab === config.tab && oldConfig?.headerRow === config.headerRow && JSON.stringify(oldConfig?.phone) === JSON.stringify(config.phone);
  const data = Object.fromEntries(config.fields.flatMap(field => {
    const old = oldConfig?.fields.find(item => item.id === field.id);
    return sameSource && old && JSON.stringify(old.column) === JSON.stringify(field.column) && old.action === field.action && oldData[field.id]
      ? [[field.id, oldData[field.id]]] : [];
  }));
  configWrite = (async () => {
    const connection:SheetConnection={id:connectionId,name:(name?.trim()||oldConnection?.name||config.tab).slice(0,120),config,data,error:"",...resetRetry};
    const patch=connectionId===DEFAULT_SHEET_ID?{config,data,defaultName:connection.name,error:"",...resetRetry}:{connections:{...previous.connections,[connectionId]:connection}};
    const next={...previous,...patch};
    await idbSet(KEY,{email:next.email,config:next.config,data:next.data,connections:next.connections,defaultName:next.defaultName});
    useGoogleSheets.setState(patch);
  })();
  try { await configWrite; } finally { configWrite = null; }
  await refreshSheets(true,connectionId);
}
export async function removeSheetConnection(id:string){
  while(configWrite||task){if(configWrite)await configWrite;if(task)await task;}
  const state=useGoogleSheets.getState(),connections={...state.connections};delete connections[id];
  const patch=id===DEFAULT_SHEET_ID?{config:null,data:{},defaultName:"",error:"",...resetRetry}:{connections};
  const next={...state,...patch};
  configWrite=(async()=>{await idbSet(KEY,{email:next.email,config:next.config,data:next.data,connections:next.connections,defaultName:next.defaultName});useGoogleSheets.setState(patch);})();
  try{await configWrite;}finally{configWrite=null;}
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
export function refreshSheets(force = false,connectionId=DEFAULT_SHEET_ID): Promise<void> {
  const queued=refreshes.get(connectionId);if(queued)return queued;
  const previous=task,write=configWrite;
  const current=(async()=>{if(write)await write;if(previous)await previous;await refreshConnection(force,connectionId);})().finally(()=>{refreshes.delete(connectionId);if(task===current)task=null;});
  refreshes.set(connectionId,current);task=current;return current;
}
export async function refreshAllSheets(){for(const connection of sheetConnections())await refreshSheets(false,connection.id);}
async function refreshConnection(force:boolean,connectionId:string):Promise<void>{
  const state=useGoogleSheets.getState(),connection=sheetConnections(state).find(item=>item.id===connectionId);
  if(!connection||!state.email)return;
  const {config,data,failures,retryAt,pauseReason}=connection;
  if (!force && (pauseReason || (retryAt && Date.now() < retryAt))) return;
  const fields = config.fields.filter(field => force || sheetRefreshDue(field.schedule, data[field.id]?.at || null, new Date()));
  if (!fields.length) return;
    useGoogleSheets.setState({ busy: true });updateConnection(connectionId,{error:""});
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
      updateConnection(connectionId,{data:next});
      await persist();
      updateConnection(connectionId,resetRetry);
    } catch (error) {
      const message = String(error), hint = sheetErrorHint(message);
      const count = failures + 1;
      const pauseReason = hint === "sheets.error.authorize" ? "authorization" : ["sheets.error.mapping", "sheets.error.forbidden", "sheets.error.notFound", "sheets.error.request", "sheets.error.storage", "sheets.error.build"].includes(hint) ? "configuration" : null;
      const delay = Math.min(30 * 60_000, (hint === "sheets.error.quota" ? 5 * 60_000 : 60_000) * 2 ** Math.min(count - 1, 5));
      updateConnection(connectionId,{ error: message, failures: count, pauseReason, retryAt: pauseReason ? null : Date.now() + delay });
    }
    finally { useGoogleSheets.setState({ busy: false }); }
}
