export const MESSAGE_VIRTUAL_INDEX_BASE = 1_000_000;

export type MessageVirtualAnchor = {
  chatId: string | null;
  messageId: string | null;
  virtualIndex?: number;
};

export function resolveMessageFirstItemIndex(
  anchor: MessageVirtualAnchor,
  chatId: string | null,
  messages: ReadonlyArray<{ id: string }>
): number {
  if (anchor.chatId !== chatId) {
    anchor.chatId = chatId;
    anchor.messageId = messages[0]?.id ?? null;
    anchor.virtualIndex = MESSAGE_VIRTUAL_INDEX_BASE;
  } else if (!anchor.messageId && messages.length) {
    anchor.messageId = messages[0]!.id;
    anchor.virtualIndex = MESSAGE_VIRTUAL_INDEX_BASE;
  }

  let anchorIndex = anchor.messageId
    ? messages.findIndex((message) => message.id === anchor.messageId)
    : 0;
  if (anchorIndex < 0) {
    anchor.messageId = messages[0]?.id ?? null;
    anchor.virtualIndex = MESSAGE_VIRTUAL_INDEX_BASE;
    anchorIndex = 0;
  }
  return (anchor.virtualIndex ?? MESSAGE_VIRTUAL_INDEX_BASE) - anchorIndex;
}
