import type { Message } from "@/types/crm";
import { compareMessageOrder } from "./messageOrdering.ts";

const sources = new WeakMap<Record<string, Message[]>, Message[]>();

/** 按会话比较行引用，回执/编辑只替换受影响的 bucket。 */
export function updateMessageIndex(messages: Message[], previous: Record<string, Message[]>): Record<string, Message[]> {
  const source = sources.get(previous);
  if (source) {
    let start = 0;
    while (start < source.length && start < messages.length && source[start] === messages[start]) start++;
    if (start === source.length && start === messages.length) { sources.set(previous, messages); return previous; }
    let end = messages.length;
    if (source.length === messages.length) while (end > start && source[end - 1] === messages[end - 1]) end--;
    const append = start === source.length;
    const patch = source.length === messages.length && end - start <= 128 && messages.slice(start, end).every((row, i) => {
      const old = source[start + i]!;
      return row.id === old.id && row.chatId === old.chatId && compareMessageOrder(row, old) === 0;
    });
    if (append || patch) {
      const replacements = new Map<Message, Message>();
      const changedChats = new Set<string>();
      const additions = new Map<string, Message[]>();
      for (let i = start; i < end; i++) {
        if (!messages[i]!.chatId) continue;
        changedChats.add(messages[i]!.chatId);
        if (patch) replacements.set(source[i]!, messages[i]!);
        else {
          const bucket = additions.get(messages[i]!.chatId) || [];
          bucket.push(messages[i]!);
          additions.set(messages[i]!.chatId, bucket);
        }
      }
      const next = { ...previous };
      for (const chatId of changedChats) {
        const old = Object.hasOwn(previous, chatId) ? previous[chatId]! : [];
        const bucket = patch ? old.map(row => replacements.get(row) || row)
          : [...old, ...(additions.get(chatId) || [])].sort(compareMessageOrder);
        Object.defineProperty(next, chatId, { value: bucket, enumerable: true, configurable: true, writable: true });
      }
      sources.set(next, messages);
      return next;
    }
  }
  const next = rebuildMessageIndex(messages, previous);
  sources.set(next, messages);
  return next;
}

function rebuildMessageIndex(messages: Message[], previous: Record<string, Message[]>): Record<string, Message[]> {
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
  let next = previous;
  for (const [id, bucket] of changed) {
    bucket.sort(compareMessageOrder);
    const old = Object.hasOwn(previous, id) ? previous[id] : undefined;
    if (old?.length === bucket.length && bucket.every((message, index) => message === old[index])) continue;
    if (next === previous) next = { ...previous };
    if (!bucket.length) delete next[id];
    else Object.defineProperty(next, id, { value: bucket, enumerable: true, configurable: true, writable: true });
  }
  return next;
}
