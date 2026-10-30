import type { ScheduledMessage } from "../types/crm";

export const SCHEDULED_SEND_GRACE_MS = 15 * 60_000;
export function scheduledMessageExpired(task: Pick<ScheduledMessage, "dueAt" | "status">, now = Date.now()): boolean {
  return task.status === "expired" || !Number.isFinite(Date.parse(task.dueAt)) || now - Date.parse(task.dueAt) > SCHEDULED_SEND_GRACE_MS;
}
