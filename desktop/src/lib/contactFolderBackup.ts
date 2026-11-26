import type { ChatPreview, Contact } from "@/types/crm";
import type { SettingsChatFolder, SettingsChatFolderClone } from "@/store/settingsDefaults";

type FolderData = { contacts: Contact[]; chats: ChatPreview[]; chatFolders: SettingsChatFolder[]; chatFolderClones?: SettingsChatFolderClone[] };
type BackupEntry = { id: string; name: string; parentId: string; index: number; type: "folder" | "user"; wid?: string; accountId?: string; clone?: boolean; sourceFolderId?: string };
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
function address(value: string) {
  const normalized = value.toLowerCase().replace(/@s\.whatsapp\.net$/, "@c.us");
  return /^(?:[1-9]\d{6,14}@c\.us|\d{1,24}@lid|[\d-]{5,40}@g\.us)$/.test(normalized) ? normalized : "";
}

export function parseContactFolderBackup(input: unknown) {
  const source = record(record(record(input).userGroupData).userSetting);
  const folders = new Map<string, BackupEntry>();
  const members: BackupEntry[] = [];
  for (const [key, raw] of Object.entries(source)) {
    const row = record(raw);
    const id = str(row.id) || key;
    const entry = { id, name: str(row.name) || str(row.secondName),
      parentId: str(row.parentId), index: typeof row.index === "number" && Number.isFinite(row.index) ? row.index : 0 };
    if (row.type === "folder" && entry.name) folders.set(id, { ...entry, type: "folder",
      sourceFolderId: /^[\w-]{1,120}$/.test(str(row.sourceFolderId)) ? str(row.sourceFolderId) : undefined });
    if (row.type === "user") members.push({ ...entry, type: "user", wid: address(str(row.wid)) || address(id) || address(key),
      accountId: str(row.accountId) || undefined, clone: row.clone === true });
  }
  if (!folders.size) throw new Error("folderTransfer.invalid");
  const seen = new Set<string>();
  const pending = [...folders.values()].sort((a, b) => a.index - b.index);
  const ordered: BackupEntry[] = [];
  while (pending.length) {
    const next = pending.filter(folder => !folders.has(folder.parentId) || seen.has(folder.parentId));
    if (!next.length) throw new Error("folderTransfer.invalid");
    for (const folder of next) { seen.add(folder.id); ordered.push(folder); }
    for (let i = pending.length - 1; i >= 0; i--) if (seen.has(pending[i].id)) pending.splice(i, 1);
  }
  return { folders: ordered, members: members.filter(member => folders.has(member.parentId)).sort((a,b) => a.index - b.index) };
}

function contactAddresses(contact: Contact) {
  const phone = contact.phone?.replace(/^\+/, "");
  return [address(phone ? phone + "@c.us" : ""), address(contact.channelAddress || "")].filter(Boolean);
}

