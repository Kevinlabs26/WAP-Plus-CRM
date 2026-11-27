export type AutoReplyMode = "auto" | "manual";

export interface AutoReplyScopeSettings {
  aiReplyMode: string;
  aiAutoReplyPaused?: boolean;
  aiAutoReplyDisabled?: boolean;
  aiAutoReplyManualChatIds?: string[];
  aiAutoReplyModeByChatId?: Record<string, AutoReplyMode>;
  chatFolders?: { id: string; name: string; parentId?: string; chatIds: string[]; autoReplyMode?: AutoReplyMode; systemType?: string }[];
  chatFolderClones?: { folderId: string; sourceChatId: string }[];
  leadInbox?: { collectedChatIds?: string[]; dismissedChatIds?: string[] };
}

export function resolveAutoReplyScope(settings: AutoReplyScopeSettings, chatId: string, isGroup = false) {
  if (settings.aiAutoReplyPaused || settings.aiAutoReplyDisabled) return { mode: "manual" as const, source: "paused" as const };
  const override = settings.aiAutoReplyManualChatIds?.includes(chatId)
    ? "manual" : settings.aiAutoReplyModeByChatId?.[chatId];
  if (override === "auto" || override === "manual") return { mode: override, source: "chat" as const };
  // Group automation must be enabled per chat; inheriting global/folder auto would surprise existing users.
  if (isGroup) return { mode: "manual" as const, source: "group" as const };
  const cloneFolders = new Set(settings.chatFolderClones?.filter(item => item.sourceChatId === chatId).map(item => item.folderId));
  const all = settings.chatFolders || [];
  const byId = new Map(all.map(folder => [folder.id, folder]));
  const memberFolders = all.filter(folder => folder.chatIds.includes(chatId) || cloneFolders.has(folder.id));
  const leadRoot = all.find(folder => folder.systemType === "leadInbox");
  const inLeadTree = (folderId: string) => {
    let folder = byId.get(folderId);
    const seen = new Set<string>();
    while (folder && !seen.has(folder.id)) {
      if (folder.id === leadRoot?.id) return true;
      seen.add(folder.id);
      folder = folder.parentId ? byId.get(folder.parentId) : undefined;
    }
    return false;
  };
  const assignedOutsideLead = memberFolders.some(folder => folder.chatIds.includes(chatId) && !inLeadTree(folder.id));
  if (leadRoot && settings.leadInbox?.collectedChatIds?.includes(chatId) &&
      !settings.leadInbox.dismissedChatIds?.includes(chatId) && !assignedOutsideLead) {
    memberFolders.push(leadRoot);
  }
  const folders = memberFolders.flatMap(member => {
    const seen = new Set<string>();
    let folder: typeof member | undefined = member;
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      if (folder.autoReplyMode === "auto" || folder.autoReplyMode === "manual") return [folder];
      folder = folder.parentId ? byId.get(folder.parentId) : undefined;
    }
    return [];
  });
  const folder = folders.find(item => item.autoReplyMode === "manual") || folders[0];
  if (folder) return { mode: folder.autoReplyMode!, source: "folder" as const, folderName: folder.name };
  return { mode: settings.aiReplyMode === "auto" ? "auto" as const : "manual" as const, source: "default" as const };
}
