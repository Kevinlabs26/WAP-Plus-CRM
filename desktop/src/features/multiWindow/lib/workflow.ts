import type { ChatPreview, Message } from "@/types/crm";
import { isAwaitingReply } from "../../../lib/replyStatus.ts";

// Open windows belong to the user; live queue changes must never dismiss them.
export function retainOpenWindows(ids: string[], available: ReadonlySet<string>) {
  return ids.filter(id => available.has(id));
}

export function replaceWindowSlot(ids: string[], from: string, to: string) {
  if (from === to || !ids.includes(from)) return ids;
  const alreadyOpen = ids.includes(to);
  return ids.map(id => id === from ? to : alreadyOpen && id === to ? from : id);
}

export function undoWindowSlot(ids: string[], from: string, to: string, index: number, previousNextIndex: number) {
  if (from === to) return ids;
  if (previousNextIndex >= 0 && ids.includes(from) && ids.includes(to)) return replaceWindowSlot(ids, to, from);
  const result = ids.includes(from) ? [...ids] : ids.includes(to)
    ? ids.map(id => id === to ? from : id)
    : [...ids.slice(0, index), from, ...ids.slice(index)];
  if (previousNextIndex >= 0 && !result.includes(to)) result.splice(previousNextIndex, 0, to);
  return result;
}

export function windowWorkStatus(chat: ChatPreview, direction?: Message["direction"]) {
  const latestDirection = chat.lastMessageDirection || direction;
  if (isAwaitingReply(chat, latestDirection)) return "pending";
  if (Date.parse(chat.replyHandledAt || "") >= Date.parse(chat.replyPendingSince || chat.updatedAt || "")) return "done";
  return latestDirection === "out" ? "waiting" : "idle";
}
