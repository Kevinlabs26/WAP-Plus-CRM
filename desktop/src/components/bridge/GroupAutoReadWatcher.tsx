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

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (!state.settings.autoReadGroupMessages) {
        clearAll();
        return;
      }
      if (state.chats === prev.chats) return;
      const selected = state.selectedChatId;
      const contacts = state.contacts;
      for (const chat of state.chats) {
        if (!chat.isGroup) continue;
        const hasUnread = (chat.unread || 0) > 0;
        if (!hasUnread || chat.id === selected) {
          const timer = timers.current.get(chat.id);
          if (timer != null) {
            window.clearTimeout(timer);
            timers.current.delete(chat.id);
          }
          continue;
        }
        if (timers.current.has(chat.id)) continue;
        const contact = contacts.find((c) => c.id === chat.contactId);
        const timer = window.setTimeout(() => {
          timers.current.delete(chat.id);
          void markChatReadRemote(chat, contact);
        }, AUTO_READ_DELAY_MS);
        timers.current.set(chat.id, timer);
      }
    });

    return () => {
      unsubscribe();
      clearAll();
    };
  }, []);

  return null;
}
