import type { Message } from "@/types/crm";

/** 按会话比较行引用，回执/编辑只替换受影响的 bucket。 */
export function updateMessageIndex(messages: Message[], previous: Record<string, Message[]>): Record<string, Message[]> {
  const positions = new Map<string, number>();
  const changed = new Map<string, Message[]>();
  for (const message of messages) {
    if (!message.chatId) continue;
    const id = message.chatId;
    const position = positions.get(id) || 0;
    const old = Object.hasOwn(previous, id) ? previous[id] : [];
    let bucket = changed.get(id);
    if (!bucket && old[position] !== message) {
      bucket = old.slice(0, position);
      changed.set(id, bucket);
    }
    bucket?.push(message);
    positions.set(id, position + 1);
  }
  for (const [id, bucket] of Object.entries(previous)) {
    const length = positions.get(id) || 0;
    if (!changed.has(id) && length !== bucket.length) changed.set(id, bucket.slice(0, length));
  }
  if (!changed.size) return previous;
  const next = { ...previous };
  for (const [id, bucket] of changed) {
    if (!bucket.length) delete next[id];
    else Object.defineProperty(next, id, { value: bucket.sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || "")), enumerable: true, configurable: true, writable: true });
  }
  return next;
}
