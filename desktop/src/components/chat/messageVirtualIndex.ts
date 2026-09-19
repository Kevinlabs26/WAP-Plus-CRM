export const MESSAGE_VIRTUAL_INDEX_BASE = 1_000_000;

export type MessageVirtualAnchor = {
  chatId: string | null;
  messageId: string | null;
};

export function resolveMessageFirstItemIndex(
  anchor: MessageVirtualAnchor,
  chatId: string | null,
  messages: ReadonlyArray<{ id: string }>
): number {
  if (anchor.chatId !== chatId) {
    anchor.chatId = chatId;
    anchor.messageId = messages[0]?.id ?? null;
  } else if (!anchor.messageId && messages.length) {
    anchor.messageId = messages[0]!.id;
  }

  let anchorIndex = anchor.messageId
    ? messages.findIndex((message) => message.id === anchor.messageId)
    : 0;
  if (anchorIndex < 0) {
    anchor.messageId = messages[0]?.id ?? null;
    anchorIndex = 0;
  }
  return MESSAGE_VIRTUAL_INDEX_BASE - anchorIndex;
}
