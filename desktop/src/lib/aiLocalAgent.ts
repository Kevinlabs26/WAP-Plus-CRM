import type { AppState } from "@/store/types";
import type { ChatPreview, Contact } from "@/types/crm";
import { LEAD_INBOX_FOLDER_ID, type SettingsChatFolder } from "@/store/settingsDefaults";
import { buildPersonKey } from "@/lib/utils";
import { contactSendablePhone, normalizeBroadcastPhone } from "@/lib/broadcastTemplate";
import { lastContactedAccounts, recipientKey } from "@/lib/scheduledPlans";

export type AiLocalAgentAction =
  | { type: "list_folder_contacts"; folder: string }
  | { type: "prepare_invitation"; folder: string; phoneNumbers?: string[] }
  | { type: "create_folder"; name: string; parentFolder?: string }
  | { type: "rename_folder"; folder: string; name: string }
  | { type: "add_contact_to_folder" | "move_contact_to_folder" | "remove_contact_from_folder"; contact: string; folder: string };

export type ResolvedAiLocalAgentAction =
  | { type: "list_folder_contacts"; folderName: string; subfolders: string[]; contacts: { name: string; phone?: string }[] }
  | { type: "prepare_invitation"; folderName: string; phoneNumbers: string[]; contacts: { contactId: string; chatId: string; accountId: string; name: string; phone: string; lastContactedAccountId?: string }[]; unmatchedPhones: string[]; fallbackAccountId: string }
  | { type: "create_folder"; name: string; parentFolderId?: string; scope: SettingsChatFolder["scope"]; folderKey: string }
  | { type: "rename_folder"; folderId: string; oldName: string; name: string }
  | { type: "add_contact_to_folder" | "move_contact_to_folder" | "remove_contact_from_folder"; chatId: string; contactName: string; folderId?: string; folderKey?: string; folderName: string };

const nameKey = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase();
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function parseAiLocalAgentActions(raw: string): AiLocalAgentAction[] {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  if (text.length > 12_000) throw Error("Muse 返回的操作计划过长；未执行");
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw Error("CRM_AGENT_INVALID_PLAN"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !exactKeys(parsed as Record<string, unknown>, ["actions"])) throw Error("Muse 未返回有效的 CRM 操作计划");
  const actions = (parsed as { actions?: unknown }).actions;
  if (!Array.isArray(actions) || actions.length > 10) throw Error("CRM_AGENT_INVALID_PLAN");
  const result = actions.map((value): AiLocalAgentAction => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("CRM 操作格式无效");
    const row = value as Record<string, unknown>;
    const bounded = (key: string, max: number) => typeof row[key] === "string" && !!row[key].trim() && row[key].trim().length <= max && !/[\u0000-\u001f\u007f]/.test(row[key] as string);
    if (row.type === "list_folder_contacts" && exactKeys(row, ["type", "folder"]) && bounded("folder", 160)) {
      return { type: row.type, folder: (row.folder as string).trim() };
    }
    if (row.type === "prepare_invitation" &&
        (exactKeys(row, ["type", "folder"]) || exactKeys(row, ["type", "folder", "phoneNumbers"])) && bounded("folder", 160)) {
      if (row.phoneNumbers === undefined) return { type: row.type, folder: (row.folder as string).trim() };
      if (!Array.isArray(row.phoneNumbers) || row.phoneNumbers.length === 0 || row.phoneNumbers.length > 50 ||
          !row.phoneNumbers.every(phone => typeof phone === "string" && /^\+?[\d\s().-]{7,25}$/.test(phone))) {
        throw Error("邀请名单中有无效号码；未准备发送");
      }
      const phoneNumbers = [...new Set((row.phoneNumbers as string[]).map(normalizeBroadcastPhone))];
      if (phoneNumbers.some(phone => !phone)) throw Error("邀请名单中有无效号码；未准备发送");
      return { type: row.type, folder: (row.folder as string).trim(), phoneNumbers: phoneNumbers as string[] };
    }
    if (row.type === "create_folder" && (exactKeys(row, ["type", "name"]) || exactKeys(row, ["type", "name", "parentFolder"])) && bounded("name", 40) && (row.parentFolder === undefined || bounded("parentFolder", 40))) {
      return { type: row.type, name: (row.name as string).trim(), ...(typeof row.parentFolder === "string" ? { parentFolder: row.parentFolder.trim() } : {}) };
    }
    if (row.type === "rename_folder" && exactKeys(row, ["type", "folder", "name"]) && bounded("folder", 40) && bounded("name", 40)) {
      return { type: row.type, folder: (row.folder as string).trim(), name: (row.name as string).trim() };
    }
    if (["add_contact_to_folder", "move_contact_to_folder", "remove_contact_from_folder"].includes(String(row.type)) && exactKeys(row, ["type", "contact", "folder"]) && bounded("contact", 120) && bounded("folder", 40)) {
      return { type: row.type as "add_contact_to_folder" | "move_contact_to_folder" | "remove_contact_from_folder", contact: (row.contact as string).trim(), folder: (row.folder as string).trim() };
    }
    throw Error("Muse 返回了未授权或格式不正确的 CRM 操作；未执行");
  });
  if (result.some(action => action.type === "list_folder_contacts") && result.length !== 1) throw Error("读取分组成员的请求必须单独执行；未执行任何操作");
  if (result.some(action => action.type === "prepare_invitation") && result.length !== 1) throw Error("准备邀请必须单独执行；未执行任何操作");
  return result;
}

