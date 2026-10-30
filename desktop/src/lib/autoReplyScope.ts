export type AutoReplyMode = "auto" | "manual";

export interface AutoReplyScopeSettings {
  aiReplyMode: string;
  aiAutoReplyPaused?: boolean;
  aiAutoReplyManualChatIds?: string[];
  aiAutoReplyModeByChatId?: Record<string, AutoReplyMode>;
  chatFolders?: { id: string; name: string; chatIds: string[]; autoReplyMode?: AutoReplyMode }[];
  chatFolderClones?: { folderId: string; sourceChatId: string }[];
}

export function resolveAutoReplyScope(settings: AutoReplyScopeSettings, chatId: string) {
  if (settings.aiAutoReplyPaused) return { mode: "manual" as const, source: "paused" as const };
  const override = settings.aiAutoReplyManualChatIds?.includes(chatId)
    ? "manual" : settings.aiAutoReplyModeByChatId?.[chatId];
  if (override === "auto" || override === "manual") return { mode: override, source: "chat" as const };
  const cloneFolders = new Set(settings.chatFolderClones?.filter(item => item.sourceChatId === chatId).map(item => item.folderId));
  const folders = (settings.chatFolders || []).filter(folder =>
    (folder.chatIds.includes(chatId) || cloneFolders.has(folder.id)) &&
    (folder.autoReplyMode === "auto" || folder.autoReplyMode === "manual"));
  const folder = folders.find(item => item.autoReplyMode === "manual") || folders[0];
  if (folder) return { mode: folder.autoReplyMode!, source: "folder" as const, folderName: folder.name };
  return { mode: settings.aiReplyMode === "auto" ? "auto" as const : "manual" as const, source: "default" as const };
}
