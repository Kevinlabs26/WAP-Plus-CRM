export type SyncIndexMessage = {
  id: string;
  accountId?: string;
  waMessageId?: string;
  waKey?: { id?: string };
  direction: "in" | "out";
  chatId: string;
};

export function accountMessageIndexKey(accountId: string, id: string) {
  return `${accountId}\0${id}`;
}

export function messageMatchesAccountAlias(
  message: SyncIndexMessage,
  accountId: string,
  id: string
): boolean {
  if (message.accountId && message.accountId !== accountId) return false;
  return (
    message.id === id ||
    message.waMessageId === id ||
    message.waKey?.id === id
  );
}

export function setMessageIndexAlias(
  index: Map<string, number>,
  accountId: string | undefined,
  id: string | undefined,
  messageIndex: number
) {
  if (!id) return;
  index.set(id, messageIndex);
  if (accountId) {
    index.set(accountMessageIndexKey(accountId, id), messageIndex);
  }
}

export type MessageSyncIndex<T extends SyncIndexMessage> = {
  source: T[];
  byId: Map<string, number>;
  inboundByChat: Map<string, number[]>;
};

export function createMessageSyncIndex<T extends SyncIndexMessage>(
  messages: T[]
): MessageSyncIndex<T> {
  const byId = new Map<string, number>();
  const inboundByChat = new Map<string, number[]>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    setMessageIndexAlias(byId, message.accountId, message.id, index);
    setMessageIndexAlias(byId, message.accountId, message.waMessageId, index);
    setMessageIndexAlias(byId, message.accountId, message.waKey?.id, index);
    if (message.direction !== "in" || !message.chatId) continue;
    const rows = inboundByChat.get(message.chatId);
    if (rows) rows.push(index);
    else inboundByChat.set(message.chatId, [index]);
  }
  return { source: messages, byId, inboundByChat };
}

export function reuseMessageSyncIndex<T extends SyncIndexMessage>(
  cached: MessageSyncIndex<T> | null,
  source: T[]
): MessageSyncIndex<T> {
  return cached?.source === source ? cached : createMessageSyncIndex(source);
}