function folderMatches(folders: readonly SettingsChatFolder[], query: string) {
  const path = query.split(/\s*(?:\/|>|→)\s*/u).map(part => part.trim()).filter(Boolean);
  if (path.length < 2) return folders.filter(folder => nameKey(folder.name) === nameKey(query));
  let matches = folders.filter(folder => !folder.parentId && nameKey(folder.name) === nameKey(path[0]!));
  for (const part of path.slice(1)) {
    const parents = new Set(matches.map(folder => folder.id));
    matches = folders.filter(folder => !!folder.parentId && parents.has(folder.parentId) && nameKey(folder.name) === nameKey(part));
  }
  return matches;
}
function sameFolderScope(a: SettingsChatFolder["scope"], b: SettingsChatFolder["scope"]) {
  return a?.type === b?.type && (a?.type !== "account" || b?.type === "account" && a.accountId === b.accountId);
}
function isInLeadTree(folders: readonly SettingsChatFolder[], folderId: string) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const seen = new Set<string>();
  let folder = byId.get(folderId);
  while (folder && !seen.has(folder.id)) {
    if (folder.id === LEAD_INBOX_FOLDER_ID || folder.systemType === "leadInbox") return true;
    seen.add(folder.id);
    folder = folder.parentId ? byId.get(folder.parentId) : undefined;
  }
  return false;
}
function resolvedFolder(folders: readonly SettingsChatFolder[], query: string, virtual: Map<string, ResolvedAiLocalAgentAction & { type: "create_folder" }>) {
  const created = virtual.get(nameKey(query));
  if (created) return { created };
  const matches = folderMatches(folders, query);
  if (matches.length > 1) throw Error(`分组“${query}”重名，请先调整名称`);
  if (matches[0]) return { folder: matches[0] };
  throw Error(`找不到分组“${query}”`);
}
function folderContents(folders: readonly SettingsChatFolder[], clones: readonly { folderId: string; sourceChatId: string }[], folderId: string) {
  const byId = new Map(folders.map(item => [item.id, item]));
  const included = new Set<string>();
  const visit = (id: string) => {
    if (included.has(id)) return;
    const current = byId.get(id);
    if (!current) return;
    included.add(id);
    for (const child of folders) if (child.parentId === id) visit(child.id);
  };
  visit(folderId);
  const members = new Set<string>();
  for (const folder of folders) if (included.has(folder.id)) {
    for (const chatId of folder.chatIds) members.add(chatId);
    for (const clone of clones) if (clone.folderId === folder.id) members.add(clone.sourceChatId);
  }
  return { included, members };
}
function defaultSendAccount(settings: AppState["settings"]) {
  const accounts = settings.waAccounts || [];
  return [settings.liveBaileysAccountId, settings.activeAccountId].find(id => accounts.some(account => account.id === id)) || accounts[0]?.id || "";
}
function contactMatches(chats: readonly ChatPreview[], contacts: readonly Contact[], query: string, selectedChatId?: string | null) {
  if (query === "@selected_contact") {
    const selected = chats.find(chat => chat.id === selectedChatId && !chat.localOnly && !chat.isGroup);
    return selected ? [selected] : [];
  }
  const key = nameKey(query), digits = query.replace(/\D/g, "");
  return chats.filter(chat => {
    if (chat.localOnly || chat.isGroup) return false;
    const contact = contacts.find(item => item.id === chat.contactId);
    if (contact?.isGroup) return false;
    return nameKey(chat.contactName) === key || nameKey(contact?.name || "") === key ||
      (digits.length >= 6 && contact?.phone.replace(/\D/g, "") === digits);
  });
}
function defaultFolderScope(settings: AppState["settings"], parent?: SettingsChatFolder): SettingsChatFolder["scope"] {
  if (parent) return parent.scope;
  const view = settings.accountViewMode || { type: "all" as const };
  return view.type === "account" ? { type: "account", accountId: view.accountId } : view.type === "all" ? { type: "all" } : { type: "account", accountId: settings.activeAccountId };
}

