import type { Message } from "@/types/crm";
import { isHiddenProtocolMessageBody } from "./messageOrdering";

export function cleanHydratedMessages(rawMessages: Message[]) {
  const messages: Message[] = [];
  const outgoingByChatAndBody = new Map<
    string,
    Array<{ message: Message; resultIndex: number }>
  >();
  for (const message of rawMessages) {
    if (isHiddenProtocolMessageBody(message.body)) continue;
    if (/^\[表情\]/.test((message.body || "").trim())) continue;
    if (message.direction !== "out") {
      messages.push(message);
      continue;
    }
    const bucketKey = `${message.chatId}\u0000${message.body ?? ""}`;
    const candidates = outgoingByChatAndBody.get(bucketKey) || [];
    const duplicateIndex = candidates.findIndex(({ message: candidate }) => {
      if (candidate.accountId !== message.accountId) return false;
      if (candidate.body !== message.body) return false;
      if (
        candidate.waMessageId &&
        message.waMessageId &&
        candidate.waMessageId === message.waMessageId
      ) {
        return true;
      }
      if (
        candidate.id === message.id ||
        (candidate.waMessageId && candidate.waMessageId === message.id)
      ) {
        return true;
      }
      if (message.waMessageId && candidate.id === message.waMessageId) return true;
      return false;
    });
    if (duplicateIndex >= 0) {
      const keptRecord = candidates[duplicateIndex]!;
      const kept = keptRecord.message;
      if (
        !kept.waMessageId &&
        (message.waMessageId || !String(message.id).startsWith("msg-"))
      ) {
        const merged: Message = {
          ...kept,
          ...message,
          id: message.waMessageId || message.id,
          waMessageId: message.waMessageId || kept.waMessageId,
          deliveryStatus: "sent",
        };
        messages[keptRecord.resultIndex] = merged;
        keptRecord.message = merged;
      }
      continue;
    }
    messages.push(message);
    candidates.push({ message, resultIndex: messages.length - 1 });
    outgoingByChatAndBody.set(bucketKey, candidates);
  }
  return messages;
}

/** 请求可能已到达 WhatsApp；重启后不能把结果未知的消息自动再发一次。 */
export function recoverInterruptedMessage(message: Message): Message {
  if (message.direction !== "out" || message.deliveryStatus !== "pending" || message.systemKind) {
    return message;
  }
  return {
    ...message,
    deliveryStatus: "failed",
    nextAttemptAt: undefined,
    lastError: "应用重启前发送结果未知，请先在 WhatsApp 核对后再手动重试",
  };
}
