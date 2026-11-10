import type { Message } from "@/types/crm";

const retainedByTask = new Map<string, Set<string>>();
const viewports = new Map<string, {
  chatId: string | null;
  visibleIds: Set<string>;
  atBottom: boolean;
}>();

const RECENT_PER_RETAINED_CHAT = 1_200;
const RECENT_PER_SELECTED_CHAT = 2_000;

export function retainMessageChats(view: string, chatIds: string[]) {
  if (chatIds.length) retainedByTask.set(view, new Set(chatIds));
  else retainedByTask.delete(view);
}

export function retainMessageViewport(view: string, chatId: string | null, visibleIds: string[], atBottom: boolean) {
  if (!chatId) {
    viewports.delete(view);
    return;
  }
  viewports.set(view, { chatId, visibleIds: new Set(visibleIds), atBottom });
}

export function trimMessageMemory(messages: Message[], selectedChatId: string | null, recentLimit = 20_000): Message[] {
  const retainedChats = new Set([...retainedByTask.values()].flatMap(ids => [...ids]));
  const readingChats = new Set([...viewports.values()].filter(view => !view.atBottom).map(view => view.chatId));
  const visibleIds = new Set([...viewports.values()].flatMap(view => [...view.visibleIds]));
  // shortcut: Keep a reader's loaded chat while scrolled up; viewport-window eviction can replace this if very long reads still cause pressure.
  const chatsToKeepRecent = new Set([...retainedChats, ...(selectedChatId ? [selectedChatId] : [])]);
  const perChatCounts = new Map<string, number>();
  const perChatLimit = new Map([...retainedChats].map(chatId => [chatId, RECENT_PER_RETAINED_CHAT]));
  if (selectedChatId) perChatLimit.set(selectedChatId, RECENT_PER_SELECTED_CHAT);

  const newestFirst = [...messages].sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
  const recent = new Set(newestFirst.slice(0, recentLimit).map(message => message.id));
  const retainedRecent = new Set<string>();
  for (const message of newestFirst) {
    if (!chatsToKeepRecent.has(message.chatId)) continue;
    const count = perChatCounts.get(message.chatId) || 0;
    if (count < (perChatLimit.get(message.chatId) || 0)) {
      retainedRecent.add(message.id);
      perChatCounts.set(message.chatId, count + 1);
    }
  }

  const dayAgo = Date.now() - 86400_000;
  return messages.filter(message => recent.has(message.id) || retainedRecent.has(message.id) || visibleIds.has(message.id) ||
    readingChats.has(message.chatId) || message.chatId === "bridge-chat-saved-messages" || message.starred || message.channelId === "local" ||
    message.direction === "out" && (Date.parse(message.sentAt) >= dayAgo || ["pending", "queued"].includes(message.deliveryStatus || "") ||
      message.deliveryUncertain || Boolean(message.nextAttemptAt)));
}
