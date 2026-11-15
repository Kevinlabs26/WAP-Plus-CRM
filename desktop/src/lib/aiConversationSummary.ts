import { useAppStore } from "@/store/appStore";
import { generateCustomerInsight } from "@/lib/aiCustomerCard";
import { resolveMyLang } from "@/lib/translateDraft";

const latestSummaryRequestByContact = new Map<string, string>();
type SummaryError = "no_history" | "already_running" | "stale" | "generation";
type SummaryStatus = { state: "generating" } | { state: "failed"; error: SummaryError };
const summaryStatusByContact = new Map<string, SummaryStatus>();
const summaryStatusListeners = new Set<() => void>();

type SummaryResult = { ok: true } | { ok: false; error: SummaryError };

export function subscribeAiConversationSummary(listener: () => void) {
  summaryStatusListeners.add(listener);
  return () => summaryStatusListeners.delete(listener);
}

export function getAiConversationSummaryStatus(contactId: string) {
  return summaryStatusByContact.get(contactId) || null;
}

function setSummaryStatus(contactId: string, status: SummaryStatus | null) {
  if (status) summaryStatusByContact.set(contactId, status);
  else summaryStatusByContact.delete(contactId);
  for (const listener of summaryStatusListeners) listener();
}

async function generateSummary(contactId: string, chatId?: string, sourceMessageId?: string): Promise<SummaryResult> {
  const state = useAppStore.getState();
  const contact = state.contacts.find(item => item.id === contactId);
  const source = sourceMessageId ? state.messages.find(message => message.id === sourceMessageId) : undefined;
  if (!contact || sourceMessageId && (!source || source.systemKind !== "ai_auto_reply" || source.deliveryStatus !== "sent")) {
    return { ok: false, error: "stale" };
  }
  const requestId = sourceMessageId || `manual:${crypto.randomUUID()}`;
  if (sourceMessageId && latestSummaryRequestByContact.get(contactId) === requestId) return { ok: false, error: "already_running" };
  latestSummaryRequestByContact.set(contactId, requestId);
  setSummaryStatus(contactId, { state: "generating" });
  const accountId = source?.accountId || state.chats.find(chat => chat.id === chatId)?.accountId || contact.accountId;
  const history = state.messages.filter(message => (chatId ? message.chatId === chatId : message.contactId === contactId) &&
    (!accountId || !message.accountId || message.accountId === accountId) &&
    !(message.direction === "out" && ["pending", "queued", "failed"].includes(message.deliveryStatus || "")))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const lastMessageId = history.at(-1)?.id;
  if (!lastMessageId) {
    setSummaryStatus(contactId, { state: "failed", error: "no_history" });
    return { ok: false, error: "no_history" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("summary_timeout")), 60_000);
  try {
    const language = resolveMyLang(state.settings);
    const result = await generateCustomerInsight(contact, history, state.settings, language, controller.signal);
    if (result.fallback || result.source === "mock" || !result.insight.summary.trim() ||
        result.insight.summary === "暂无足够对话可总结。") {
      console.warn("[ai-conversation-summary] generation returned no usable summary", result.error);
      if (latestSummaryRequestByContact.get(contactId) === requestId) setSummaryStatus(contactId, { state: "failed", error: "generation" });
      return { ok: false, error: "generation" };
    }

    const latest = useAppStore.getState();
    const currentContact = latest.contacts.find(item => item.id === contactId);
    const currentHistory = latest.messages.filter(message => (chatId ? message.chatId === chatId : message.contactId === contactId) &&
      (!accountId || !message.accountId || message.accountId === accountId) &&
      !(message.direction === "out" && ["pending", "queued", "failed"].includes(message.deliveryStatus || "")))
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    if (latestSummaryRequestByContact.get(contactId) !== requestId || currentHistory.at(-1)?.id !== lastMessageId ||
        latest.settings.aiProvider !== state.settings.aiProvider || resolveMyLang(latest.settings) !== language ||
        !currentContact || currentContact.aiSummary !== contact.aiSummary) {
      if (latestSummaryRequestByContact.get(contactId) === requestId) setSummaryStatus(contactId, { state: "failed", error: "stale" });
      return { ok: false, error: "stale" };
    }

    latest.updateContact(contactId, { aiSummary: result.insight.summary.slice(0, 2000), aiInsightAt: new Date().toISOString() });
    setSummaryStatus(contactId, null);
    return { ok: true };
  } catch (error) {
    console.warn("[ai-conversation-summary] update failed", error);
    if (latestSummaryRequestByContact.get(contactId) === requestId) setSummaryStatus(contactId, { state: "failed", error: "generation" });
    return { ok: false, error: "generation" };
  } finally {
    clearTimeout(timeout);
  }
}

export function generateContactConversationSummary(contactId: string, chatId?: string) {
  return generateSummary(contactId, chatId);
}

export async function refreshAiConversationSummary(messageId: string) {
  const reply = useAppStore.getState().messages.find(message => message.id === messageId);
  if (!reply || reply.systemKind !== "ai_auto_reply" || reply.deliveryStatus !== "sent" || !reply.contactId) {
    return { ok: false as const, error: "stale" as const };
  }
  return generateSummary(reply.contactId, reply.chatId, reply.id);
}