export function resolveAiLocalAgentActions(actions: AiLocalAgentAction[], state: Pick<AppState, "settings" | "chats" | "contacts" | "messages">, selectedChatId?: string | null, fallbackAccountId?: string): ResolvedAiLocalAgentAction[] {
  const folders = state.settings.chatFolders || [];
  const virtual = new Map<string, ResolvedAiLocalAgentAction & { type: "create_folder" }>();
  const creates = actions.filter((action): action is Extract<AiLocalAgentAction, { type: "create_folder" }> => action.type === "create_folder");
  const ordered = [...creates, ...actions.filter(action => action.type !== "create_folder")];
  const resolved: ResolvedAiLocalAgentAction[] = [];
  const changedContacts = new Set<string>();
  const changedFolders = new Set<string>();
  for (const action of ordered) {
    if (action.type === "create_folder") {
      const key = nameKey(action.name);
      const parent = action.parentFolder ? resolvedFolder(folders, action.parentFolder, virtual).folder : undefined;
      if (action.parentFolder && (!parent || isInLeadTree(folders, parent.id))) throw Error("不能在此系统分组下创建子分组");
      const scope = defaultFolderScope(state.settings, parent);
      if (!key || folders.some(folder => nameKey(folder.name) === key && sameFolderScope(folder.scope, scope)) || virtual.has(key)) throw Error(`分组“${action.name}”已存在或重复创建`);
      const item = { type: action.type, name: action.name, ...(parent ? { parentFolderId: parent.id } : {}), scope, folderKey: key } as const;
      virtual.set(key, item);
      resolved.push(item);
      continue;
    }
    if (action.type === "rename_folder") {
      const { folder } = resolvedFolder(folders, action.folder, virtual);
      if (!folder || isInLeadTree(folders, folder.id)) throw Error("系统分组不能重命名");
      if (changedFolders.has(folder.id)) throw Error(`分组“${folder.name}”不能在同一条指令中重复修改`);
      if (nameKey(folder.name) === nameKey(action.name)) throw Error(`分组“${folder.name}”已经是这个名称`);
      if (folders.some(item => item.id !== folder.id && nameKey(item.name) === nameKey(action.name) && sameFolderScope(item.scope, folder.scope)) || virtual.has(nameKey(action.name))) throw Error(`分组“${action.name}”已存在`);
      changedFolders.add(folder.id);
      resolved.push({ type: action.type, folderId: folder.id, oldName: folder.name, name: action.name });
      continue;
    }
    if (action.type === "list_folder_contacts") {
      if (actions.length !== 1) throw Error("读取分组成员的请求必须单独执行；未执行任何操作");
      const { folder } = resolvedFolder(folders, action.folder, virtual);
      if (!folder) throw Error(`找不到分组“${action.folder}”`);
      const { included, members } = folderContents(folders, state.settings.chatFolderClones || [], folder.id);
      const chatsById = new Map(state.chats.map(item => [item.id, item]));
      const contactsById = new Map(state.contacts.map(item => [item.id, item]));
      const seenContacts = new Set<string>();
      const contacts = [...members].flatMap(chatId => {
        const chat = chatsById.get(chatId);
        if (!chat || chat.localOnly || chat.isGroup) return [];
        const contact = contactsById.get(chat.contactId);
        if (contact?.isGroup) return [];
        const keys = [contact?.personKey, buildPersonKey({ phone: contact?.phone, channelAddress: contact?.channelAddress }), contact?.id || chat.id]
          .filter((key): key is string => !!key);
        if (keys.some(key => seenContacts.has(key))) return [];
        keys.forEach(key => seenContacts.add(key));
        const name = contact?.name?.trim() || chat.contactName.trim() || contact?.phone || "";
        return name ? [{ name, ...(contact?.phone ? { phone: contact.phone } : {}) }] : [];
      }).sort((a, b) => a.name.localeCompare(b.name));
      resolved.push({ type: action.type, folderName: folder.name, subfolders: folders.filter(item => included.has(item.id) && item.id !== folder.id).map(item => item.name), contacts });
      continue;
    }
    if (action.type === "prepare_invitation") {
      if (actions.length !== 1) throw Error("准备邀请必须单独执行；未执行任何操作");
      const { folder } = resolvedFolder(folders, action.folder, virtual);
      if (!folder) throw Error(`找不到分组“${action.folder}”`);
      const { members } = folderContents(folders, state.settings.chatFolderClones || [], folder.id);
      const chatsById = new Map(state.chats.map(item => [item.id, item]));
      const contactsById = new Map(state.contacts.map(item => [item.id, item]));
      const requested = action.phoneNumbers && new Set(action.phoneNumbers);
      const matched = new Map<string, { contactId: string; chatId: string; accountId: string; name: string; phone: string }>();
      for (const chatId of members) {
        const chat = chatsById.get(chatId);
        if (!chat || chat.localOnly || chat.isGroup) continue;
        const contact = contactsById.get(chat.contactId);
        if (!contact || contact.isGroup) continue;
        const phone = contactSendablePhone(contact);
        if (!phone || requested && !requested.has(phone) || matched.has(phone)) continue;
        matched.set(phone, { contactId: contact.id, chatId: chat.id, accountId: chat.accountId || chat.phoneId || contact.accountId || fallbackAccountId || defaultSendAccount(state.settings), name: contact.name?.trim() || chat.contactName.trim() || phone, phone });
        if (!requested && matched.size > 50) throw Error("CRM_AGENT_INVITATION_TOO_MANY");
      }
      const fallback = fallbackAccountId || defaultSendAccount(state.settings);
      if (!fallback || !state.settings.waAccounts?.some(account => account.id === fallback)) throw Error("CRM_AGENT_NO_SEND_ACCOUNT");
      const lastAccounts = lastContactedAccounts(state.chats, state.contacts, state.messages);
      const phoneNumbers = action.phoneNumbers || [...matched.keys()];
      const contacts = phoneNumbers.flatMap(phone => {
        const contact = matched.get(phone);
        return contact ? [{ ...contact, lastContactedAccountId: lastAccounts.get(recipientKey("", phone)) }] : [];
      });
      resolved.push({ type: action.type, folderName: folder.name, phoneNumbers, contacts,
        unmatchedPhones: action.phoneNumbers?.filter(phone => !matched.has(phone)) || [], fallbackAccountId: fallback });
      continue;
    }
    const { folder, created } = resolvedFolder(folders, action.folder, virtual);
    if (folder && isInLeadTree(folders, folder.id)) throw Error("暂不允许 AI 修改系统分组");
    const targetScope = folder?.scope || created?.scope;
    const matches = contactMatches(state.chats, state.contacts, action.contact, selectedChatId).filter(chat =>
      !targetScope || targetScope.type === "all" || chat.accountId === targetScope.accountId || state.contacts.find(item => item.id === chat.contactId)?.accountId === targetScope.accountId
    );
    if (matches.length !== 1) throw Error(matches.length ? `联系人“${action.contact}”匹配到多个会话，请选中目标会话并说“当前联系人”，或提供更具体的姓名` : `找不到联系人“${action.contact}”`);
    const chat = matches[0]!;
    const contactName = state.contacts.find(item => item.id === chat.contactId)?.name || chat.contactName;
    if (changedContacts.has(chat.id)) throw Error(`同一条指令不能重复改动联系人“${contactName}”，请拆成多条指令`);
    changedContacts.add(chat.id);
    const folderId = folder?.id;
    const existingPrimary = !!folder?.chatIds.includes(chat.id);
    const existingClone = !!state.settings.chatFolderClones?.some(clone => clone.folderId === folderId && clone.sourceChatId === chat.id);
    if (action.type === "add_contact_to_folder" && (existingPrimary || existingClone)) throw Error(`${contactName} 已在分组“${action.folder}”中`);
    if (action.type === "move_contact_to_folder" && existingPrimary) throw Error(`${contactName} 已主归属分组“${action.folder}”`);
    if (action.type === "remove_contact_from_folder" && !existingPrimary && !existingClone) throw Error(`${contactName} 不在分组“${action.folder}”中`);
    resolved.push({ type: action.type, chatId: chat.id, contactName, ...(folderId ? { folderId } : { folderKey: created!.folderKey }), folderName: folder?.name || created!.name });
  }
  return resolved;
}
