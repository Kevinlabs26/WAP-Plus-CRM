import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { loadMessagesPage } from "@/lib/storage";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { useI18n } from "@/i18n";

export function useMultiWindowDataEffects({
  pickerOpen,
  pickerRef,
  setPickerOpen,
  setQuery,
  visibleLoadIds,
  totalPages,
  setPage,
  setDiskMessagesByChatId,
  onPageLoaded,
}: {
  pickerOpen: boolean;
  pickerRef: RefObject<HTMLDivElement>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setQuery: Dispatch<SetStateAction<string>>;
  visibleLoadIds: string[];
  totalPages: number;
  setPage: Dispatch<SetStateAction<number>>;
  setDiskMessagesByChatId: Dispatch<SetStateAction<Record<string, Message[]>>>;
  onPageLoaded: (chatId: string, total: number, count: number) => void;
}) {
  const { t } = useI18n();
  const [loadErrorByChatId, setLoadErrorByChatId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !pickerRef.current?.contains(target)) {
        setPickerOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen, pickerRef, setPickerOpen, setQuery]);

  const visibleKey = visibleLoadIds.join("|");
  useEffect(() => {
    if (!visibleLoadIds.length) return;
    let cancelled = false;
    setLoadErrorByChatId((current) => {
      const next = { ...current };
      for (const chatId of visibleLoadIds) delete next[chatId];
      return next;
    });
    void Promise.all(
      visibleLoadIds.map(async (chatId) => {
        try {
          const result = await loadMessagesPage({ chatId, limit: 40 });
          return {
            chatId,
            items: (result?.items || []) as Message[],
            total: result?.total || 0,
            error: "",
          };
        } catch (error) {
          return {
            chatId,
            items: [] as Message[],
            total: 0,
            error: error instanceof Error ? error.message : t("multi.loadFailed"),
          };
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      const incoming = rows.flatMap(({ items }) => items);
      useAppStore.setState((state) => {
        const existingIds = new Set(state.messages.map((message) => message.id));
        const newMessages = incoming.filter((message) => !existingIds.has(message.id));
        const messages = mergeMessagesByTime(state.messages, newMessages);
        const messagesByChatId = { ...state.messagesByChatId };
        for (const { chatId, items } of rows) {
          const current = messagesByChatId[chatId] || state.messages.filter((message) => message.chatId === chatId);
          messagesByChatId[chatId] = mergeMessagesByTime(current, items);
        }
        return { messages, messagesByChatId };
      });
      for (const { chatId, total, items } of rows) {
        onPageLoaded(chatId, total, items.length);
      }
      setLoadErrorByChatId((current) => {
        const next = { ...current };
        for (const { chatId, error } of rows) {
          if (error) next[chatId] = error;
          else delete next[chatId];
        }
        return next;
      });
      setDiskMessagesByChatId((current) => {
        const next = { ...current };
        for (const { chatId, items } of rows) {
          next[chatId] = items;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onPageLoaded, setDiskMessagesByChatId, t, visibleLoadIds.length, visibleKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [setPage, totalPages]);

  return { loadErrorByChatId };
}
