import type { SettingsShape, SettingsChatFolder } from "../store/settingsDefaults";
import { resolvePlaybook, type PlaybookSettings } from "./aiPlaybooks.ts";

export type AiPromptTemplate = { id: string; name: string; prompt: string };
export const MAX_EFFECTIVE_PROMPT_CHARS = 24_000;
export function normalizePromptTemplates(value: unknown): AiPromptTemplate[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).slice(0,100).flatMap(item => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 120 || seen.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || typeof item.prompt !== "string" || !item.prompt.trim()) return [];
    seen.add(item.id);
    return [{id: item.id, name: item.name.trim().slice(0,80), prompt: item.prompt.trim().slice(0,6000)}];
  });
}
type PromptSettings = Pick<SettingsShape, "aiSystemPrompt" | "aiSystemPromptByAccountId" | "chatFolders" | "liveBaileysAccountId" | "activeAccountId"> & Omit<PlaybookSettings, 'chatFolders'> & {aiPromptTemplates?: AiPromptTemplate[]};
export type AiReplyProfile = { prompt: string; source: "folder" | "account" | "global" | "default"; folderId?: string; folderName?: string; primaryFolderIds?: string[]; error?: string; templateIds?: string[] };

function scopeKey(settings: PromptSettings, folder: SettingsChatFolder): string {
  return folder.scope?.type === "all" ? "all"
    : `account:${folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default"}`;
}

function defaultProfile(settings: PromptSettings, accountId?: string): AiReplyProfile {
  const account = accountId && settings.aiSystemPromptByAccountId?.[accountId]?.trim();
  const prompt = account || settings.aiSystemPrompt?.trim() || "";
  const source = account ? "account" : prompt ? "global" : "default";
  return prompt.length > MAX_EFFECTIVE_PROMPT_CHARS ? {prompt:"",source,error:"提示词超过 24000 字符，请精简后重试"} : {prompt, source};
}

/** Only ancestors in the same account scope can supply a folder's identity. */
export function resolveFolderAiProfile(settings: PromptSettings, folderId: string, accountId?: string): AiReplyProfile {
  const folders = settings.chatFolders || [];
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  let folder = byId.get(folderId);
  const scope = folder ? scopeKey(settings, folder) : "";
  const seen = new Set<string>();
  const additions: string[] = [];
  const templateIds=new Set<string>();
  let source: SettingsChatFolder | undefined;
  let base: AiReplyProfile | undefined;
  while (folder && !seen.has(folder.id) && scopeKey(settings, folder) === scope) {
    seen.add(folder.id);
    if (folder.aiPromptMode !== "inherit") {
      const template = folder.aiPromptTemplateId ? settings.aiPromptTemplates?.find(item => item.id === folder!.aiPromptTemplateId) : undefined;
      if (folder.aiPromptTemplateId && !template) return {prompt: "", source: "folder", folderId: folder.id, error: "提示词模板已不存在，请重新选择"};
      const prompt = [template?.prompt.trim(), folder.aiSystemPrompt?.trim()].filter(Boolean).join("\n\n");
      if (prompt) {
        if(template)templateIds.add(template.id);
        source ||= folder;
        if (folder.aiPromptMode === "append") additions.unshift(prompt);
        else { base = {prompt, source: "folder", folderId: folder.id, folderName: folder.name}; break; }
      }
    }
    folder = folder.parentId ? byId.get(folder.parentId) : undefined;
  }
  base ||= defaultProfile(settings, accountId);
  if (base.error) return base;
  const prompt = [base.prompt, ...additions].filter(Boolean).join("\n\n");
  const profile: AiReplyProfile = source ? {prompt, source: "folder", folderId: source.id, folderName: source.name,templateIds:[...templateIds]} : {...base, prompt};
  return prompt.length > MAX_EFFECTIVE_PROMPT_CHARS ? {...profile, prompt: "", error: "合并后的提示词超过 24000 字符，请精简；已停止生成，避免截断要求"} : profile;
}

/** Membership is primary-only and independent of the sidebar's current view or clones. */
function resolveBaseReplyProfile(settings: PromptSettings, accountId?: string, chatId?: string): AiReplyProfile {
  const id = accountId?.trim();
  const primary = (settings.chatFolders || []).filter(folder => chatId && folder.chatIds.includes(chatId));
  const scopes = id ? [`account:${id}`, "all"] : ["all"];
  const primaryFolderIds = primary.filter(folder => scopes.includes(scopeKey(settings, folder))).map(folder => folder.id).sort();
  for (const scope of scopes) {
    const folder = primary.find(item => scopeKey(settings, item) === scope);
    if (!folder) continue;
    const profile = resolveFolderAiProfile(settings, folder.id, id);
    if (profile.source === "folder"||profile.error) return { ...profile, primaryFolderIds };
  }
  return { ...defaultProfile(settings, id), primaryFolderIds };
}

export function resolveAiReplyProfile(settings: PromptSettings, accountId?: string, chatId?: string): AiReplyProfile {
  const profile = resolveBaseReplyProfile(settings, accountId, chatId);
  if (profile.error) return profile;
  const playbook = resolvePlaybook(settings, accountId, chatId);
  if (playbook.error) return {...profile, prompt: '', error: playbook.error};
  const prompt = [profile.prompt, playbook.prompt].filter(Boolean).join('\n\n');
  return prompt.length > MAX_EFFECTIVE_PROMPT_CHARS
    ? {...profile, prompt: '', error: '合并 Playbook 后超过 24000 字符，请精简后重试'} : {...profile, prompt};
}
