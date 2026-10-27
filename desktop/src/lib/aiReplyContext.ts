import type { AppState } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { getSuggestionContextKey, hasRealAiKey } from "@/lib/aiSuggest";
import { isManualSuggestionContext } from "@/lib/aiSuggestionCache";

export async function hashAiReplyContext(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** 队列和首次发送使用同一份上下文；仅把摘要落库，不复制聊天内容或密钥。 */
export function currentAutoReplyContext(
  state: Pick<AppState, "settings" | "contacts" | "chats" | "messages" | "messagesByChatId">,
  reply: Pick<Message, "id" | "chatId" | "contactId" | "accountId" | "channelId">
): string | null {
  const contact = state.contacts.find(item => item.id === reply.contactId);
  const chat = state.chats.find(item => item.id === reply.chatId);
  if (!contact || !chat || chat.localOnly || !reply.accountId ||
      state.settings.sendChannel !== reply.channelId || !hasRealAiKey(state.settings) ||
      (chat.accountId || contact.accountId || state.settings.liveBaileysAccountId || state.settings.activeAccountId) !== reply.accountId) return null;
  const context = (state.messagesByChatId?.[reply.chatId] || state.messages)
    .filter(item => item.chatId === reply.chatId && item.id !== reply.id);
  if (isManualSuggestionContext(getSuggestionContextKey(contact, context, state.settings, reply.accountId))) return null;
  return getSuggestionContextKey(contact, context, state.settings, reply.accountId, { auto: true });
}
