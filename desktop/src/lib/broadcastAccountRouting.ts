import { firstContactHistory } from "./aiOutreachAllocation.ts";
import { recipientKey } from "./scheduledPlans.ts";
import { BROADCAST_HARD_CAP } from "../types/broadcast.ts";
import type { OutreachState } from "./aiOutreachContext.ts";

export function routeBroadcastAccounts(
  state: Pick<OutreachState, "chats" | "contacts" | "messages">,
  phones: readonly string[],
  defaultAccount: string,
  quotas?: Record<string, number>,
) {
  const { keys, known, unknown } = firstContactHistory(state);
  const unresolved = new Set<string>();
  for (const message of state.messages) {
    if (message.direction !== "out" || ["sent","server","delivered","read","played"].includes(message.deliveryStatus || "") ||
        !(message.deliveryUncertain || message.deliveryStatus === "pending" || message.deliveryStatus === "queued")) continue;
    const key = keys.get(message.chatId) || (message.phoneE164 && recipientKey("", message.phoneE164));
    if (key) unresolved.add(key);
  }
  const accountByPhone: Record<string, string> = {};
  const remaining = Object.entries(quotas || {}).filter(([, count]) => Number.isInteger(count) && count > 0 && count <= BROADCAST_HARD_CAP);
  let contacted = 0;
  let unassigned = 0;
  let unclear = 0;
  for (const phone of [...new Set(phones)].sort()) {
    const key = recipientKey("", phone);
    if (unresolved.has(key)) {
      unclear++;
      continue;
    }
    const original = known.get(key)?.accountId;
    if (original) {
      accountByPhone[phone] = original;
      contacted++;
    } else if (known.has(key) || unknown.has(key)) {
      unclear++;
    } else if (!quotas) {
      accountByPhone[phone] = defaultAccount;
    } else {
      const slot = remaining.find(([, count]) => count > 0);
      if (!slot) unassigned++;
      else {
        accountByPhone[phone] = slot[0];
        slot[1]--;
      }
    }
  }
  return {accountByPhone, contacted, unassigned, unclear};
}
