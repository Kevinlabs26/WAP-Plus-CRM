export type SyncIndexMessage = {
  id: string;
  accountId?: string;
  deviceId?: string | null;
  body?: string;
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
  const owner = message.accountId || message.deviceId;
  if (owner && owner !== accountId) return false;
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
  repeatedAliases: Map<string, number[]>;
  inboundByChat: Map<string, number[]>;
  unboundOutgoingByBody: Map<string, Set<number>>;
};

export function rememberMessageAlias<T extends SyncIndexMessage>(
  index: MessageSyncIndex<T>, accountId: string | undefined, alias: string | undefined, position: number,
) {
  if (!alias) return;
  const last = index.byId.get(alias);
  if (last !== undefined && last !== position) {
    const positions = index.repeatedAliases.get(alias);
    if (!positions) index.repeatedAliases.set(alias, [last, position]);
    else if (!positions.includes(position)) positions.push(position);
  }
  setMessageIndexAlias(index.byId, accountId, alias, position);
}

export function messageAliasCandidates<T extends SyncIndexMessage>(index: MessageSyncIndex<T>, alias: string): readonly number[] {
  const last = index.byId.get(alias);
  return index.repeatedAliases.get(alias) ?? (last === undefined ? [] : [last]);
}

export function normalizeMessageBody(body?: string): string {
  return (body || "").replace(/\s+/g, " ").trim();
}

function unboundOutgoingBody(message: SyncIndexMessage): string | undefined {
  if (message.direction === "out" && !message.waMessageId && !message.waKey?.id && String(message.id).startsWith("msg-")) {
    return normalizeMessageBody(message.body);
  }
}

export function indexSyncedMessage<T extends SyncIndexMessage>(index: MessageSyncIndex<T>, message: T, position: number, previous?: T) {
  const owner = message.accountId || message.deviceId || undefined;
  rememberMessageAlias(index, owner, message.id, position);
  rememberMessageAlias(index, owner, message.waMessageId, position);
  rememberMessageAlias(index, owner, message.waKey?.id, position);

  const before = previous && unboundOutgoingBody(previous);
  const after = unboundOutgoingBody(message);
  if (before !== after) {
    if (before !== undefined) {
      const positions = index.unboundOutgoingByBody.get(before);
      positions?.delete(position);
      if (positions && !positions.size) index.unboundOutgoingByBody.delete(before);
    }
    if (after !== undefined) {
      const positions = index.unboundOutgoingByBody.get(after) ?? new Set<number>();
      positions.add(position);
      index.unboundOutgoingByBody.set(after, positions);
    }
  }
  if (!previous && message.direction === "in" && message.chatId) {
    const positions = index.inboundByChat.get(message.chatId);
    if (positions) positions.push(position);
    else index.inboundByChat.set(message.chatId, [position]);
  }
}

export function createMessageSyncIndex<T extends SyncIndexMessage>(
  messages: T[]
): MessageSyncIndex<T> {
  const index: MessageSyncIndex<T> = {
    source: messages, byId: new Map(), repeatedAliases: new Map(), inboundByChat: new Map(), unboundOutgoingByBody: new Map(),
  };
  for (let position = 0; position < messages.length; position++) {
    indexSyncedMessage(index, messages[position]!, position);
  }
  return index;
}

export function reuseMessageSyncIndex<T extends SyncIndexMessage>(
  cached: MessageSyncIndex<T> | null,
  source: T[]
): MessageSyncIndex<T> {
  return cached?.source === source ? cached : createMessageSyncIndex(source);
}
