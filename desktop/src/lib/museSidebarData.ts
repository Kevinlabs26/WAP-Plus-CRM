import { sheetInternationalPhone, sheetRefreshDue } from './googleSheetMatch.ts';
import { resolveFolderSheetIds } from './folderSheetBinding.ts';
import type { SheetConnection } from './googleSheets.ts';

export const MUSE_SIDEBAR_PERMISSION = '允许读取当前客户侧栏的表格资料';
function hasSidebarPermission(prompt:string){return prompt.split(/\r?\n/).some(line=>line.trim().replace(/[。.]$/,'')===MUSE_SIDEBAR_PERMISSION);}
function freshForAutomaticContact(schedule: SheetConnection["config"]["fields"][number]["schedule"], at?: number) {
  const now = new Date();
  return !!at && at <= now.getTime() && schedule.kind !== "manual" && !sheetRefreshDue(schedule, at, now);
}
function sidebarConnection(prompt:string,settings:Parameters<typeof resolveFolderSheetIds>[0],chatId:string,phone:string,connections:SheetConnection[],allow?:boolean){
  // Proactive tasks require their own folder opt-in; ordinary suggestions use the explicit prompt instruction.
  if(allow===false||allow===undefined&&!hasSidebarPermission(prompt))return null;
  const ids=resolveFolderSheetIds(settings,chatId),number=sheetInternationalPhone(phone);
  if(ids.length!==1||!number)return {connection:null,number:null};
  const connection=connections.find(item=>item.id===ids[0]);
  if(!connection||connection.error)return {connection:null,number:null};
  return {connection,number};
}
export function museSidebarDataVersion(prompt:string,settings:Parameters<typeof resolveFolderSheetIds>[0],chatId:string,phone:string,connections:SheetConnection[],allow?:boolean):string {
  const resolved=sidebarConnection(prompt,settings,chatId,phone,connections,allow);
  if(!resolved)return '';
  const {connection,number}=resolved;
  if(!connection||!number)return '[]';
  return JSON.stringify([connection.id,connection.config.spreadsheet,connection.config.tab,connection.config.headerRow,connection.config.phone,number,connection.config.fields.map(field=>[field.id,field.label,field.column,field.schedule,connection.data[field.id]?.at||0, allow===true ? freshForAutomaticContact(field.schedule,connection.data[field.id]?.at) : undefined])]);
}
export function museSidebarData(prompt:string,settings:Parameters<typeof resolveFolderSheetIds>[0],chatId:string,phone:string,connections:SheetConnection[],allow?:boolean):string {
  const resolved=sidebarConnection(prompt,settings,chatId,phone,connections,allow);
  if(!resolved)return '';
  const {connection,number}=resolved;
  if(!connection||!number)return '[]';
  const fields=connection.config.fields.map(field=>({field:field.label,updatedAt:connection.data[field.id]?.at?new Date(connection.data[field.id]!.at).toISOString():null, ...(allow===true?{freshForAutomaticContact:freshForAutomaticContact(field.schedule,connection.data[field.id]?.at)}:{}), values:(connection.data[field.id]?.values[number]||[]).map(cell=>typeof cell==='string'?cell:cell.value)}));
  // Links and linked documents are excluded: this path must never fetch remote content.
  return JSON.stringify(fields.map(field=>({...field,values:field.values.slice(0,5).map(value=>value.replace(/https?:\/\/\S+/gi,'[link omitted]').slice(0,2000))})));
}
