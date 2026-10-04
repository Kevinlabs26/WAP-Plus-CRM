import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { getDataRestoreGeneration, isDataRestoreActive } from "@/store/restoreGuard";
import { persistChatDrafts } from "@/store/persist";

/** 合并按键更新；切换、隐藏及退出时把当前 DOM 草稿同步到原会话。 */
export function useComposerDraftAutosave(chatId: string | null | undefined, readDraft: () => string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reader = useRef(readDraft);
  reader.current = readDraft;
  const lifecycle = useRef({ chatId, restoreGeneration: getDataRestoreGeneration() });
  if (lifecycle.current.chatId !== chatId) lifecycle.current = { chatId, restoreGeneration: getDataRestoreGeneration() };
  const source = lifecycle.current;
  const cancelDraftSave = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const save = () => {
    const state = useAppStore.getState();
    if (chatId && !isDataRestoreActive() && source.restoreGeneration === getDataRestoreGeneration()
      && state.chats.some(chat => chat.id === chatId)) {
      state.setChatDraft(chatId, reader.current());
      return true;
    }
  };
  const scheduleDraftSave = () => {
    source.restoreGeneration = getDataRestoreGeneration();
    cancelDraftSave();
    timer.current = setTimeout(() => { timer.current = null; save(); }, 400);
  };
  useEffect(() => {
    const flush = () => { cancelDraftSave(); save(); };
    const hidden = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("wap:flush-chat-drafts", flush);
    document.addEventListener("visibilitychange", hidden);
    const periodic = setInterval(() => {
      if (save()) void persistChatDrafts(() => useAppStore.getState()).catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(periodic);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("wap:flush-chat-drafts", flush);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, [chatId]);
  return { scheduleDraftSave, cancelDraftSave };
}