export function importContactFolderBackup(data: FolderData, backup: ReturnType<typeof parseContactFolderBackup>, accountId: string, mergedAccountIds?: readonly string[]) {
  const contacts = [...data.contacts], chats = [...data.chats];
  const chatFolders = data.chatFolders.map(folder => ({ ...folder, chatIds: [...folder.chatIds] }));
  const allowedAccounts = new Set(mergedAccountIds || [accountId]);
  const scope = mergedAccountIds ? { type: "all" as const } : { type: "account" as const, accountId };
  const inScope = (folder: SettingsChatFolder) => scope.type === "all"
    ? folder.scope?.type === "all"
    : folder.scope?.type === "account" && folder.scope.accountId === accountId;
  const owner = (contact: Contact) => contact.accountId || contact.boundPhoneId;
  const byAddress = new Map<string, Contact[]>();
  for (const contact of contacts) {
    if (!allowedAccounts.has(owner(contact) || "")) continue;
    for (const wid of new Set(contactAddresses(contact))) {
      const existing = byAddress.get(wid);
      if (existing) existing.push(contact);
      else byAddress.set(wid, [contact]);
    }
  }
  const chatsByContact = new Map(chats.filter(chat => allowedAccounts.has(chat.accountId || chat.phoneId) && !chat.localOnly)
    .map(chat => [chat.contactId, chat]));
  const bySource = new Map<string, SettingsChatFolder>();
  let sort = chatFolders.reduce((max, folder) => Math.max(max, folder.sort || 0), 0);
  for (const folder of backup.folders) {
    const parentId = bySource.get(folder.parentId)?.id;
    const sourceId = mergedAccountIds && folder.sourceFolderId ? folder.sourceFolderId : undefined;
    const mergedId = sourceId?.startsWith("folder-backup-") ? sourceId : sourceId ? `folder-backup-${sourceId}` : undefined;
    let target = chatFolders.find(item => !item.systemType && inScope(item) &&
      (sourceId ? item.id === sourceId || item.id === mergedId : item.parentId === parentId && item.name === folder.name));
    if (!target) {
      target = { id: mergedId || crypto.randomUUID(), name: folder.name, parentId, sort: ++sort, chatIds: [], scope };
      chatFolders.push(target);
    }
    bySource.set(folder.id, target);
  }
  const moved = new Map<string, string>();
  const memberships = new Map<string, { chatId: string; folderId: string }>();
  const chatFolderClones = [...(data.chatFolderClones || [])];
  let skipped = 0;
  for (const member of backup.members) {
    const wid = member.wid || "";
    const memberAccount = mergedAccountIds && member.accountId && allowedAccounts.has(member.accountId) ? member.accountId : undefined;
    let matches = (byAddress.get(wid) || []).filter(contact => !memberAccount || owner(contact) === memberAccount);
    if (!matches.length && wid.endsWith("@c.us")) {
      const phone = "+" + wid.split("@")[0];
      const targetAccount = memberAccount || accountId;
      const contact: Contact = { id: crypto.randomUUID(), name: member.name || phone, phone, stage: "new", tags: [], accountId: targetAccount, boundPhoneId: targetAccount, source: "folder-backup" };
      contacts.push(contact);
      matches = [contact];
      byAddress.set(wid, [...(byAddress.get(wid) || []), contact]);
    }
    if (!matches.length || wid.endsWith("@lid") && new Set(matches.map(owner)).size > 1) { skipped++; continue; }
    for (const contact of mergedAccountIds ? matches : matches.slice(0, 1)) {
      let chat = chatsByContact.get(contact.id);
      if (!chat) {
        const chatAccount = owner(contact) || accountId;
        chat = { id: "bridge-chat-" + contact.id, contactId: contact.id, contactName: contact.name,
          lastMessage: "", unread: 0, updatedAt: new Date().toISOString(), phoneId: chatAccount, accountId: chatAccount,
          isGroup: contact.isGroup };
        chats.push(chat);
        chatsByContact.set(contact.id, chat);
      }
      const folderId = bySource.get(member.parentId)!.id;
      if (mergedAccountIds) memberships.set(JSON.stringify([chat.id, folderId]), { chatId: chat.id, folderId });
      if ((!mergedAccountIds || !member.clone) && !moved.has(chat.id)) moved.set(chat.id, folderId);
    }
  }
  for (const folder of chatFolders) {
    if (!folder.systemType && inScope(folder)) {
      folder.chatIds = folder.chatIds.filter(id => !moved.has(id) || moved.get(id) === folder.id);
    }
  }
  const byId = new Map(chatFolders.map(folder => [folder.id, folder]));
  const existingIds = new Map([...byId].map(([id, folder]) => [id, new Set(folder.chatIds)]));
  for (const [chatId, folderId] of moved) if (!existingIds.get(folderId)?.has(chatId)) byId.get(folderId)!.chatIds.push(chatId);
  if (mergedAccountIds) {
    const recorded = new Set(chatFolderClones.map(clone => JSON.stringify([clone.sourceChatId, clone.folderId])));
    for (const [key, { chatId, folderId }] of memberships) {
      if (moved.get(chatId) === folderId || byId.get(folderId)?.chatIds.includes(chatId) || recorded.has(key)) continue;
      chatFolderClones.push({ id: crypto.randomUUID(), folderId, sourceChatId: chatId });
    }
  }
  return { contacts, chats, chatFolders, chatFolderClones, assigned: mergedAccountIds ? new Set([...memberships.values()].map(row => row.chatId)).size : moved.size, skipped };
}

export function exportContactFolderBackup(data: FolderData, accountId: string | null) {
  const allFolders = new Map(data.chatFolders.map(folder => [folder.id, folder]));
  const folders = data.chatFolders.filter(folder => !folder.systemType &&
    (accountId === null || folder.scope?.type === "all" || folder.scope?.type === "account" && folder.scope.accountId === accountId))
    .sort((a,b) => a.sort - b.sort);
  const folderIds = new Map(folders.map((folder, i) => [folder.id, String(100 + i)]));
  const contacts = new Map(data.contacts.map(contact => [contact.id, contact]));
  const chats = new Map(data.chats.filter(chat => !chat.localOnly && (accountId === null || (chat.accountId || chat.phoneId) === accountId)).map(chat => [chat.id, chat]));
  const clonesByFolder = new Map<string, string[]>();
  if (accountId === null) for (const clone of data.chatFolderClones || []) {
    const existing = clonesByFolder.get(clone.folderId) || [];
    existing.push(clone.sourceChatId);
    clonesByFolder.set(clone.folderId, existing);
  }
  const depth = (id: string) => {
    const seen = new Set<string>();
    let parent = allFolders.get(id)?.parentId;
    while (parent && folderIds.has(parent) && !seen.has(parent)) { seen.add(parent); parent = allFolders.get(parent)?.parentId; }
    return seen.size + 1;
  };
  const output: Record<string, object> = {};
  for (const [index, folder] of folders.entries()) {
    const id = folderIds.get(folder.id)!;
    const parentId = folderIds.get(folder.parentId || "") || "top";
    let member = 0;
    const primary = new Set(folder.chatIds);
    for (const chatId of new Set([...primary, ...(clonesByFolder.get(folder.id) || [])])) {
      const chat = chats.get(chatId);
      const contact = chat && contacts.get(chat.contactId);
      const wid = contact && contactAddresses(contact)[0];
      if (!chat || !contact || !wid) continue;
      const key = accountId === null ? `member-${id}-${member}` : wid;
      if (Object.hasOwn(output, key)) continue;
      output[key] = { id: key, wid, type: "user", name: contact.name, secondName: "", index: member++, parentId: id,
        ...(accountId === null ? { accountId: chat.accountId || chat.phoneId, clone: !primary.has(chatId) } : {}),
        parent: depth(folder.id) + 1, show: true, lost: false, unreadCount: 0, lastMessage: { t: 0 } };
    }
    output[id] = { id, type: "folder", name: folder.name, index, parentId, parent: depth(folder.id), member,
      ...(accountId === null ? { sourceFolderId: folder.id } : {}),
      image: "", open: !folder.collapsed, send: false, show: true, lastMessage: { snippet: "", time: "" } };
  }
  return { userSetting: {}, userGroupData: { userSetting: output } };
}
