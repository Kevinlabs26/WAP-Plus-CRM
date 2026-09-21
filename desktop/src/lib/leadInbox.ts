import type { ChatPreview, Contact, Message } from "@/types/crm";
import type { LeadInboxSettings } from "@/store/settingsDefaults";

export interface LeadCandidate {
  chatId: string;
  firstInboundAt: string;
  lastMessageAt: string;
  accountId: string;
}

function meaningfulMessages(messages: Message[]) {
  return messages
    .filter((message) => message.mediaType !== "system")
    .slice()
    .sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
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

  const history = meaningfulMessages(messages);
  if (chat.hasOutgoingHistory || history.some(isConversationOutgoing)) return null;
  const first = history.find((message) => message.direction === "in");
  if (!first) return null;

  const captureSince = Date.parse(settings.captureSince || "");
  const firstAt = Date.parse(first.sentAt || "");
  if (Number.isFinite(captureSince) && Number.isFinite(firstAt) && firstAt < captureSince) {
    return null;
  }

  const last = history[history.length - 1];
  return {
    chatId: chat.id,
    firstInboundAt: first.sentAt,
    lastMessageAt: last?.sentAt || first.sentAt,
    accountId,
  };
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
