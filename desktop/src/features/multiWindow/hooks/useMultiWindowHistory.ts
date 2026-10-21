import { useCallback, useRef, useState } from "react";
import { loadChatHistoryPage, type HistoryCursor } from "@/lib/chatHistory";
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
  const cursors = useRef(new Map<string, HistoryCursor | null>());
  const loading = useRef(new Set<string>());

  const registerInitialPage = useCallback((chatId: string, total: number, count: number) => {
    cursors.current.delete(chatId);
    setHistoryByChatId((current) => ({
      ...current,
      [chatId]: { hasMore: total > count, loading: false },
    }));
  }, []);

  const loadOlder = useCallback(
    async (chatId: string) => {
      if (loading.current.has(chatId)) return 0;
      const current = getMessages(chatId);
      const oldest = current.reduce<Message | undefined>((oldest, message) =>
        !oldest || message.sentAt < oldest.sentAt || (message.sentAt === oldest.sentAt && message.id < oldest.id) ? message : oldest, undefined);
      const cursor = cursors.current.get(chatId) || (oldest ? { beforeSentAt: oldest.sentAt, beforeId: oldest.id } : null);
      loading.current.add(chatId);

      setHistoryByChatId((state) => ({
        ...state,
        [chatId]: { hasMore: state[chatId]?.hasMore !== false, loading: true },
      }));
      try {
        const page = await loadChatHistoryPage(chatId, cursor, (items) => {
          let added = 0;
          useAppStore.setState((state) => {
            const messages = mergeMessagesByTime(state.messages, items);
            const previous = state.messages.filter((message) => message.chatId === chatId);
            const bucket = messages.filter((message) => message.chatId === chatId);
            added = bucket.length - previous.length;
            return { messages, messagesByChatId: { ...state.messagesByChatId, [chatId]: bucket } };
          });
          return added;
        }, 40);
        cursors.current.set(chatId, page.cursor);

        setHistoryByChatId((state) => ({
          ...state,
          [chatId]: {
            hasMore: page.hasMore,
            loading: false,
          },
        }));
        return page.added;
      } catch {
        setHistoryByChatId((state) => ({
          ...state,
          [chatId]: { hasMore: true, loading: false },
        }));
        return 0;
      } finally {
        loading.current.delete(chatId);
      }
    },
    [getMessages]
  );

  return { historyByChatId, registerInitialPage, loadOlder };
}
