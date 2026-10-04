import type { Message } from "@/types/crm";

/** 兼容旧快照中只有中/英/法错误提示、没有结构化标记的未知结果。 */
export function isDeliveryUncertain(message: Pick<Message, "direction" | "deliveryStatus" | "deliveryUncertain" | "lastError">) {
  if (message.direction !== "out" || !["failed", "queued"].includes(message.deliveryStatus || "")) return false;
  if (message.deliveryUncertain !== undefined) return message.deliveryUncertain;
  return /baileys_delivery_unknown|发送结果未知|send result is unknown|résultat de l[’']envoi est inconnu/i.test(message.lastError || "");
}

/** 限速/冷却是可恢复状态，不应因为自动尝试次数耗尽而变成硬失败。 */
export function isRateLimitedMessage(message: Message) {
  const text = (message.lastError || "").toLowerCase();
  return (
    text.includes("rate_limited") ||
    text.includes("rate limit") ||
    text.includes("cooldown") ||
    text.includes("冷却") ||
    text.includes("限速") ||
    text.includes("发送过快") ||
    text.includes("每分钟上限") ||
    text.includes("每小时上限")
  );
}

export function isRetryableOutgoing(message: Message, now = Date.now()) {
  if (message.direction !== "out") return false;
  if (isDeliveryUncertain(message)) return false;
  if (message.systemKind === "broadcast_campaign") return false;
  if (message.deliveryStatus !== "queued" && message.deliveryStatus !== "failed") return false;
  if (!message.phoneE164 || !message.body) return false;
  if ((message.retryCount ?? 0) >= 5 && !isRateLimitedMessage(message)) return false;
  if (message.deliveryStatus === "failed" && !message.nextAttemptAt) {
    // 硬失败（watcher 清除了计划时间）：只允许手动重试。
    // 否则队列每个 tick 都会把它捞出来重发——对 baileys_delivery_unknown
    // 这类「结果未知」的错误会造成真实重复发送。
    return false;
  }
  return !message.nextAttemptAt || Date.parse(message.nextAttemptAt) <= now;
}
