import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { idbGet, idbSet, idbDel } from "./idb.ts";
import { isTauri } from "./bridge.ts";
import { MAX_SHEET_DISPLAY_COLUMNS, resolveSheetColumn, sheetInternationalPhone, sheetRefreshDue, type SheetColumn, type SheetSchedule } from "./googleSheetMatch.ts";
import { sheetErrorHint } from "./googleSheetErrors.ts";

export type SheetAction = "edit" | "link" | "content";
export const SHEET_TAG_COLORS = ["amber", "emerald", "red", "blue", "violet", "zinc"] as const;
export type SheetTagColor = typeof SHEET_TAG_COLORS[number];
export interface SheetTagRule { contains: string; color: SheetTagColor }
export interface SheetTagStyle { defaultColor: SheetTagColor; rules: SheetTagRule[] }
export interface SheetField { id: string; label: string; column: SheetColumn; schedule: SheetSchedule; action?: SheetAction; primaryTagStyle?: SheetTagStyle }
export interface SheetConfig { spreadsheet: string; tab: string; headerRow: number; phone: SheetColumn; fields: SheetField[]; primaryTagFieldId?: string; actions?: Record<string, SheetAction> }
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
export function normalizeSheetTagStyle(value:unknown):SheetTagStyle{
  const style=value&&typeof value==="object"?value as Partial<SheetTagStyle>:{};
  const validColor=(color:unknown):color is SheetTagColor=>SHEET_TAG_COLORS.includes(color as SheetTagColor);
  const rules=Array.isArray(style.rules)?style.rules.slice(0,10).flatMap(rule=>{
    if(!rule||typeof rule!=="object")return[];
    const item=rule as Partial<SheetTagRule>;
    return typeof item.contains==="string"&&item.contains.trim()&&validColor(item.color)?[{contains:item.contains.trim().slice(0,100),color:item.color}]:[];
  }):[];
  return {defaultColor:validColor(style.defaultColor)?style.defaultColor:"amber",rules};
}
export function primarySheetTagForPhone(connection:SheetConnection|undefined,phone:string):{text:string;color:SheetTagColor}|null{
  const config=connection?.config;
  const primaryTagFieldId=config?.primaryTagFieldId;
  const field=config?.fields.find(item=>item.id===primaryTagFieldId);
  const target=sheetInternationalPhone(phone),values=field&&target?connection?.data[field.id]?.values[target]:undefined;
  const cell=values?.find(item=>(typeof item==="string"?item:item.value).trim());
  const value=typeof cell==="string"?cell.trim():cell?.value.trim();
  if(!field||!value)return null;
  const style=normalizeSheetTagStyle(field.primaryTagStyle);
  const match=style.rules.find(rule=>value.toLowerCase().includes(rule.contains.toLowerCase()));
  return {text:`${field.label}: ${value}`,color:match?.color||style.defaultColor};
}
function updateConnection(id:string,patch:Partial<Omit<SheetConnection,"id"|"name">>){
  if(id===DEFAULT_SHEET_ID)useGoogleSheets.setState(patch);
  else useGoogleSheets.setState(state=>state.connections[id]?{connections:{...state.connections,[id]:{...state.connections[id],...patch}}}:{});
}
const KEY = "google-sheet-connection-v1";
let task: Promise<void> | null = null;
let configWrite: Promise<void> | null = null;
let initialized: Promise<void> | null = null;
const refreshes=new Map<string,{force:boolean;promise:Promise<void>}>();
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
export async function saveSheetConfigs(entries:{config:SheetConfig;connectionId:string;name?:string}[],refreshIds:ReadonlySet<string>=new Set()) {
  if(!entries.length)return;
  const ids=new Set<string>();
  for(const {config,connectionId,name} of entries){
    if(!/^[\w-]{1,120}$/.test(connectionId))throw Error("Invalid sheet connection ID");
    if(ids.has(connectionId))throw Error("Duplicate sheet connection ID");
    ids.add(connectionId);
    if(name!==undefined&&!name.trim())throw Error("Sheet name is required");
    if(config.fields.length>MAX_SHEET_DISPLAY_COLUMNS)throw new Error(`Invalid column selection: maximum ${MAX_SHEET_DISPLAY_COLUMNS} display columns`);
  }
  while(configWrite||task){if(configWrite)await configWrite;if(task)await task;}
  const previous = useGoogleSheets.getState();
  const previousConnections=sheetConnections(previous);
  const connections={...previous.connections};
  let config=previous.config,data=previous.data,defaultName=previous.defaultName,hasDefault=false,hasNamed=false;
  for(const entry of entries){
    const {config:nextConfig,connectionId,name}=entry;
    const oldConnection=previousConnections.find(item=>item.id===connectionId);
    const oldConfig=oldConnection?.config,oldData=oldConnection?.data||{};
    const sameSource=oldConfig?.spreadsheet===nextConfig.spreadsheet&&oldConfig?.tab===nextConfig.tab&&oldConfig?.headerRow===nextConfig.headerRow&&JSON.stringify(oldConfig?.phone)===JSON.stringify(nextConfig.phone);
    const nextData=Object.fromEntries(nextConfig.fields.flatMap(field=>{
      const old=oldConfig?.fields.find(item=>item.id===field.id);
      return sameSource&&old&&JSON.stringify(old.column)===JSON.stringify(field.column)&&old.action===field.action&&oldData[field.id]?[[field.id,oldData[field.id]]]:[];
    }));
    const connection:SheetConnection={id:connectionId,name:(name?.trim()||oldConnection?.name||nextConfig.tab).slice(0,120),config:nextConfig,data:nextData,error:"",...resetRetry};
    if(connectionId===DEFAULT_SHEET_ID){config=nextConfig;data=nextData;defaultName=connection.name;hasDefault=true;}
    else{connections[connectionId]=connection;hasNamed=true;}
  }
  const patch={
    ...(hasDefault?{config,data,defaultName,error:"",...resetRetry}:{}),
    ...(hasNamed?{connections}:{}),
  };
  const next={...previous,...patch};
  configWrite = (async () => {
    await idbSet(KEY,{email:next.email,config:next.config,data:next.data,connections:next.connections,defaultName:next.defaultName});
    useGoogleSheets.setState(patch);
  })();
  try { await configWrite; } finally { configWrite = null; }
  for(const {connectionId} of entries)if(refreshIds.has(connectionId))await refreshSheets(true,connectionId);
}
export async function saveSheetConfig(config:SheetConfig,connectionId=DEFAULT_SHEET_ID,name?:string,refresh=true){
  return saveSheetConfigs([{config,connectionId,name}],refresh?new Set([connectionId]):new Set());
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
interface GridCell { hyperlink?: string; userEnteredValue?: { formulaValue?: string }; textFormatRuns?: { format?: { link?: { uri?: string } } }[] }
interface GridColumn { startRow?: number; startColumn?: number; rowData?: { values?: GridCell[] }[] }
interface GridResponse { sheets?: { data?: GridColumn[] }[] }
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
async function readSheetBatches<T>(ranges: string[], read: (ranges: string[]) => Promise<T[]>): Promise<T[]> {
  try { return await read(ranges); }
  catch (error) {
    if (ranges.length < 2 || !/response exceeds 32 MiB|\(414\)/i.test(String(error))) throw error;
    const split = Math.ceil(ranges.length / 2);
    const first = await readSheetBatches(ranges.slice(0, split), read);
    return first.concat(await readSheetBatches(ranges.slice(split), read));
  }
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
  const queued=refreshes.get(connectionId);if(queued&&(!force||queued.force))return queued.promise;
  const previous=task,write=configWrite;
  const current=(async()=>{if(write)await write;if(previous)await previous;await refreshConnection(force,connectionId);})().finally(()=>{
    if(refreshes.get(connectionId)?.promise===current)refreshes.delete(connectionId);
    if(task===current)task=null;
  });
  refreshes.set(connectionId,{force,promise:current});task=current;return current;
}
export async function refreshAllSheets(activeConnectionIds?:ReadonlySet<string>){for(const connection of sheetConnections())if(!activeConnectionIds||activeConnectionIds.has(connection.id))await refreshSheets(false,connection.id);}
async function refreshConnection(force:boolean,connectionId:string):Promise<void>{
  const state=useGoogleSheets.getState(),connection=sheetConnections(state).find(item=>item.id===connectionId);
  if(!connection||!state.email)return;
  const {config,data,failures,retryAt,pauseReason}=connection;
  if (!force && (pauseReason || (retryAt && Date.now() < retryAt))) return;
  const fields = config.fields.filter(field => force || sheetRefreshDue(field.schedule, data[field.id]?.at || null, new Date()));
  if (!fields.length) return;
    updateConnection(connectionId,{error:""});
    try {
      const headers = config.headerRow ? await sheetHeaders(config.spreadsheet, config.tab, config.headerRow) : [];
      const indices = [config.phone, ...fields.map(field => field.column)].map(column => resolveSheetColumn(headers, column));
      if (indices.some(index => index === null)) throw new Error("Column headings changed or are duplicated. Please configure the mapping again.");
      const ranges = indices.map(index => `${tabRange(config.tab)}!${letter(index!)}:${letter(index!)}`);
      if (config.headerRow) ranges.push(`${tabRange(config.tab)}!${config.headerRow}:${config.headerRow}`);
      const valueRanges = await readSheetBatches(ranges, async batch => {
        const response = await readSheet(config.spreadsheet, batch);
        if (response.valueRanges?.length !== batch.length) throw new Error("Incomplete Google Sheets response");
        return response.valueRanges;
      });
      const currentHeaders = (valueRanges.at(-1)?.values || []).map(column => String(column[0] ?? ""));
      if (config.headerRow && JSON.stringify(currentHeaders) !== JSON.stringify(headers)) throw new Error("The sheet changed during refresh. Please try again.");
      const columns = valueRanges.map(range => range.values?.[0] || []);
      const actionColumns = new Set(fields.flatMap((field, index) => field.action ? [indices[index + 1]!] : []));
      const actionRanges = [...actionColumns].map(index => {
        const column = letter(index);
        return `${tabRange(config.tab)}!${column}${config.headerRow + 1}:${column}${columns[0].length}`;
      });
      const grid = actionRanges.length && columns[0].length > config.headerRow
        ? await readSheetBatches(actionRanges, async batch => (await readSheetGrid(config.spreadsheet, batch)).sheets?.flatMap(sheet => sheet.data || []) || [])
        : [];
      const gridColumns = new Map(grid.map(column => [column.startColumn ?? 0, column]));
      const next = { ...data };
      fields.forEach((field, fieldIndex) => {
        const values: Record<string, (SheetCell | string)[]> = {};
        const columnIndex = indices[fieldIndex + 1]!;
        const actionCells = field.action ? gridColumns.get(columnIndex) : undefined;
        columns[0].forEach((raw, row) => {
          if (row < config.headerRow) return;
          // WhatsApp stores international numbers without '+'. Sheet local numbers require explicit international formatting.
          const phone = sheetInternationalPhone(String(raw));
          if (phone) {
            const value = String(columns[fieldIndex + 1][row] ?? "");
            const gridCell = actionCells?.rowData?.[row - (actionCells.startRow ?? 0)]?.values?.[0];
            (values[phone] ||= []).push(field.action ? { value, row: row + 1, links: field.action === "link" || field.action === "content" ? cellLinks(gridCell, value) : [], formula: !!gridCell?.userEnteredValue?.formulaValue } : value);
          }
        });
        next[field.id] = { at: Date.now(), ...(field.action ? { columnIndex } : {}), values };
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
}
