export type AutoReplyMode = "auto" | "manual";

export interface AutoReplyScopeSettings {
  aiReplyMode: string;
  aiAutoReplyPaused?: boolean;
  aiAutoReplyManualChatIds?: string[];
  aiAutoReplyModeByChatId?: Record<string, AutoReplyMode>;
  chatFolders?: { id: string; name: string; parentId?: string; chatIds: string[]; autoReplyMode?: AutoReplyMode }[];
  chatFolderClones?: { folderId: string; sourceChatId: string }[];
}

export function resolveAutoReplyScope(settings: AutoReplyScopeSettings, chatId: string) {
  if (settings.aiAutoReplyPaused) return { mode: "manual" as const, source: "paused" as const };
  const override = settings.aiAutoReplyManualChatIds?.includes(chatId)
    ? "manual" : settings.aiAutoReplyModeByChatId?.[chatId];
  if (override === "auto" || override === "manual") return { mode: override, source: "chat" as const };
  const cloneFolders = new Set(settings.chatFolderClones?.filter(item => item.sourceChatId === chatId).map(item => item.folderId));
  const all = settings.chatFolders || [];
  const byId = new Map(all.map(folder => [folder.id, folder]));
  const folders = all.filter(folder => folder.chatIds.includes(chatId) || cloneFolders.has(folder.id)).flatMap(member => {
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
