import { sheetInternationalPhone } from './googleSheetMatch.ts';
import { resolveFolderSheetIds } from './folderSheetBinding.ts';
import type { SheetConnection } from './googleSheets.ts';

export const MUSE_SIDEBAR_PERMISSION = '允许读取当前客户侧栏的表格资料';
export function museSidebarData(prompt:string,settings:Parameters<typeof resolveFolderSheetIds>[0],chatId:string,phone:string,connections:SheetConnection[]):string {
  // Only a standalone owner instruction grants access; quoted chat text is never inspected.
  if(!prompt.split(/\r?\n/).some(line=>line.trim().replace(/[。.]$/,'')===MUSE_SIDEBAR_PERMISSION))return '';
  const ids=resolveFolderSheetIds(settings,chatId),number=sheetInternationalPhone(phone);
  if(ids.length!==1||!number)return '[]';
  const connection=connections.find(item=>item.id===ids[0]);
  if(!connection||connection.error)return '[]';
  const fields=connection.config.fields.map(field=>({field:field.label,values:(connection.data[field.id]?.values[number]||[]).map(cell=>typeof cell==='string'?cell:cell.value)}));
  // Links and linked documents are excluded: this path must never fetch remote content.
  return JSON.stringify(fields.map(field=>({...field,values:field.values.slice(0,5).map(value=>value.replace(/https?:\/\/\S+/gi,'[link omitted]').slice(0,2000))})));
}
