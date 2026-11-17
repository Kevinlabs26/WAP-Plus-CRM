import { useEffect } from "react";
import { onLiveInboundMessages, scheduleAutoReplyInbound, stopAutoReplies, refreshManualTakeovers, refreshAutoReplyPause, tickAiAutoFollowUps, cancelAiAutoFollowUpsForChat, cancelInactiveAiAutoFollowUps, stopAiAutoFollowUps } from "@/lib/aiAutoReply";
import { useAppStore } from "@/store/appStore";
import { useAutoReplyRuntime } from "@/lib/autoReplyRuntime";
import { updateAiReplyTaskRecords } from "@/lib/aiTaskRecords";
import { latestMessagesPerChat } from "@/lib/aiSafety";
import { tickAiOutreach, stopAiOutreach, noteOutreachOptOut } from "@/lib/aiOutreach";
import { isAppLockActive } from "@/lib/appLockRuntime";
import { createAutoReplyBacklogScheduler } from "@/lib/aiAutoReplyBacklog";
import { retainMessageChats } from "@/store/messageMemory";

/**
 * AI 全自动回复：处理实时入站私聊消息，并在开启自动时补扫待回复会话。
 * 判定/限流/连接检查都在 lib/aiAutoReply 里，组件只做挂载。
 */
export function AiAutoReplier() {
  useEffect(() => {
    const backlog = createAutoReplyBacklogScheduler();
    const unsubscribeRecords=useAutoReplyRuntime.subscribe((current,previous)=>{
      if(current.byChat===previous.byChat)return;
      retainMessageChats("ai-auto-reply", Object.keys(current.byChat).filter(chatId => current.byChat[chatId].phase !== "human"));
      const state=useAppStore.getState();
      state.updateSettings({aiReplyTaskRecords:updateAiReplyTaskRecords(state.settings.aiReplyTaskRecords||[],current.byChat,previous.byChat,state.messages)});
    });
    const unsubscribe = onLiveInboundMessages((messages) => {
      if (isAppLockActive()) return;
      noteOutreachOptOut(messages);
      // 同批连续消息按会话合并，只回复该会话最新一条。
      for (const m of latestMessagesPerChat(messages)) {
        cancelAiAutoFollowUpsForChat(m.chatId);
        scheduleAutoReplyInbound(m);
      }
    });
    const timer=window.setInterval(()=>{
      void tickAiOutreach().catch(error=>console.error("[ai-outreach] scheduler failed",error));
      void tickAiAutoFollowUps().catch(error=>console.error("[ai-auto-follow-up] scheduler failed",error));
    },30_000);
    const unsubscribeSettings = useAppStore.subscribe((state, previous) => {
      if(state.settings.aiAutoReplyPaused!==previous.settings.aiAutoReplyPaused)refreshAutoReplyPause();
      if (state.settings.aiAutoReplyPolicy !== previous.settings.aiAutoReplyPolicy ||
          state.settings.aiAutoReplyPolicyByAccountId !== previous.settings.aiAutoReplyPolicyByAccountId) refreshManualTakeovers();
      if (state.settings.aiAutoFollowUpEnabled !== previous.settings.aiAutoFollowUpEnabled ||
          state.settings.aiAutoReplyPaused !== previous.settings.aiAutoReplyPaused ||
          state.settings.aiReplyMode !== previous.settings.aiReplyMode ||
          state.settings.aiAutoReplyModeByChatId !== previous.settings.aiAutoReplyModeByChatId ||
          state.settings.aiAutoReplyManualChatIds !== previous.settings.aiAutoReplyManualChatIds ||
          state.settings.chatFolders !== previous.settings.chatFolders ||
          state.settings.chatFolderClones !== previous.settings.chatFolderClones ||
          state.settings.leadInbox !== previous.settings.leadInbox) cancelInactiveAiAutoFollowUps();
      if (state.hydrated && previous.hydrated && (
          state.settings.aiAutoReplyPaused !== previous.settings.aiAutoReplyPaused ||
          state.settings.aiReplyMode !== previous.settings.aiReplyMode ||
          state.settings.aiAutoReplyModeByChatId !== previous.settings.aiAutoReplyModeByChatId ||
          state.settings.aiAutoReplyManualChatIds !== previous.settings.aiAutoReplyManualChatIds ||
          state.settings.chatFolders !== previous.settings.chatFolders ||
          state.settings.chatFolderClones !== previous.settings.chatFolderClones ||
          state.settings.leadInbox !== previous.settings.leadInbox)) void backlog.schedule(previous.settings);
    });
    return () => { backlog.stop();retainMessageChats("ai-auto-reply", []);window.clearInterval(timer);stopAiOutreach();stopAiAutoFollowUps();unsubscribeRecords();unsubscribeSettings();unsubscribe(); stopAutoReplies(); };
  }, []);

  return null;
}
