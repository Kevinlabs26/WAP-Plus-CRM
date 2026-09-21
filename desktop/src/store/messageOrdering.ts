import type { Message } from "@/types/crm";

const HIDDEN_PROTOCOL_BODIES = new Set([
  "[secretEncrypted]",
  // WhatsApp 置顶/取消置顶是协议动作，不产生会话气泡；桥接误当正文推来，直接丢弃
  "[pinInChat]",
  "[unpinInChat]",
]);

export function isHiddenProtocolMessageBody(body?: string): boolean {
  return HIDDEN_PROTOCOL_BODIES.has((body || "").trim());
}

/** 按消息时间合并去重；保持全局数组和按会话索引的顺序一致。 */
export function mergeMessagesByTime(
  existing: Message[],
  incoming: Message[]
): Message[] {
  const kept = existing.filter(
    (message) => !isHiddenProtocolMessageBody(message.body)
  );
  const added = incoming.filter(
    (message) => !isHiddenProtocolMessageBody(message.body)
  );
  if (!added.length) return kept.length === existing.length ? existing : kept;
  const seen = new Set<string>();
  const addIdentity = (message: Message) => {
    const owner = message.accountId || message.deviceId || "";
    for (const value of [
      message.id,
      message.waMessageId,
      message.waKey?.id,
    ]) {
      if (value) seen.add(`${owner}\u0000${value}`);
    }
  };
  kept.forEach(addIdentity);
  const unique = added.filter((message) => {
    const owner = message.accountId || message.deviceId || "";
    const identities = [message.id, message.waMessageId, message.waKey?.id]
      .filter(Boolean)
      .map((value) => `${owner}\u0000${value}`);
    if (identities.some((value) => seen.has(value))) return false;
    identities.forEach((value) => seen.add(value));
    return true;
  });
  if (!unique.length) return kept.length === existing.length ? existing : kept;
  unique.sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));

  const merged: Message[] = [];
  let left = 0;
  let right = 0;
  while (left < kept.length && right < unique.length) {
    if ((kept[left]!.sentAt || "") <= (unique[right]!.sentAt || "")) {
      merged.push(kept[left++]!);
    } else {
      merged.push(unique[right++]!);
    }
  }
  if (left < kept.length) merged.push(...kept.slice(left));
  if (right < unique.length) merged.push(...unique.slice(right));
  return merged;
}
