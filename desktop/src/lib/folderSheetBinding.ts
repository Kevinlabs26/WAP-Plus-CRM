type Folder={id:string;parentId?:string;chatIds:string[];sheetConnectionId?:string};
export function resolveFolderSheetIds(settings:{chatFolders:Folder[];chatFolderClones?:{folderId:string;sourceChatId:string}[]},chatId:string):string[]{
  const folders=new Map(settings.chatFolders.map(folder=>[folder.id,folder]));
  const cloned=new Set(settings.chatFolderClones?.filter(clone=>clone.sourceChatId===chatId).map(clone=>clone.folderId));
  const ids=new Set<string>();
  for(const member of settings.chatFolders.filter(folder=>folder.chatIds.includes(chatId)||cloned.has(folder.id))){
    let folder:Folder|undefined=member;const seen=new Set<string>();
    while(folder&&!seen.has(folder.id)){
      seen.add(folder.id);
      if(folder.sheetConnectionId){ids.add(folder.sheetConnectionId);break;}
      folder=folder.parentId?folders.get(folder.parentId):undefined;
    }
  }
  return ids.size?[...ids]:["default"];
}
