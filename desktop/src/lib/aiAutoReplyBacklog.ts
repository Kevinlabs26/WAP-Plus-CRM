import { useAppStore } from "@/store/appStore";
import type { AppSettings, AppState } from "@/store/types";
import type { ChatPreview, Message } from "@/types/crm";
import { resolveAutoReplyScope } from "./autoReplyScope";
import { scheduleAutoReplyInbound } from "./aiAutoReply";
import { useAutoReplyRuntime } from "./autoReplyRuntime";
import { isAwaitingReply } from "./replyStatus";
import { isAppLockActive } from "./appLockRuntime";
import { filterMessagesForAccount } from "./personThreads";
import { loadMessagesPage } from "./storage";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import { retainMessageChats } from "@/store/messageMemory";
import { getDataRestoreGeneration, isDataRestoreActive } from "@/store/restoreGuard";

function accountFor(state: AppState, chat: ChatPreview) {
  return chat.accountId || state.contacts.find(contact => contact.id === chat.contactId)?.accountId
    || state.settings.liveBaileysAccountId || state.settings.activeAccountId;
}

function threadFor(state: AppState, chat: ChatPreview) {
  return filterMessagesForAccount(state.messagesByChatId[chat.id] || state.messages.filter(message => message.chatId === chat.id),
    accountFor(state, chat), state.settings.liveBaileysAccountId);
}

function unansweredInbound(state: AppState, chat: ChatPreview): Message | undefined {
  const thread = threadFor(state, chat);
  const inbound = thread.filter(message => message.direction === "in" && !message.systemKind && message.mediaType !== "system")
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt)).at(-1);
  if (!inbound || inbound.isGroup || inbound.contactId !== chat.contactId || !Number.isFinite(Date.parse(inbound.sentAt))
      || !isAwaitingReply(chat, "in") || state.settings.aiTaskDismissedIds?.includes(`runtime:${chat.id}:${inbound.id}`)) return;
  if (thread.some(message => message.direction === "out" && message.mediaType !== "system" && message.sentAt >= inbound.sentAt
      && (!message.systemKind || message.deliveryStatus !== "failed" || message.deliveryUncertain || message.aiReplyInboundId === inbound.id))) return;
  return inbound;
}

/** A mode transition schedules existing work once; hydration/history sync never replays it. */
export function createAutoReplyBacklogScheduler() {
  const loading = new Set<string>();
  let stopped = false;
  return {
    stop() { stopped = true; retainMessageChats("ai-auto-reply-loading", []); },
    async schedule(previous: AppSettings) {
      const initial = useAppStore.getState();
      if (stopped || !initial.hydrated || isDataRestoreActive() || isAppLockActive()) return;
      const epoch = getDataRestoreGeneration();
      const candidates = initial.chats.filter(chat => !chat.isGroup && !chat.localOnly && !chat.archived
        && resolveAutoReplyScope(previous, chat.id).mode !== "auto"
        && resolveAutoReplyScope(initial.settings, chat.id).mode === "auto");
      let reportedError = false;
      for (const candidate of candidates) {
        if (stopped || isDataRestoreActive() || getDataRestoreGeneration() !== epoch || isAppLockActive()) return;
        if (loading.has(candidate.id)) continue;
        const current = useAppStore.getState();
        const chat = current.chats.find(chat => chat.id === candidate.id);
        if (!chat || chat.contactId !== candidate.contactId || chat.accountId !== candidate.accountId
            || resolveAutoReplyScope(current.settings, chat.id).mode !== "auto") continue;
        const runtime = useAutoReplyRuntime.getState().byChat[chat.id];
        if (runtime && runtime.phase !== "human") continue;
        if (!isAwaitingReply(chat, unansweredInbound(current, chat)?.direction)) continue;
        const accountId = accountFor(current, chat);
        loading.add(chat.id);
        retainMessageChats("ai-auto-reply-loading", [...loading]);
        try {
          // shortcut: Scan the latest 80 messages; paginate if status-only histories can hide the last conversation message.
          const page = chat.hasMessageHistory ? await loadMessagesPage({ chatId: chat.id, limit: 80 }) : null;
          const fresh = useAppStore.getState();
          const target = fresh.chats.find(item => item.id === chat.id);
          if (stopped || isDataRestoreActive() || getDataRestoreGeneration() !== epoch || isAppLockActive()
              || !target || target.contactId !== chat.contactId || target.accountId !== chat.accountId
              || accountFor(fresh, target) !== accountId || resolveAutoReplyScope(fresh.settings, chat.id).mode !== "auto") continue;
          if (page?.items.length) {
            const items = filterMessagesForAccount((page.items as Message[]).filter(message => message.chatId === chat.id), accountId, fresh.settings.liveBaileysAccountId);
            useAppStore.setState(state => ({ messages: mergeMessagesByTime(state.messages, items) }));
          }
          const latest = useAppStore.getState();
          const latestChat = latest.chats.find(item => item.id === chat.id);
          if (!latestChat || latestChat.contactId !== chat.contactId || latestChat.accountId !== chat.accountId
              || accountFor(latest, latestChat) !== accountId || stopped || isAppLockActive()
              || isDataRestoreActive() || getDataRestoreGeneration() !== epoch) continue;
          const active = useAutoReplyRuntime.getState().byChat[chat.id];
          const inbound = unansweredInbound(latest, latestChat);
          if (inbound && (!active || active.phase === "human")) scheduleAutoReplyInbound(inbound);
        } catch (error) {
          console.error("[ai-auto-reply] backlog history load failed", error);
          if (!stopped && !reportedError) {
            reportedError = true;
            useAppStore.getState().pushToast("载入待回复聊天失败，请重新开启该分组的自动回复重试", "error");
          }
        } finally {
          loading.delete(chat.id);
          if (!stopped) retainMessageChats("ai-auto-reply-loading", [...loading]);
        }
      }
    },
  };
}
