import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { loadMessagesPage } from "@/lib/storage";
import { baileysFetchMessageHistory } from "@/lib/baileys";
import { filterMessagesForAccount } from "@/lib/personThreads";
import { syncLog } from "@/lib/syncDebug";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import type { Message } from "@/types/crm";
import { loadChatHistoryPage, type HistoryCursor, type HistoryPage } from "@/lib/chatHistory";

export function useChatHistory(chatId: string | null, accountId: string, liveAccountId?: string) {
  const requestedHistory = useRef(new Set<string>());
  const mergeDiskPage = useCallback((targetChatId: string, incoming: Message[]) => {
    useAppStore.setState((state) => {
      const messages = mergeMessagesByTime(state.messages, incoming);
      const messagesByChatId = { ...state.messagesByChatId };
      let indexChanged = false;
      for (const id of new Set([targetChatId, ...incoming.map((message) => message.chatId)])) {
        const bucket = messages.filter((message) => message.chatId === id);
        const previous = messagesByChatId[id];
        if (!previous && !bucket.length) continue;
        if (previous?.length === bucket.length && bucket.every((message, i) => message === previous[i])) continue;
        messagesByChatId[id] = bucket;
        indexChanged = true;
      }
      return messages === state.messages && !indexChanged ? state : { messages, messagesByChatId };
    });
  }, []);

  useEffect(() => {
    if (!chatId) return;
    let cancelled = false, inFlight = false, retried = false;
    let retryTimer: number | undefined;
    const load = async () => {
      if (cancelled || inFlight) return;
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      inFlight = true;
      try {
        const page = await loadMessagesPage({ chatId, limit: 200 });
        if (cancelled) return;
        mergeDiskPage(chatId, (page?.items || []) as Message[]);
        retried = false;
        const state = useAppStore.getState();
        const bucket = filterMessagesForAccount(
          state.messages.filter((message) => message.chatId === chatId), accountId, liveAccountId
        );
        const oldest = bucket.find((message) => message.waKey?.remoteJid && message.waKey?.id);
        const key = `${accountId}:${chatId}`;
        if (bucket.length < 200 && oldest?.waKey && accountId && !requestedHistory.current.has(key)) {
          requestedHistory.current.add(key);
          void baileysFetchMessageHistory({ key: oldest.waKey, oldestMsgTimestampMs: Date.parse(oldest.sentAt), count: 50 }, accountId)
            .catch((error) => {
              requestedHistory.current.delete(key);
              syncLog("ui.chat", "protocol history request failed", { chatId, error: String(error) });
            });
        }
      } catch (error) {
        if (cancelled) return;
        syncLog("ui.chat", "disk history load failed", { chatId, error: String(error) });
        if (!retried) {
          retried = true;
          retryTimer = window.setTimeout(() => { void load(); }, 1000);
        } else {
          useAppStore.getState().pushToast("聊天历史读取失败，请重新聚焦窗口重试", "error");
        }
      } finally { inFlight = false; }
    };
    const onFocus = () => { void load(); };
    const onVisible = () => { if (!document.hidden) void load(); };
    void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [chatId, accountId, liveAccountId, mergeDiskPage]);

  return useCallback(async (targetChatId: string, initialCursor: HistoryCursor | null): Promise<HistoryPage> => {
    const count = () => filterMessagesForAccount(
      useAppStore.getState().messages.filter((message) => message.chatId === targetChatId), accountId, liveAccountId
    ).length;
    return loadChatHistoryPage(targetChatId, initialCursor, (items) => {
      const before = count();
      mergeDiskPage(targetChatId, items);
      return count() - before;
    });
  }, [accountId, liveAccountId, mergeDiskPage]);
}
