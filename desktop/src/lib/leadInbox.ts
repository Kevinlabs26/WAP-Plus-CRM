import type { ChatPreview, Contact, Message } from "@/types/crm";
import type { LeadInboxSettings } from "@/store/settingsDefaults";
import { buildPersonKey } from "./utils.ts";

export interface LeadCandidate {
  chatId: string;
  firstInboundAt: string;
  lastMessageAt: string;
  accountId: string;
}

export function earliestConversationMessage(
  current: ChatPreview["firstConversationMessage"],
  message: Pick<Message, "direction" | "sentAt" | "mediaType" | "systemKind" | "deliveryStatus" | "deliveryUncertain">
) {
  const outgoing = isConversationOutgoing(message) && message.deliveryStatus !== "local" && !message.deliveryUncertain;
  if (message.mediaType === "system" || !(outgoing || message.direction === "in" && !message.systemKind)) return current;
  const at = Date.parse(message.sentAt);
  if (!Number.isFinite(at)) return current;
  const previous = Date.parse(current?.at || "");
  return !Number.isFinite(previous) || at < previous || at === previous && outgoing && current?.direction === "in"
    ? { at: new Date(at).toISOString(), direction: message.direction } : current;
}

function firstConversationForChat(chat: ChatPreview, messages: Message[], accountId: string) {
  let first = chat.firstConversationMessage;
  for (const message of messages) {
    const owner = message.accountId || message.deviceId;
    if (message.chatId !== chat.id || owner && owner !== accountId) continue;
    first = earliestConversationMessage(first, message);
  }
  return first;
}

export function isConversationOutgoing(
  message: Pick<Message, "direction" | "mediaType" | "deliveryStatus">
) {
  return (
    message.direction === "out" &&
    message.mediaType !== "system" &&
    message.deliveryStatus !== "pending" &&
    message.deliveryStatus !== "queued" &&
    message.deliveryStatus !== "failed"
  );
}

export function leadCandidateForChat(
  chat: ChatPreview,
  contact: Contact | undefined,
  messages: Message[],
  settings: LeadInboxSettings,
  accountId: string
): LeadCandidate | null {
  if (!settings.enabled || chat.localOnly) return null;
  if (!settings.includeGroups && (chat.isGroup || contact?.isGroup)) return null;

  const history = messages.filter(message => {
    const owner = message.accountId || message.deviceId;
    return message.chatId === chat.id && (!owner || owner === accountId);
  });
  if (
    settings.removeAfterReply &&
    (chat.hasOutgoingHistory || history.some(isConversationOutgoing))
  ) {
    return null;
  }
  const first = firstConversationForChat(chat, history, accountId);
  if (!first || first.direction !== "in") return null;

  const captureSince = Date.parse(settings.captureSince || "");
  const firstAt = Date.parse(first.at);
  if (Number.isFinite(captureSince) && Number.isFinite(firstAt) && firstAt < captureSince) {
    return null;
  }

  const lastAt = history.reduce((last, message) => Date.parse(message.sentAt) > Date.parse(last) ? message.sentAt : last, chat.updatedAt || first.at);
  return {
    chatId: chat.id,
    firstInboundAt: first.at,
    lastMessageAt: lastAt,
    accountId,
  };
}

/** 先核对全部账号的历史，再由调用方筛选显示范围。 */
export function leadCandidatesForChats(
  chats: ChatPreview[],
  contactById: ReadonlyMap<string, Contact>,
  messagesByChatId: Readonly<Record<string, Message[]>>,
  settings: LeadInboxSettings,
  fallbackAccountId: string
) {
  const candidates = new Map<string, LeadCandidate>();
  if (!settings.enabled) return candidates;
  const people = new Map<string, { chatId: string; first: ChatPreview["firstConversationMessage"]; unknown: boolean; replied: boolean }>();
  const personByChat = new Map<string, string>();
  for (const chat of chats) {
    const contact = contactById.get(chat.contactId);
    if (chat.localOnly || !settings.includeGroups && (chat.isGroup || contact?.isGroup)) continue;
    const key = buildPersonKey({ phone: contact?.phone, channelAddress: contact?.channelAddress, isGroup: chat.isGroup || contact?.isGroup }) || contact?.personKey || chat.contactId || chat.id;
    personByChat.set(chat.id, key);
    const accountId = chat.accountId || contact?.accountId || chat.phoneId || fallbackAccountId;
    const messages = messagesByChatId[chat.id] || [];
    const first = firstConversationForChat(chat, messages, accountId);
    const previous = people.get(key);
    const earlier = first && (!previous?.first || Date.parse(first.at) < Date.parse(previous.first.at) ||
      Date.parse(first.at) === Date.parse(previous.first.at) && (first.direction === "out" && previous.first.direction === "in" || first.direction === previous.first.direction && chat.id < previous.chatId));
    people.set(key, {
      chatId: earlier ? chat.id : previous?.chatId || chat.id,
      first: earlier ? first : previous?.first,
      unknown: !!previous?.unknown || !first && !!(chat.hasMessageHistory || chat.hasOutgoingHistory || chat.lastSuccessfulOutgoing),
      replied: !!previous?.replied || !!chat.hasOutgoingHistory || messages.some(message =>
        message.chatId === chat.id && (!(message.accountId || message.deviceId) || (message.accountId || message.deviceId) === accountId) && isConversationOutgoing(message)),
    });
  }
  for (const chat of chats) {
    const person = people.get(personByChat.get(chat.id) || "");
    if (!person || person.unknown || person.first?.direction !== "in" || person.chatId !== chat.id || settings.removeAfterReply && person.replied) continue;
    const contact = contactById.get(chat.contactId);
    const candidate = leadCandidateForChat(chat, contact, messagesByChatId[chat.id] || [], settings,
      chat.accountId || contact?.accountId || chat.phoneId || fallbackAccountId);
    if (candidate) candidates.set(chat.id, candidate);
  }
  return candidates;
}

export function leadDateBucket(iso: string, grouping: LeadInboxSettings["dateGrouping"]): string {
  if (grouping === "none") return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  if (grouping === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  if (grouping === "week") {
    const monday = new Date(date);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function leadDateLabel(
  bucket: string,
  grouping: LeadInboxSettings["dateGrouping"],
  locale: string
) {
  if (!bucket || grouping === "none") return "";
  const date = new Date(`${bucket}${grouping === "month" ? "-01" : "T12:00:00"}`);
  if (!Number.isFinite(date.getTime())) return bucket;
  if (grouping === "month") {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(date);
  }
  if (grouping === "week") {
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}
