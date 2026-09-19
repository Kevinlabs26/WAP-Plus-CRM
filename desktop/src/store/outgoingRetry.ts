import type { Message } from "@/types/crm";

export function isRetryableOutgoing(message: Message, now = Date.now()) {
  if (message.direction !== "out") return false;
  if (message.systemKind === "broadcast_campaign") return false;
  if (message.deliveryStatus !== "queued" && message.deliveryStatus !== "failed") return false;
  if (!message.phoneE164 || !message.body) return false;
  if ((message.retryCount ?? 0) >= 5) return false;
  if (message.deliveryStatus === "failed" && !message.nextAttemptAt) {
    // 硬失败（watcher 清除了计划时间）：只允许手动重试。
    // 否则队列每个 tick 都会把它捞出来重发——对 baileys_delivery_unknown
    // 这类「结果未知」的错误会造成真实重复发送。
    return false;
  }
  return !message.nextAttemptAt || Date.parse(message.nextAttemptAt) <= now;
}
