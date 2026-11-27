type Folder={id:string;name?:string;parentId?:string;chatIds:string[];sheetConnectionId?:string;systemType?:string};
type FolderSettings={chatFolders:Folder[];chatFolderClones?:{folderId:string;sourceChatId:string}[];leadInbox?:{collectedChatIds?:string[];dismissedChatIds?:string[]}};
function folderBindingSource(folders:Map<string,Folder>,start:Folder){
  let folder:Folder|undefined=start;const seen=new Set<string>();
  while(folder&&!seen.has(folder.id)){
    seen.add(folder.id);
    if(folder.sheetConnectionId)return folder;
    folder=folder.parentId?folders.get(folder.parentId):undefined;
  }
}
export function foldersBoundToSheet(settings:FolderSettings,connectionId:string){
  const folders=new Map(settings.chatFolders.map(folder=>[folder.id,folder]));
  return settings.chatFolders.flatMap(folder=>{
    const source=folderBindingSource(folders,folder);
    return source?.sheetConnectionId===connectionId?[{folderId:folder.id,folderName:folder.name||folder.id,sourceName:source.name||source.id,inherited:source.id!==folder.id}]:[];
  });
}
export function activeFolderSheetIds(settings:Parameters<typeof resolveFolderSheetIds>[0],chatIds:Iterable<string>):Set<string>{
  const ids=new Set<string>();
  for(const chatId of chatIds)for(const id of resolveFolderSheetIds(settings,chatId))if(id!=="none")ids.add(id);
  return ids;
}
export function resolveFolderSheetIds(settings:FolderSettings,chatId:string):string[]{
  const folders=new Map(settings.chatFolders.map(folder=>[folder.id,folder]));
  const cloned=new Set(settings.chatFolderClones?.filter(clone=>clone.sourceChatId===chatId).map(clone=>clone.folderId));
  const members=settings.chatFolders.filter(folder=>folder.chatIds.includes(chatId)||cloned.has(folder.id));
  const leadRoot=settings.chatFolders.find(folder=>folder.systemType==="leadInbox");
  if(leadRoot&&settings.leadInbox?.collectedChatIds?.includes(chatId)&&!settings.leadInbox.dismissedChatIds?.includes(chatId)&&!members.some(folder=>folder.chatIds.includes(chatId)))members.push(leadRoot);
  const ids=new Set<string>();
  for(const member of members){
    const source=folderBindingSource(folders,member);
    if(source)ids.add(source.sheetConnectionId!);
  }
  return [...ids];
}
