import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { loadMessagesPage } from "@/lib/storage";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { useI18n } from "@/i18n";

export function useMultiWindowRefresh({
  setDiskMessagesByChatId,
  onPageLoaded,
  onError,
}: {
  setDiskMessagesByChatId: Dispatch<SetStateAction<Record<string, Message[]>>>;
  onPageLoaded: (chatId: string, total: number, count: number) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useI18n();
  const [refreshingChatId, setRefreshingChatId] = useState<string | null>(null);

  const refreshWindow = useCallback(async (chatId: string) => {
    if (refreshingChatId) return;
    setRefreshingChatId(chatId);
    try {
      const page = await loadMessagesPage({ chatId, limit: 40 });
      const items = (page?.items || []) as Message[];
      useAppStore.setState((state) => {
        const current = state.messagesByChatId[chatId] || state.messages.filter((message) => message.chatId === chatId);
        const messagesByChatId = { ...state.messagesByChatId, [chatId]: mergeMessagesByTime(current, items) };
        return { messages: mergeMessagesByTime(state.messages, items), messagesByChatId };
      });
      setDiskMessagesByChatId((current) => ({
        ...current,
        [chatId]: mergeMessagesByTime(current[chatId] || [], items),
      }));
      onPageLoaded(chatId, page?.total || items.length, items.length);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : t("multi.refreshFailed"));
    } finally {
      setRefreshingChatId(null);
    }
  }, [onError, onPageLoaded, refreshingChatId, setDiskMessagesByChatId, t]);

  return { refreshingChatId, refreshWindow };
}
