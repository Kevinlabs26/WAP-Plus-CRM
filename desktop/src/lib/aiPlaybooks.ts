import { scheduledPlaybook, type PlaybookPlan, type PlaybookSchedule } from './playbookPlans.ts';
export type AiPlaybook = { id: string; name: string; sourceName: string; content: string; summary: string; musePath?: string; museRevision?: string; museMissing?: boolean; museShareRevision?: string; museAccountCopies?: Record<string, {path:string;revision:string;parts?:number}> };
export type MusePlaybookMaterial = {id:string;name:string;content:string;revision:string};
export const MUSE_ACCOUNT_PLAYBOOK_FOLDER = 'WAP Plus CRM - Playbook';
export function hasMuseAccountPlaybook(book: AiPlaybook, accountId: string): boolean {
  const copy = book.museAccountCopies?.[accountId];
  return Boolean(copy && book.museShareRevision && copy.revision === book.museShareRevision && copy.path.endsWith(`/${MUSE_ACCOUNT_PLAYBOOK_FOLDER}/${book.id}${(copy.parts || 1) > 1 ? ".part1" : ""}.md`));
}
export type PlaybookSettings = {
  aiProvider?: string;
  aiPlaybooks?: AiPlaybook[];
  aiPlaybookPlans?: PlaybookPlan[];
  aiPlaybookBindings?: Record<string, string>;
  chatFolders?: { id: string; parentId?: string; chatIds: string[]; scope?: { type: string; accountId?: string }; aiPlaybookId?: string; aiPlaybookSchedule?: PlaybookSchedule; systemType?: string }[];
  leadInbox?: { collectedChatIds?: string[]; dismissedChatIds?: string[] };
  liveBaileysAccountId?: string;
  activeAccountId?: string;
};
export const MAX_PLAYBOOK_CHARS = 200_000;
export const MAX_PLAYBOOK_TOTAL_CHARS = 1_000_000;
export const MAX_PLAYBOOK_SUMMARY_CHARS = 6000;
export const MAX_PLAYBOOKS = 1000;
const CONFLICT = 'playbook-binding-conflict';

export function normalizePlaybooks(value: unknown): AiPlaybook[] {
  const seen = new Set<string>(); let total = 0;
  return (Array.isArray(value) ? value : []).slice(0, MAX_PLAYBOOKS).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id === 'off' || item.id === CONFLICT || item.id.length > 120 || seen.has(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
        typeof item.content !== 'string' || item.content.length > MAX_PLAYBOOK_CHARS ||
        typeof item.summary !== 'string' || item.summary.length > MAX_PLAYBOOK_SUMMARY_CHARS ||
        total + item.content.length + item.summary.length > MAX_PLAYBOOK_TOTAL_CHARS) return [];
    const remote = typeof item.musePath === 'string' && item.musePath.length <= 500 && /^\/(?!\/)/.test(item.musePath) && !item.musePath.includes('\\') && !/[\u0000-\u001f]/.test(item.musePath) && !item.musePath.split('/').some((part: string) => part === '.' || part === '..') && !item.musePath.endsWith('/') && (item.museRevision === undefined || /^[a-f0-9]{64}$/.test(item.museRevision));
    if ((item.musePath !== undefined || item.museRevision !== undefined || item.museMissing !== undefined) && !remote) return [];
    const museShareRevision = typeof item.museShareRevision === 'string' && item.museShareRevision.length > 0 && item.museShareRevision.length <= 120 ? item.museShareRevision : undefined;
    const museAccountCopies = Object.fromEntries(Object.entries(item.museAccountCopies && typeof item.museAccountCopies === 'object' && !Array.isArray(item.museAccountCopies) ? item.museAccountCopies : {}).slice(0,12).flatMap(([accountId, value]): [string,{path:string;revision:string;parts?:number}][] => {
      const copy = value as {path?:unknown;revision?:unknown;parts?:unknown} | null;
      return accountId.length > 0 && accountId.length <= 120 && copy && typeof copy.path === 'string' && copy.path.length <= 500 && /^\/(?!\/)/.test(copy.path) && !copy.path.includes('\\') && !/[\u0000-\u001f]/.test(copy.path) && !copy.path.split('/').some(part => part === '.' || part === '..') && !copy.path.endsWith('/') && typeof copy.revision === 'string' && copy.revision.length > 0 && copy.revision.length <= 120 ? [[accountId,{path:copy.path,revision:copy.revision, ...(typeof copy.parts === "number" && Number.isInteger(copy.parts) && copy.parts > 1 && copy.parts <= 167 ? {parts:copy.parts} : {})}]] : [];
    }));
    seen.add(item.id); total += item.content.length + item.summary.length;
    return [{ id: item.id, name: item.name.trim(), sourceName: typeof item.sourceName === 'string' ? item.sourceName.slice(0, 255) : '', content: item.content, summary: item.summary,
      ...(remote ? {musePath: item.musePath, museRevision: item.museRevision, museMissing: item.museMissing === true} : {}),
      ...(museShareRevision ? {museShareRevision} : {}), ...(Object.keys(museAccountCopies).length ? {museAccountCopies} : {}) }];
  });
}

