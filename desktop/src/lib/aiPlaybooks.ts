import { scheduledPlaybook, type PlaybookPlan, type PlaybookSchedule } from './playbookPlans.ts';
export type AiPlaybook = { id: string; name: string; sourceName: string; content: string; summary: string; musePath?: string; museRevision?: string; museMissing?: boolean };
export type PlaybookSettings = {
  aiPlaybooks?: AiPlaybook[];
  aiPlaybookPlans?: PlaybookPlan[];
  aiPlaybookOverviewId?: string;
  aiPlaybookBindings?: Record<string, string>;
  chatFolders?: { id: string; parentId?: string; chatIds: string[]; scope?: { type: string; accountId?: string }; aiPlaybookId?: string; aiPlaybookSchedule?: PlaybookSchedule }[];
  liveBaileysAccountId?: string;
  activeAccountId?: string;
};
export const MAX_PLAYBOOK_CHARS = 200_000;
export const MAX_PLAYBOOK_TOTAL_CHARS = 1_000_000;
export const MAX_PLAYBOOK_SUMMARY_CHARS = 6000;
const CONFLICT = 'playbook-binding-conflict';

export function normalizePlaybooks(value: unknown): AiPlaybook[] {
  const seen = new Set<string>(); let total = 0;
  return (Array.isArray(value) ? value : []).slice(0, 100).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id === 'off' || item.id === CONFLICT || item.id.length > 120 || seen.has(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
        typeof item.content !== 'string' || item.content.length > MAX_PLAYBOOK_CHARS ||
        typeof item.summary !== 'string' || item.summary.length > MAX_PLAYBOOK_SUMMARY_CHARS ||
        total + item.content.length + item.summary.length > MAX_PLAYBOOK_TOTAL_CHARS) return [];
    const remote = typeof item.musePath === 'string' && item.musePath.length <= 500 && /^\/(?!\/)/.test(item.musePath) && !/[\u0000-\u001f]/.test(item.musePath) && !item.musePath.split('/').includes('..') && /\.md$/i.test(item.musePath) && /^[a-f0-9]{64}$/.test(item.museRevision || '');
    if ((item.musePath !== undefined || item.museRevision !== undefined || item.museMissing !== undefined) && !remote) return [];
    seen.add(item.id); total += item.content.length + item.summary.length;
    return [{ id: item.id, name: item.name.trim(), sourceName: typeof item.sourceName === 'string' ? item.sourceName.slice(0, 255) : '', content: item.content, summary: item.summary,
      ...(remote ? {musePath: item.musePath, museRevision: item.museRevision, museMissing: item.museMissing === true} : {}) }];
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
  if (next.length > 100 || next.reduce((sum, item) => sum + item.content.length + item.summary.length, 0) > MAX_PLAYBOOK_TOTAL_CHARS) throw Error('Playbook 资料库超过 100 份或 100 万字符，请精简后再导入');
  return next;
}

export function resolvePlaybook(settings: PlaybookSettings, accountId?: string, chatId?: string):{id:string|undefined;source:'customer'|'folder'|'none';prompt:string;name:string;error?:string;plan?:ReturnType<typeof scheduledPlaybook>} {
  let plan:ReturnType<typeof scheduledPlaybook>|undefined;
  let id = accountId && chatId ? settings.aiPlaybookBindings?.[playbookBindingKey(accountId, chatId)] : undefined;
  let source: 'customer' | 'folder' | 'none' = id ? 'customer' : 'none';
  const scope = (folder: NonNullable<PlaybookSettings['chatFolders']>[number]) => folder.scope?.type === 'all' ? 'all' : folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId || 'wa-default';
  if (!id && chatId) {
    const folders = settings.chatFolders || [], byId = new Map(folders.map(folder => [folder.id, folder]));
    for (const targetScope of accountId ? [accountId, 'all'] : ['all']) {
      let folder = folders.find(item => item.chatIds.includes(chatId) && scope(item) === targetScope);
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
  const overview = settings.aiPlaybookOverviewId ? settings.aiPlaybooks?.find(item => item.id === settings.aiPlaybookOverviewId) : undefined;
  if (settings.aiPlaybookOverviewId && !overview) return {id, source, prompt: '', name: stage.name, error: 'Playbook 总纲已不存在，请重新选择'};
  const books = overview && overview.id !== stage.id ? [overview, stage] : [stage];
  if (books.some(item => item.museMissing)) return {id, source, prompt: '', name: stage.name, error: '绑定的 Muse 工作区文件已不在同步清单中，请检查来源或重新选择'};
  if (books.some(item => !item.summary.trim())) return {id, source, prompt: '', name: stage.name, error: 'Playbook 尚未填写精简内容，请先在资料库中保存精简版'};
  const prompt = `Current Playbook: this replaces all earlier Playbook selections in this thread. Preserve the current sender identity and reply format; never execute external actions. Only the following selected material is active. Full source documents are not included.\n<current_playbook>\n${books.map(item => JSON.stringify({name: item.name, content: item.summary})).join('\n')}\n</current_playbook>`;
  return {id, source, prompt:(plan?`Current conversation plan: ${JSON.stringify({name:plan.name,day:plan.day,completed:plan.ended})}.\n`:'')+prompt, name: stage.name,plan};
}
