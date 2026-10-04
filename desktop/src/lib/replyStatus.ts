import type { ChatPreview } from "@/types/crm";

/** Read/unread is independent of whether the last customer message was handled. */
export function isAwaitingReply(chat: ChatPreview, direction = chat.lastMessageDirection): boolean {
  if (chat.localOnly || chat.archived) return false;
  if (chat.replyPendingSince !== undefined ? !chat.replyPendingSince : direction !== "in") return false;
  const handled = Date.parse(chat.replyHandledAt || "");
  const updated = Date.parse(chat.replyPendingSince || chat.updatedAt || "");
  return !Number.isFinite(handled) || !Number.isFinite(updated) || updated > handled;
}
