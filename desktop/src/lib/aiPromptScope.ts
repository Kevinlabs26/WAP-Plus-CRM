import type { SettingsShape, SettingsChatFolder } from "../store/settingsDefaults";

type PromptSettings = Pick<SettingsShape, "aiSystemPrompt" | "aiSystemPromptByAccountId" | "chatFolders" | "liveBaileysAccountId" | "activeAccountId">;
export type AiReplyProfile = { prompt: string; source: "folder" | "account" | "global" | "default"; folderId?: string; folderName?: string; primaryFolderIds?: string[] };

function scopeKey(settings: PromptSettings, folder: SettingsChatFolder): string {
  return folder.scope?.type === "all" ? "all"
    : `account:${folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default"}`;
}

function defaultProfile(settings: PromptSettings, accountId?: string): AiReplyProfile {
  const account = accountId && settings.aiSystemPromptByAccountId?.[accountId]?.trim();
  if (account) return { prompt: account, source: "account" };
  const prompt = settings.aiSystemPrompt?.trim() || "";
  return { prompt, source: prompt ? "global" : "default" };
}

/** Only ancestors in the same account scope can supply a folder's identity. */
export function resolveFolderAiProfile(settings: PromptSettings, folderId: string, accountId?: string): AiReplyProfile {
  const folders = settings.chatFolders || [];
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  let folder = byId.get(folderId);
  const scope = folder ? scopeKey(settings, folder) : "";
  const seen = new Set<string>();
  while (folder && !seen.has(folder.id) && scopeKey(settings, folder) === scope) {
    seen.add(folder.id);
    const prompt = folder.aiSystemPrompt?.trim();
    if (prompt) return { prompt, source: "folder", folderId: folder.id, folderName: folder.name };
    folder = folder.parentId ? byId.get(folder.parentId) : undefined;
  }
  return defaultProfile(settings, accountId);
}

/** Membership is primary-only and independent of the sidebar's current view or clones. */
export function resolveAiReplyProfile(settings: PromptSettings, accountId?: string, chatId?: string): AiReplyProfile {
  const id = accountId?.trim();
  const primary = (settings.chatFolders || []).filter(folder => chatId && folder.chatIds.includes(chatId));
  const scopes = id ? [`account:${id}`, "all"] : ["all"];
  const primaryFolderIds = primary.filter(folder => scopes.includes(scopeKey(settings, folder))).map(folder => folder.id).sort();
  for (const scope of scopes) {
    const folder = primary.find(item => scopeKey(settings, item) === scope);
    if (!folder) continue;
    const profile = resolveFolderAiProfile(settings, folder.id, id);
    if (profile.source === "folder") return { ...profile, primaryFolderIds };
  }
  return { ...defaultProfile(settings, id), primaryFolderIds };
}
