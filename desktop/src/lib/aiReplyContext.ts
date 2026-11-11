import { resolveAutoReplyScope } from "./autoReplyScope";
import type { AppState } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { getSuggestionContextKey, hasRealAiKey } from "@/lib/aiSuggest";
import { isManualSuggestionContext, SUGGESTION_MAX_AGE_MS } from "@/lib/aiSuggestionCache";
import { getAiOutputConstraintError } from "./aiReplyConstraints";

export async function hashAiReplyContext(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** 队列和首次发送使用同一份上下文；仅把摘要落库，不复制聊天内容或密钥。 */
export function inspectAutoReplyContext(
  state: Pick<AppState, "settings" | "contacts" | "chats" | "messages" | "messagesByChatId">,
  reply: Pick<Message, "id" | "chatId" | "contactId" | "accountId" | "channelId"> & Partial<Pick<Message, "sentAt"|"body">>
): {key:string|null;error:string} {
  if (reply.id) {
    const constraint=reply.body&&getAiOutputConstraintError(state.settings,reply.accountId,reply.chatId,reply.body);
    if(constraint)return {key:null,error:constraint};
    const queuedAt = Date.parse(reply.sentAt || "");
    if (!Number.isFinite(queuedAt) || Date.now() < queuedAt) return {key:null,error:"消息时间无效或系统时间已回退，请重新生成"};
    if (Date.now() - queuedAt >= SUGGESTION_MAX_AGE_MS) return {key:null,error:"自动回复已排队超过 5 分钟，请根据最新聊天重新生成"};
  }
  if (resolveAutoReplyScope(state.settings, reply.chatId).mode !== "auto") return {key:null,error:"此会话已暂停自动回复或切换为人工模式"};
  const contact = state.contacts.find(item => item.id === reply.contactId);
  const chat = state.chats.find(item => item.id === reply.chatId);
  if (!contact || !chat || contact.isGroup || chat.isGroup || chat.localOnly || !reply.accountId ||
      state.settings.sendChannel !== reply.channelId || !hasRealAiKey(state.settings) ||
      (chat.accountId || contact.accountId || state.settings.liveBaileysAccountId || state.settings.activeAccountId) !== reply.accountId) return {key:null,error:"发送账号、渠道、联系人或 AI 配置已变化或不可用，请检查设置后重新生成"};
  const context = (state.messagesByChatId?.[reply.chatId] || state.messages)
    .filter(item => item.chatId === reply.chatId && item.id !== reply.id);
  if (isManualSuggestionContext(getSuggestionContextKey(contact, context, state.settings, reply.accountId))) return {key:null,error:"当前聊天内容需要人工处理"};
  return {key:getSuggestionContextKey(contact, context, state.settings, reply.accountId, { auto: true }),error:""};
}

export function currentAutoReplyContext(...args:Parameters<typeof inspectAutoReplyContext>):string|null {
  return inspectAutoReplyContext(...args).key;
}
