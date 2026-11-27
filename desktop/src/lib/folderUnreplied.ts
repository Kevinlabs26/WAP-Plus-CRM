import type { ChatPreview, Contact, Message } from "../types/crm";
import type { SettingsShape } from "../store/settingsDefaults";
import { normalizePastedPhone } from "./pastedContacts";
import { normalizeIngestPhone } from "../store/bridgeIngestHelpers";
import { LEAD_INBOX_FOLDER_ID } from "../store/settingsDefaults";
import { isConversationOutgoing } from "./leadInbox";

export type FolderPhoneCandidate = { phone: string; chats: { id: string; accountId: string }[] };
type FolderState = { chats: ChatPreview[]; contacts: Contact[]; settings: SettingsShape };

/** Include aliases and same-number threads when checking history, but only export folder members. */
export function folderPhoneCandidates(state: FolderState, folderId: string): FolderPhoneCandidate[] {
  const folder = state.settings.chatFolders.find(item => item.id === folderId);
  if (!folder) throw new Error("folderMissing");
  const account = folder.scope?.type === "all" ? null : folder.scope?.accountId || state.settings.liveBaileysAccountId || state.settings.activeAccountId;
  const members = new Set([...folder.chatIds, ...state.settings.chatFolderClones.filter(clone => clone.folderId === folderId).map(clone => clone.sourceChatId)]);
  if (folderId === LEAD_INBOX_FOLDER_ID) {
    for (const chatId of state.settings.leadInbox.collectedChatIds) members.add(chatId);
    for (const chatId of state.settings.leadInbox.dismissedChatIds) members.delete(chatId);
  }
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

/** Export folder members whose latest real conversation is before the selected cutoff. */
export function inactiveFolderPhones(
  candidates: FolderPhoneCandidate[],
  chats: ChatPreview[],
  messages: Message[],
  cutoffMs: number,
  includeNeverContacted: boolean,
  storedActivity: ReadonlyMap<string, number> = new Map(),
): string[] {
  if (!Number.isFinite(cutoffMs)) return [];
  const chatById = new Map(chats.map(chat => [chat.id, chat]));
  const owners = new Map(candidates.flatMap(candidate => candidate.chats.map(chat => [chat.id, chat.accountId] as const)));
  const cachedActivity = new Map<string, number>();
  for (const message of messages) {
    const owner = owners.get(message.chatId);
    const messageOwner = message.accountId || message.deviceId;
    if (!owner || messageOwner && messageOwner !== owner) continue;
    if (message.mediaType === "system" || (message.direction === "in" ? !!message.systemKind
      : !isConversationOutgoing(message) || message.deliveryUncertain || message.deliveryStatus === "local")) continue;
    const at = Date.parse(message.sentAt);
    if (!Number.isFinite(at)) continue;
    cachedActivity.set(message.chatId, Math.max(at, cachedActivity.get(message.chatId) || 0));
  }
  const lastActivity = (chatId: string): number | null => {
    const chat = chatById.get(chatId);
    let latest = Math.max(cachedActivity.get(chatId) || 0, storedActivity.get(chatId) || 0);
    if (!chat || chat.hasMessageHistory === false) return latest || null;
    const hasConversationSignal = chat.hasMessageHistory === true ||
      chat.lastMessageDirection === "in" || chat.lastMessageDirection === "out" ||
      Boolean(chat.firstConversationMessage || chat.lastSuccessfulOutgoing) ||
      (chat.hasMessageHistory === undefined && Boolean(chat.lastMessage.trim()));
    if (hasConversationSignal) {
      const previewTime = chat.lastMessageDirection === "in" ? chat.updatedAt : undefined;
      for (const value of [previewTime, chat.replyPendingSince, chat.firstConversationMessage?.at, chat.lastSuccessfulOutgoing?.at]) {
        const at = Date.parse(value || "");
        if (Number.isFinite(at)) latest = Math.max(latest, at);
      }
    }
    return latest || null;
  };
  return candidates.filter(candidate => {
    const activityTimes = candidate.chats.map(chat => lastActivity(chat.id)).filter((at): at is number => at !== null);
    if (!activityTimes.length) return includeNeverContacted;
    return Math.max(...activityTimes) <= cutoffMs;
  }).map(candidate => candidate.phone);
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

export async function copyInactiveFolderNumbers(folderId: string, cutoffMs: number, includeNeverContacted: boolean, deps: {
  getState: () => FolderState & { messages: Message[]; hydrated: boolean; uiReady: boolean };
  flush: () => Promise<void>;
  findLatestActivity?: (chatIds: string[]) => Promise<ReadonlyMap<string, number>>;
  writeText: (text: string) => Promise<void>;
}): Promise<number> {
  const initial = deps.getState();
  if (!initial.hydrated || !initial.uiReady) throw new Error("Not ready");
  if (!Number.isFinite(cutoffMs)) throw new Error("Invalid cutoff");
  await deps.flush();
  const candidates = folderPhoneCandidates(deps.getState(), folderId);
  const chatIds = [...new Set(candidates.flatMap(candidate => candidate.chats.map(chat => chat.id)))];
  const stored = await deps.findLatestActivity?.(chatIds);
  const current = deps.getState();
  if (!current.hydrated || !current.uiReady || JSON.stringify(folderPhoneCandidates(current, folderId)) !== JSON.stringify(candidates)) throw new Error("Folder changed");
  const phones = inactiveFolderPhones(candidates, current.chats, current.messages, cutoffMs, includeNeverContacted, stored);
  if (phones.length) await deps.writeText(phones.join("\n"));
  return phones.length;
}
