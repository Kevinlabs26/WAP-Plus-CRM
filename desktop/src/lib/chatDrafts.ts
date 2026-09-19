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