export const playbookBindingKey = (accountId: string, chatId: string) => JSON.stringify([accountId, chatId]);
export function normalizePlaybookBindings(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).slice(0, 50_000).filter(([key, id]) => {
    if (typeof id !== 'string' || !id || id.length > 120) return false;
    try { const parts = JSON.parse(key); return Array.isArray(parts) && parts.length === 2 && parts.every(part => typeof part === 'string' && part.trim() && part.length <= 240) && JSON.stringify(parts) === key; }
    catch { return false; }
  })) as Record<string, string>;
}

export function remapPlaybookBindings(bindings: Record<string, string>, replacements: ReadonlyMap<string, string | null>): Record<string, string> {
  const entries = Object.entries(normalizePlaybookBindings(bindings));
  if (!entries.some(([key]) => replacements.has(JSON.parse(key)[1]))) return bindings;
  const next: Record<string, string> = {};
  for (const [key, id] of entries) {
    const [account, chat] = JSON.parse(key);
    const target = replacements.has(chat) ? replacements.get(chat) : chat;
    if (!target) continue;
    const nextKey = playbookBindingKey(account, target);
    next[nextKey] = next[nextKey] && next[nextKey] !== id ? CONFLICT : id;
  }
  return next;
}

/** Reimport by filename keeps bindings; changed long sources require a new reviewed summary. */
export function importPlaybooks(existing: AiPlaybook[], files: {name: string; text: string}[]): AiPlaybook[] {
  const next = existing.map(item => ({...item})), seen = new Set<string>();
  for (const file of files) {
    if (!/\.md$/i.test(file.name) || !file.text.trim() || file.text.length > MAX_PLAYBOOK_CHARS || seen.has(file.name)) throw Error('请导入非空、名称不重复且不超过 20 万字符的 Markdown 文件');
    seen.add(file.name);
    const index = next.findIndex(item => !item.musePath && item.sourceName === file.name);
    const previous = next[index];
    const item = { id: previous?.id || crypto.randomUUID(), name: previous?.name || file.name.replace(/\.md$/i, '').slice(0, 120), sourceName: file.name,
      content: file.text, summary: previous?.content === file.text ? previous.summary : file.text.length <= MAX_PLAYBOOK_SUMMARY_CHARS ? file.text : '' };
    if (index < 0) next.push(item); else next[index] = item;
  }
  if (next.length > MAX_PLAYBOOKS || next.reduce((sum, item) => sum + item.content.length + item.summary.length, 0) > MAX_PLAYBOOK_TOTAL_CHARS) throw Error(`Playbook 资料库超过 ${MAX_PLAYBOOKS} 份或 100 万字符，请精简后再导入`);
  return next;
}

