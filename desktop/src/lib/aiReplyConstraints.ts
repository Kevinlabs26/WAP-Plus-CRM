import type { SettingsShape } from "../store/settingsDefaults";

type ConstraintSettings=Pick<SettingsShape,"chatFolders"|"liveBaileysAccountId"|"activeAccountId">;
export function resolveAiReplyConstraints(settings:ConstraintSettings,accountId?:string,chatId?:string,folderId?:string){
  const folders=settings.chatFolders||[],scope=(folder:typeof folders[number])=>folder.scope?.type==="all"?"all":folder.scope?.accountId||settings.liveBaileysAccountId||settings.activeAccountId||"wa-default";
  let folder=(folderId?folders.find(item=>item.id===folderId):undefined)||folders.find(item=>item.chatIds.includes(chatId||"")&&scope(item)===accountId)||folders.find(item=>item.chatIds.includes(chatId||"")&&scope(item)==="all");
  const owner=folder&&scope(folder),seen=new Set<string>(),terms=new Set<string>();let maxChars:number|undefined;
  while(folder&&!seen.has(folder.id)&&scope(folder)===owner){
    seen.add(folder.id);
    if(maxChars===undefined&&Number.isFinite(folder.aiReplyMaxChars))maxChars=folder.aiReplyMaxChars;
    for(const term of folder.aiReplyForbiddenTerms||[])if(term.trim())terms.add(term.trim());
    folder=folder.parentId?folders.find(item=>item.id===folder!.parentId):undefined;
  }
  return {maxChars,forbiddenTerms:[...terms]};
}
export function getAiOutputConstraintError(settings:ConstraintSettings,accountId:string|undefined,chatId:string|undefined,text:string){
  const constraints=resolveAiReplyConstraints(settings,accountId,chatId);
  if(constraints.maxChars&&[...text].length>constraints.maxChars)return `回复超过本文件夹设定的 ${constraints.maxChars} 字符上限`;
  const normalized=text.normalize("NFKC").toLocaleLowerCase();
  const forbidden=constraints.forbiddenTerms.find(term=>normalized.includes(term.normalize("NFKC").toLocaleLowerCase()));
  return forbidden?`回复包含禁用词句：${forbidden}`:undefined;
}
