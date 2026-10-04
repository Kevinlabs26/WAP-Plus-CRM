export function setChatDraftValue(
  drafts: Record<string, string>,
  chatId: string | null | undefined,
  text: string
): Record<string, string> {
  if (!chatId) return drafts;
  if (text) {
    return drafts[chatId] === text ? drafts : { ...drafts, [chatId]: text };
  }
  if (!(chatId in drafts)) return drafts;
  const next = { ...drafts };
  delete next[chatId];
  return next;
}

export const getChatDraftValue = (
  drafts: Record<string, string>,
  chatId: string | null | undefined
) => (chatId ? drafts[chatId] || "" : "");

/** 仅恢复仍存在会话的文字；不把备份或旧无效字段当作草稿。 */
export function restoreChatDrafts(value: unknown, chats: { id: string }[]): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const ids = new Set(chats.map(chat => chat.id));
  return Object.fromEntries(Object.entries(value).filter(([id, text]) =>
    ids.has(id) && typeof text === "string" && text.length > 0 && text.length <= 65_536
  ));
}

export function assertChatDraftCapacity(drafts: Record<string, string>) {
  if (Object.keys(drafts).length > 1000 || Object.values(drafts).some(text => typeof text !== "string" || text.length > 65_536)
    || new Blob([JSON.stringify(drafts)]).size > 2 * 1024 * 1024) {
    throw new Error("草稿未保存：单条最多 65,536 字符，最多 1,000 条、总量 2 MiB；请复制保留后缩短或清理草稿");
  }
}

/** 完成旧发送时只清理原会话未改动的草稿；liveDraft 可包含尚未写回 store 的输入。 */
export function clearSentChatDraft(
  state: { selectedChatId: string | null; draftReply: string; draftReplyByChatId: Record<string, string>; setChatDraft: (chatId: string, text: string) => void },
  chatId: string | null | undefined,
  sentDraft: string,
  liveDraft?: string
) {
  if (!chatId) return;
  const current = liveDraft ?? (state.selectedChatId === chatId ? state.draftReply : getChatDraftValue(state.draftReplyByChatId, chatId));
  if (current.trim() === sentDraft.trim()) state.setChatDraft(chatId, "");
}
