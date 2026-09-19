import { useCallback, useState } from "react";
import { loadMessagesPage } from "@/lib/storage";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";

export type MultiWindowHistoryState = {
  hasMore: boolean;
  loading: boolean;
};

export function useMultiWindowHistory({
  getMessages,
}: {
  getMessages: (chatId: string) => Message[];
}) {
  const [historyByChatId, setHistoryByChatId] = useState<
    Record<string, MultiWindowHistoryState>
  >({});

  const registerInitialPage = useCallback((chatId: string, total: number, count: number) => {
    setHistoryByChatId((current) => ({
      ...current,
      [chatId]: { hasMore: total > count, loading: false },
    }));
  }, []);

  const loadOlder = useCallback(
    async (chatId: string) => {
      if (historyByChatId[chatId]?.loading) return 0;
      const current = getMessages(chatId);
      const oldest = current[0];
      if (!oldest) return 0;

      setHistoryByChatId((state) => ({
        ...state,
        [chatId]: { hasMore: state[chatId]?.hasMore !== false, loading: true },
      }));
      try {
        const page = await loadMessagesPage({
          chatId,
          beforeSentAt: oldest.sentAt || null,
          beforeId: oldest.id,
          limit: 40,
        });
        const items = (page?.items || []) as Message[];
        if (!items.length) {
          setHistoryByChatId((state) => ({
            ...state,
            [chatId]: { hasMore: false, loading: false },
          }));
          return 0;
        }

        const existingIds = new Set(current.map((message) => message.id));
        const newItems = items.filter((message) => !existingIds.has(message.id));
        useAppStore.setState((state) => {
          const messagesByChatId = { ...state.messagesByChatId };
          const currentChatMessages =
            messagesByChatId[chatId] || state.messages.filter((message) => message.chatId === chatId);
          messagesByChatId[chatId] = mergeMessagesByTime(currentChatMessages, items);
          return {
            messages: mergeMessagesByTime(state.messages, items),
            messagesByChatId,
          };
        });

        setHistoryByChatId((state) => ({
          ...state,
          [chatId]: {
            hasMore: Boolean(page && newItems.length && current.length + newItems.length < page.total),
            loading: false,
          },
        }));
        return newItems.length;
      } catch {
        setHistoryByChatId((state) => ({
          ...state,
          [chatId]: { hasMore: true, loading: false },
        }));
        return 0;
      }
    },
    [getMessages, historyByChatId]
  );

  return { historyByChatId, registerInitialPage, loadOlder };
}
