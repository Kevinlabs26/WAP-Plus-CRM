import type { AppSettings } from "@/store/appStore";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { resolveAutoReplyScope } from "../../../lib/autoReplyScope.ts";
import { hasAiCredentials } from "../../../lib/aiProviders.ts";
import { evaluateAutoReplyDecision, getRecentManualTakeover, isWithinAutoReplyHours, resolveAutoReplyPolicy } from "../../../lib/aiSafety.ts";

export type MultiWindowReplyStatus = "auto" | "manual" | "paused" | "takeover" | "hours" | "offline" | "ai" | "risk" | "unavailable";

export function multiWindowReplyStatus(
  settings: AppSettings, chat: ChatPreview, contact: Contact | undefined,
  messages: readonly Message[], accountId: string, connected: boolean, now = Date.now()
) {
  const scope = resolveAutoReplyScope(settings, chat.id);
  let status: MultiWindowReplyStatus;
  if (scope.source === "paused") status = "paused";
  else if (chat.isGroup || contact?.isGroup || chat.localOnly || scope.mode === "manual") status = "manual";
  else if (!contact) status = "unavailable";
  else if (!connected) status = "offline";
  else if (!hasAiCredentials(settings)) status = "ai";
  else {
    const thread = messages.filter(message => message.chatId === chat.id)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt)).slice(-14);
    const inbound = thread.filter(message => message.direction === "in").at(-1);
    const policy = resolveAutoReplyPolicy(settings.aiAutoReplyPolicy, settings.aiAutoReplyPolicyByAccountId, accountId);
    if (!isWithinAutoReplyHours(policy, new Date(now))) status = "hours";
    else if (getRecentManualTakeover(thread, inbound || { direction: "in", sentAt: new Date(now).toISOString() }, now, policy.takeoverMinutes * 60_000)) status = "takeover";
    else if (inbound && thread.at(-1)?.direction === "in" && !evaluateAutoReplyDecision(thread, inbound, now, policy).allow) status = "risk";
    else status = "auto";
  }
  return { status, scope };
}
