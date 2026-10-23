import type { ChatPreview, Message } from "@/types/crm";

/** One entry per unread thread, independent of account and folder visibility. */
export function buildMessageInbox(chats: ChatPreview[], messagesByChatId: Record<string, Message[]>) {
  return chats.filter((chat) => chat.unread > 0 && !chat.localOnly).map((chat) => {
    let latest: Message | undefined;
    for (const message of messagesByChatId[chat.id] || []) {
      if (message.direction !== "in" || message.systemKind || message.mediaType === "system") continue;
      if (!Number.isFinite(Date.parse(message.sentAt))) continue;
      if (!latest || Date.parse(message.sentAt) >= Date.parse(latest.sentAt)) latest = message;
    }
    // Loaded history can be older than the persisted preview.
    const usePreview = chat.lastMessageDirection !== "out" &&
      (!latest || Date.parse(chat.updatedAt) > Date.parse(latest.sentAt));
    return {
      chat,
      message: usePreview ? undefined : latest,
      sentAt: usePreview ? chat.updatedAt : latest?.sentAt || "",
      body: usePreview ? chat.lastMessage : latest?.body || latest?.mediaCaption || "",
    };
  }).sort((a, b) => (Date.parse(b.sentAt) || 0) - (Date.parse(a.sentAt) || 0) || a.chat.id.localeCompare(b.chat.id));
}

export function inboxRelativeTime(sentAt: string, now: number, locale: string): string | null {
  const timestamp = Date.parse(sentAt);
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return "";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (minutes < 60) return format.format(-minutes, "minute");
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), "hour");
  return format.format(-Math.floor(minutes / 1440), "day");
}
