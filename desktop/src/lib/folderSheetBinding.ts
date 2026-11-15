type Folder={id:string;parentId?:string;chatIds:string[];sheetConnectionId?:string;systemType?:string};
export function resolveFolderSheetIds(settings:{chatFolders:Folder[];chatFolderClones?:{folderId:string;sourceChatId:string}[];leadInbox?:{collectedChatIds?:string[];dismissedChatIds?:string[]}},chatId:string):string[]{
  const folders=new Map(settings.chatFolders.map(folder=>[folder.id,folder]));
  const cloned=new Set(settings.chatFolderClones?.filter(clone=>clone.sourceChatId===chatId).map(clone=>clone.folderId));
  const members=settings.chatFolders.filter(folder=>folder.chatIds.includes(chatId)||cloned.has(folder.id));
  const leadRoot=settings.chatFolders.find(folder=>folder.systemType==="leadInbox");
  if(leadRoot&&settings.leadInbox?.collectedChatIds?.includes(chatId)&&!settings.leadInbox.dismissedChatIds?.includes(chatId)&&!members.some(folder=>folder.chatIds.includes(chatId)))members.push(leadRoot);
  const ids=new Set<string>();
  for(const member of members){
    let folder:Folder|undefined=member;const seen=new Set<string>();
    while(folder&&!seen.has(folder.id)){
      seen.add(folder.id);
      if(folder.sheetConnectionId){ids.add(folder.sheetConnectionId);break;}
      folder=folder.parentId?folders.get(folder.parentId):undefined;
    }
  }
  return ids.size?[...ids]:["default"];
}
