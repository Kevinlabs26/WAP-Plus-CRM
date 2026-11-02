import type { ChatPreview, Contact, Message } from "../types/crm";
import type { SettingsShape } from "../store/settingsDefaults";
import { normalizePastedPhone } from "./pastedContacts";
import { normalizeIngestPhone } from "../store/bridgeIngestHelpers";

export type FolderPhoneCandidate = { phone: string; chats: { id: string; accountId: string }[] };
type FolderState = { chats: ChatPreview[]; contacts: Contact[]; settings: SettingsShape };

/** Include aliases and same-number threads when checking history, but only export folder members. */
export function folderPhoneCandidates(state: FolderState, folderId: string): FolderPhoneCandidate[] {
  const folder = state.settings.chatFolders.find(item => item.id === folderId);
  if (!folder) throw new Error("folderMissing");
  const account = folder.scope?.type === "all" ? null : folder.scope?.accountId || state.settings.liveBaileysAccountId || state.settings.activeAccountId;
  const members = new Set([...folder.chatIds, ...state.settings.chatFolderClones.filter(clone => clone.folderId === folderId).map(clone => clone.sourceChatId)]);
  const contacts = new Map(state.contacts.map(contact => [contact.id, contact]));
  const privateChats = state.chats.flatMap(chat => {
    const contact = contacts.get(chat.contactId);
    if (!contact || chat.isGroup || contact.isGroup || contact.channelAddress?.endsWith("@g.us") || chat.localOnly) return [];
    const owner = chat.accountId || chat.phoneId || contact.accountId || contact.boundPhoneId || "wa-default";
    if (account && owner !== account) return [];
    const phone = normalizePastedPhone(contact.phone || "") || normalizeIngestPhone(contact.channelAddress || "");
    return phone ? [{ id: chat.id, accountId: owner, phone }] : [];
  });
  const candidates = new Map<string, FolderPhoneCandidate>();
  for (const chat of privateChats) {
    if (members.has(chat.id) && !candidates.has(chat.phone)) candidates.set(chat.phone, { phone: chat.phone, chats: [] });
  }
  for (const chat of privateChats) candidates.get(chat.phone)?.chats.push({ id: chat.id, accountId: chat.accountId });
  return [...candidates.values()];
}

export function neverRepliedPhones(candidates: FolderPhoneCandidate[], messages: Message[], storedInboundChatIds: readonly string[]): string[] {
  const owners = new Map(candidates.flatMap(candidate => candidate.chats.map(chat => [chat.id, chat.accountId] as const)));
  const replied = new Set(storedInboundChatIds);
  for (const message of messages) {
    const owner = owners.get(message.chatId);
    const messageOwner = message.accountId || message.deviceId;
    if (owner && (!messageOwner || owner === messageOwner) && message.direction === "in" && message.mediaType !== "system" && !message.systemKind) replied.add(message.chatId);
  }
  return candidates.filter(candidate => !candidate.chats.some(chat => replied.has(chat.id))).map(candidate => candidate.phone);
}

export async function copyNeverRepliedFolderNumbers(folderId: string, deps: {
  getState: () => FolderState & { messages: Message[]; hydrated: boolean; uiReady: boolean };
  flush: () => Promise<void>;
  findInbound: (chatIds: string[]) => Promise<string[]>;
  writeText: (text: string) => Promise<void>;
}): Promise<number> {
  const initial = deps.getState();
  if (!initial.hydrated || !initial.uiReady) throw new Error("Not ready");
  await deps.flush();
  const candidates = folderPhoneCandidates(deps.getState(), folderId);
  if (!candidates.length) return 0;
  const chatIds = [...new Set(candidates.flatMap(candidate => candidate.chats.map(chat => chat.id)))];
  const storedInbound = await deps.findInbound(chatIds);
  const current = deps.getState();
  const latest = folderPhoneCandidates(current, folderId);
  if (!current.hydrated || !current.uiReady || JSON.stringify(latest) !== JSON.stringify(candidates)) throw new Error("Folder changed");
  const phones = neverRepliedPhones(latest, current.messages, storedInbound);
  if (phones.length) await deps.writeText(phones.join("\n"));
  return phones.length;
}
