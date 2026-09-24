import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { markChatReadRemote } from "@/lib/markChatRead";

/**
 * 自动已读群消息：开启设置后，群聊来了新消息且当前未在查看时，
 * 延迟一段时间自动清未读并远端已读，避免手机侧群未读堆积。
 */
const AUTO_READ_DELAY_MS = 8000;

export function GroupAutoReadWatcher() {
  const timers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const clearAll = () => {
      for (const [id, timer] of timers.current) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
    };

    const reconcile = (state: ReturnType<typeof useAppStore.getState>) => {
      if (!state.settings.autoReadGroupMessages) {
        clearAll();
        return;
      }
      const selected = state.selectedChatId;

      for (const [id, timer] of timers.current) {
        const chat = state.chats.find((item) => item.id === id);
        if (!chat?.isGroup || !(chat.unread > 0) || chat.id === selected) {
          window.clearTimeout(timer);
          timers.current.delete(id);
        }
      }

      for (const chat of state.chats) {
        if (!chat.isGroup) continue;
        const hasUnread = (chat.unread || 0) > 0;
        if (!hasUnread || chat.id === selected) continue;
        if (timers.current.has(chat.id)) continue;
        const timer = window.setTimeout(() => {
          timers.current.delete(chat.id);
          const current = useAppStore.getState();
          const latestChat = current.chats.find((item) => item.id === chat.id);
          if (
            !current.settings.autoReadGroupMessages ||
            !latestChat?.isGroup ||
            !(latestChat.unread > 0) ||
            latestChat.id === current.selectedChatId
          ) {
            return;
          }
          const contact = current.contacts.find(
            (item) => item.id === latestChat.contactId
          );
          void markChatReadRemote(latestChat, contact);
        }, AUTO_READ_DELAY_MS);
        timers.current.set(chat.id, timer);
      }
    };

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (
        state.chats === prev.chats &&
        state.contacts === prev.contacts &&
        state.selectedChatId === prev.selectedChatId &&
        state.settings.autoReadGroupMessages ===
          prev.settings.autoReadGroupMessages
      ) {
        return;
      }
      reconcile(state);
    });
    reconcile(useAppStore.getState());

    return () => {
      unsubscribe();
      clearAll();
    };
  }, []);

  return null;
}
