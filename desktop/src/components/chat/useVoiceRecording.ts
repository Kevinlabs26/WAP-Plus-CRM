import { useEffect, useRef, useState } from "react";
import type { ChannelId } from "@/channels";
import type { AppState } from "@/store/appStore";
import {
  beginVoiceRecording,
  clearVoiceTimer,
  type VoiceSession,
} from "./beginVoiceRecording";
import { finishVoiceRecording } from "./endVoiceRecording";

type UseVoiceRecordingOptions = {
  isBaileys: boolean;
  sending: boolean;
  chatConnected: boolean;
  pushToast: AppState["pushToast"];
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  setSending: (sending: boolean) => void;
  resolveRecipient: () => {
    contact: { id: string } | null;
    recipient: string | null;
  };
  channelId: ChannelId;
  selectedPhoneId: string | null;
  chatAccountId: string | null | undefined;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  guardBlockedSend: () => boolean;
  stickToBottom: () => void;
};

/**
 * 语音消息录音状态机：开始/暂停/结束/取消 + 时长定时器 + 卸载清理，
 * 从 ChatPanel 抽离以缩小组件体积。
 */
export function useVoiceRecording(opts: UseVoiceRecordingOptions) {
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const voiceTimerRef = useRef<number | null>(null);
  const voicePressRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [recordSec, setRecordSec] = useState(0);

  useEffect(() => {
    return () => {
      voiceSessionRef.current?.cancel();
      voiceSessionRef.current = null;
      if (voiceTimerRef.current != null) {
        window.clearInterval(voiceTimerRef.current);
      }
    };
  }, []);

  const beginVoice = () => {
    if (!opts.guardBlockedSend()) return;
    return beginVoiceRecording({
      isBaileys: opts.isBaileys,
      sending: opts.sending,
      recording,
      chatConnected: opts.chatConnected,
      pushToast: opts.pushToast,
      setBaileysLoginOpen: opts.setBaileysLoginOpen,
      resolveRecipient: opts.resolveRecipient,
      voicePressRef,
      voiceSessionRef,
      voiceTimerRef,
      setRecording,
      setVoicePaused,
      setRecordSec,
    });
  };

  const toggleVoicePause = () => {
    const session = voiceSessionRef.current;
    if (!session) return;
    try {
      if (voicePaused) session.resume();
      else session.pause();
      setVoicePaused(!voicePaused);
    } catch (error) {
      opts.pushToast(
        error instanceof Error ? error.message : "无法切换录音状态",
        "error"
      );
    }
  };

  const endVoice = (send: boolean) => {
    voicePressRef.current = false;
    const session = voiceSessionRef.current;
    voiceSessionRef.current = null;
    clearVoiceTimer(voiceTimerRef);
    setVoicePaused(false);
    return finishVoiceRecording(send, session, {
      pushToast: opts.pushToast,
      setRecording,
      setRecordSec,
      setSending: opts.setSending,
      resolveRecipient: opts.resolveRecipient,
      stickToBottom: opts.stickToBottom,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      patchMessage: opts.patchMessage,
      updateMessageDelivery: opts.updateMessageDelivery,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      chatAccountId: opts.chatAccountId,
    });
  };

  const readVoiceLevel = () => voiceSessionRef.current?.level() || 0;

  /** 切换会话时重置 */
  const resetVoice = () => {
    voicePressRef.current = false;
    voiceSessionRef.current?.cancel();
    voiceSessionRef.current = null;
    clearVoiceTimer(voiceTimerRef);
    setRecording(false);
    setVoicePaused(false);
    setRecordSec(0);
  };

  return {
    recording,
    voicePaused,
    recordSec,
    beginVoice,
    toggleVoicePause,
    endVoice,
    readVoiceLevel,
    resetVoice,
  };
}
