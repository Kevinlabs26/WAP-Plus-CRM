import type { SettingsShape, SettingsChatFolder } from "../store/settingsDefaults";
import { playbookBindingKey, resolvePlaybook, type MusePlaybookMaterial, type PlaybookSettings } from "./aiPlaybooks.ts";
import { evaluatePromptPlan, usesPromptPlans, type PromptPlan, type SavedPromptPlan } from "./promptPlans.ts";

export type AiPromptFolder = { id: string; name: string; parentId?: string };
export type AiPromptTemplate = { id: string; name: string; prompt: string; folderId?: string };
export const MAX_EFFECTIVE_PROMPT_CHARS = 24_000;
export function normalizePromptFolders(value: unknown): AiPromptFolder[] {
  const seen = new Set<string>();
  const folders = (Array.isArray(value) ? value : []).slice(0, 100).flatMap(item => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 120 || seen.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim()) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name.trim().slice(0, 80), ...(typeof item.parentId === "string" ? { parentId: item.parentId } : {}) }];
  });
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  for (const folder of folders) {
    if (!folder.parentId || !byId.has(folder.parentId) || folder.parentId === folder.id) {
      delete folder.parentId;
    }
  }
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const path = new Set([folder.id]);
    let current = folder;
    for (let depth = 0; current.parentId && depth < 16; depth++) {
      if (path.has(current.parentId)) {
        delete current.parentId;
        break;
      }
      path.add(current.parentId);
      current = byId.get(current.parentId)!;
    }
    if (current.parentId && path.size >= 17) delete current.parentId;
  }
  return folders;
}

export function normalizePromptTemplates(value: unknown, folderIds?: ReadonlySet<string>): AiPromptTemplate[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).slice(0,100).flatMap(item => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 120 || seen.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || typeof item.prompt !== "string" || !item.prompt.trim()) return [];
    seen.add(item.id);
    const folderId = typeof item.folderId === "string" && (!folderIds || folderIds.has(item.folderId)) ? item.folderId : undefined;
    return [{id: item.id, name: item.name.trim().slice(0,80), prompt: item.prompt.trim().slice(0,6000), ...(folderId ? { folderId } : {})}];
  });
}
type PromptSettings = Pick<SettingsShape, "aiSystemPrompt" | "aiSystemPromptByAccountId" | "chatFolders" | "liveBaileysAccountId" | "activeAccountId" | "leadInbox"> & Omit<PlaybookSettings, 'chatFolders'> & {aiPromptTemplates?: AiPromptTemplate[]; aiPromptPlans?: SavedPromptPlan[]; aiPromptPlanByChat?: Record<string, PromptPlan>};
export type AiReplyProfile = { prompt: string; source: "folder" | "account" | "global" | "default"; folderId?: string; folderName?: string; primaryFolderIds?: string[]; error?: string; templateIds?: string[]; readMuseFiles?: boolean; musePlaybookPaths?: string[]; museMaterials?: MusePlaybookMaterial[]; playbookName?: string; playbookVersion?: string; workspacePlaybook?: boolean };

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
function primaryFolders(settings: PromptSettings, chatId?: string) {
  const primary = (settings.chatFolders || []).filter(folder => chatId && folder.chatIds.includes(chatId));
  const root = (settings.chatFolders || []).find(folder => folder.systemType === "leadInbox");
  if (chatId && !primary.length && root && settings.leadInbox?.collectedChatIds.includes(chatId) &&
      !settings.leadInbox.dismissedChatIds.includes(chatId)) primary.push(root);
  return primary;
}

function resolveBaseReplyProfile(settings: PromptSettings, accountId?: string, chatId?: string): AiReplyProfile {
  const id = accountId?.trim();
  const primary = primaryFolders(settings, chatId);
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

export function resolveChatPromptPlan(settings: PromptSettings, accountId?: string, chatId?: string, inheritOnly = false): { plan?: PromptPlan; folderName?: string } {
  const resolvePlan = (plan?: PromptPlan): PromptPlan | undefined => {
    if (plan?.mode !== "saved") return plan;
    const definition = settings.aiPromptPlans?.find(item => item.id === plan.planId)?.plan;
    if (!definition) return { mode: "missing" };
    if (definition.mode === "fixed") return definition;
    return { ...definition, startDate: plan.startDate, switchTime: plan.switchTime, timeZone: plan.timeZone };
  };
  const id = accountId?.trim();
  const binding = id && chatId ? settings.aiPromptPlanByChat?.[playbookBindingKey(id, chatId)] : undefined;
  if (!inheritOnly && binding) return { plan: resolvePlan(binding) };
  if (!chatId) return {};
  const primary = primaryFolders(settings, chatId);
  const byId = new Map((settings.chatFolders || []).map(folder => [folder.id, folder]));
  for (const scope of id ? [`account:${id}`, "all"] : ["all"]) {
    let folder = primary.find(item => scopeKey(settings, item) === scope);
    const visited = new Set<string>();
    while (folder && scopeKey(settings, folder) === scope && !visited.has(folder.id)) {
      if (folder.aiPromptPlan) return { plan: resolvePlan(folder.aiPromptPlan), folderName: folder.name };
      visited.add(folder.id);
      folder = folder.parentId ? byId.get(folder.parentId) : undefined;
    }
  }
  return {};
}

export function resolveAiReplyProfile(
  settings: PromptSettings,
  accountId?: string,
  chatId?: string,
  museAccountId?: string,
  contactInstructions?: string,
  useSourceFile = false,
  now = Date.now()
): AiReplyProfile {
  const profile = resolveBaseReplyProfile(settings, accountId, chatId);
  if (profile.error) return profile;
  const generic = usesPromptPlans(settings.aiProvider);
  const playbook = generic ? null : resolvePlaybook(settings, accountId, chatId, museAccountId, useSourceFile);
  if (playbook?.error) return {...profile, prompt: '', error: playbook.error};
  const plan = generic ? evaluatePromptPlan(resolveChatPromptPlan(settings, accountId, chatId).plan, settings.aiPromptTemplates || [], now, settings.aiPromptPlans || []) : {};
  if (plan.error) {
    const errors = {
      conflict: "合并会话的提示词计划存在冲突，请重新选择",
      missing: "提示词计划引用的模板或方案已不存在，请重新选择",
      schedule: "提示词计划的开始日期、切换时间或时区无效",
    };
    return { ...profile, prompt: "", error: errors[plan.error] };
  }
  const instructions = contactInstructions?.trim();
  if (instructions && instructions.length > 4000) return {...profile, prompt: '', error: '联系人 AI 补充说明超过 4000 字符，请精简后重试'};
  const prompt = [
    profile.prompt,
    playbook?.prompt,
    plan.current?.prompt,
    instructions && `<contact_specific_instructions>\n${instructions}\n</contact_specific_instructions>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const book = playbook && settings.aiPlaybooks?.find(item => item.id === playbook.id);
  const resolved = {...profile, prompt, readMuseFiles: playbook?.readMuseFiles, musePlaybookPaths:playbook?.musePaths, museMaterials:playbook?.museMaterials, playbookName: book?.name, playbookVersion: book?.museRevision, workspacePlaybook:!!book?.musePath};
  return prompt.length > MAX_EFFECTIVE_PROMPT_CHARS
    ? {...resolved, prompt: '', error: '合并提示词和联系人补充说明后超过 24000 字符，请精简后重试'} : resolved;
}