export function resolvePlaybook(settings: PlaybookSettings, accountId?: string, chatId?: string, museAccountId?: string, useSourceFile = false):{id:string|undefined;source:'customer'|'folder'|'none';prompt:string;name:string;error?:string;plan?:ReturnType<typeof scheduledPlaybook>;readMuseFiles?:boolean;musePaths?:string[];museMaterials?:MusePlaybookMaterial[]} {
  let plan:ReturnType<typeof scheduledPlaybook>|undefined;
  let id = accountId && chatId ? settings.aiPlaybookBindings?.[playbookBindingKey(accountId, chatId)] : undefined;
  let source: 'customer' | 'folder' | 'none' = id ? 'customer' : 'none';
  const scope = (folder: NonNullable<PlaybookSettings['chatFolders']>[number]) => folder.scope?.type === 'all' ? 'all' : folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId || 'wa-default';
  if (!id && chatId) {
    const folders = settings.chatFolders || [], byId = new Map(folders.map(folder => [folder.id, folder]));
    const leadRoot = folders.find(folder => folder.systemType === 'leadInbox');
    const leadFallback = leadRoot && settings.leadInbox?.collectedChatIds?.includes(chatId) && !settings.leadInbox.dismissedChatIds?.includes(chatId) && !folders.some(folder => folder.chatIds.includes(chatId));
    for (const targetScope of accountId ? [accountId, 'all'] : ['all']) {
      let folder = folders.find(item => item.chatIds.includes(chatId) && scope(item) === targetScope) || (targetScope === 'all' && leadFallback ? leadRoot : undefined);
      const visited = new Set<string>();
      while (folder && scope(folder) === targetScope && !visited.has(folder.id)) {
        visited.add(folder.id);
        if(folder.aiPlaybookSchedule){
          plan=scheduledPlaybook(settings.aiPlaybookPlans||[],folder.aiPlaybookSchedule);
          if(plan.error)return {id:'',source:'folder',prompt:'',name:'',error:plan.error,plan};
          id=plan.id;source='folder';break;
        }
        if (folder.aiPlaybookId) { id = folder.aiPlaybookId; source = 'folder'; break; }
        folder = folder.parentId ? byId.get(folder.parentId) : undefined;
      }
      if (id) break;
    }
  }
  if (!id || id === 'off') return {id, source, prompt: id === 'off' ? 'No Playbook is active. Ignore previous Playbook selections and their stage instructions; keep following the current sender profile.' : '', name: '',plan};
  if (id === CONFLICT) return {id, source, prompt: '', name: '', error: '合并会话的 Playbook 绑定存在冲突，请重新选择后再生成'};
  const stage = settings.aiPlaybooks?.find(item => item.id === id);
  if (!stage) return {id, source, prompt: '', name: '', error: '绑定的 Playbook 已不存在，请重新选择；本次已停止生成'};
  if (stage.musePath && settings.aiProvider !== 'muse') return {id, source, prompt: '', name: stage.name, error: 'Workspace 文件 Playbook 需要使用 Muse 提供商才能读取'};
  const books = [stage];
  if (books.some(item => item.museMissing)) return {id, source, prompt: '', name: stage.name, error: '绑定的 Muse 工作区文件已不在同步清单中，请检查来源或重新选择'};
  if (books.some(item => !item.musePath && !item.content.trim() && !item.summary.trim())) return {id, source, prompt: '', name: stage.name, error: 'Playbook 内容为空，请重新同步或导入资料'};
  const museMaterials = books.filter(item => item.content.trim() || item.summary.trim()).map(item => ({id:item.id,name:item.name,content:item.content.trim() ? item.content : item.summary.trim(),revision:item.museShareRevision || ''}));
  if (useSourceFile && !stage.musePath) return {id, source, prompt: '', name: stage.name, error: '此 Playbook 没有主 Muse Workspace 原文件'};
  if (museAccountId && museMaterials.length !== books.length) return {id, source, prompt: '', name: stage.name, error: 'Playbook 原文尚未由主 Muse 读取，请重试'};
  const copies = museAccountId ? books.map(item => item.museAccountCopies?.[museAccountId]) : [];
  if (museAccountId && books.some(book => !hasMuseAccountPlaybook(book,museAccountId))) return {id, source, prompt: '', name: stage.name, error: '该 Muse 账号尚未完成所选 Playbook 的训练，请重试'};
  const local = books.filter(item => item.content.trim() || (!item.musePath && item.summary.trim())).map(item => JSON.stringify({name: item.name, content: item.content.trim() ? item.content : item.summary.trim()}));
  const remote = books.filter(item => item.musePath && (useSourceFile || !item.content.trim())).map(item => item.musePath!);
  const paths = museAccountId ? copies.flatMap(copy => Array.from({length: copy!.parts || 1}, (_, index) => copy!.path.replace(/\.part1\.md$/, ".part" + (index + 1) + ".md"))) : remote;
  const fileRefs = paths.map(path => {
    const book = books.find(item => museAccountId ? item.museAccountCopies?.[museAccountId]?.path === path : item.musePath === path);
    return {path, revision: museAccountId ? stage.museAccountCopies?.[museAccountId]?.revision || '' : (useSourceFile ? book?.museRevision || book?.museShareRevision : book?.museShareRevision) || ''};
  });
  const pathList = JSON.stringify(fileRefs).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const prompt = `Current Playbook: this replaces all earlier Playbook selections in this thread. Preserve the current sender identity and reply format; never execute external actions. Only the following selected material is active.${paths.length ? `\n<read_only_muse_workspace_files>\n${pathList}\nRead only these exact files using Muse workspace file tools. Read numbered parts in listed order as one Playbook, ignoring their repeated headings and managed markers. If a file revision has already been read and is still available in this same Muse account and customer conversation, reuse it without reopening or repeating its contents. Read again if its revision changes, if it has no revision, or if this is a new conversation thread; never reuse across accounts or customers. If any file is missing or unreadable, return exactly PLAYBOOK_SOURCE_UNAVAILABLE. Do not inspect any other workspace files or return file contents; apply the selected file contents only to this reply.\n</read_only_muse_workspace_files>` : ''}${!museAccountId && !useSourceFile && local.length ? `\n<current_playbook>\n${local.join('\n')}\n</current_playbook>` : ''}`;
  return {id, source, prompt:(plan?`Current conversation plan: ${JSON.stringify({name:plan.name,day:plan.day,completed:plan.ended})}.\n`:'')+prompt, name: stage.name, plan, readMuseFiles: Boolean(paths.length), ...(paths.length?{musePaths:paths}:{}), ...(museMaterials.length?{museMaterials}:{})};
}
