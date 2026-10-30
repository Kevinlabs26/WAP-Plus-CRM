import { useEffect, useRef, useState } from "react";
import type { ChannelId } from "@/channels";
import type { AppState } from "@/store/appStore";
import { translateCurrent } from "@/i18n";
import {
  beginVoiceRecording,
  clearVoiceTimer,
  type VoiceSession,
} from "./beginVoiceRecording";
import { finishVoiceRecording } from "./endVoiceRecording";
import type { VoiceRecordResult } from "@/lib/voiceRecord";

type UseVoiceRecordingOptions = {
  chatId?: string;
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
  const voiceRequestRef = useRef(0);
  const finishingRef = useRef(false);
  const [preview, setPreview] = useState<VoiceRecordResult | null>(null);
  const [recording, setRecording] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [recordSec, setRecordSec] = useState(0);

  useEffect(() => {
    return () => {
      voiceRequestRef.current++;
      voicePressRef.current = false;
      voiceSessionRef.current?.cancel();
      voiceSessionRef.current = null;
      setPreview(null);
      setRecording(false);
      setVoicePaused(false);
      setRecordSec(0);
      if (voiceTimerRef.current != null) {
        window.clearInterval(voiceTimerRef.current);
      }
    };
  }, [opts.chatId, opts.chatAccountId, opts.channelId, opts.selectedPhoneId]);

  const beginVoice = () => {
    if (preview || finishingRef.current) return;
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
      voiceRequestRef,
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

  const endVoice = async (send: boolean, previewOnly = false) => {
    if (finishingRef.current) return;
    if (send && preview && !previewOnly) {
      if (!opts.guardBlockedSend()) return;
      if (!opts.chatConnected) {
        opts.pushToast(translateCurrent("chat.connectFirst"), "error");
        opts.setBaileysLoginOpen(true);
        return;
      }
    }
    finishingRef.current = true;
    const request = ++voiceRequestRef.current;
    voicePressRef.current = false;
    const session = voiceSessionRef.current || preview;
    voiceSessionRef.current = null;
    clearVoiceTimer(voiceTimerRef);
    setVoicePaused(false);
    setPreview(null);
    try { await finishVoiceRecording(send, session, {
      pushToast: opts.pushToast,
      setRecording,
      setRecordSec,
      setSending: opts.setSending,
      resolveRecipient: opts.resolveRecipient,
      stickToBottom: opts.stickToBottom,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      patchMessage: opts.patchMessage,
      updateMessageDelivery: opts.updateMessageDelivery,
      chatId: opts.chatId,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      chatAccountId: opts.chatAccountId,
      onPreview: previewOnly ? result => {
        if (request === voiceRequestRef.current) setPreview(result);
      } : undefined,
    }); } finally { finishingRef.current = false; }
  };

  const readVoiceLevel = () => voiceSessionRef.current?.level() || 0;

  /** 切换会话时重置 */
  const resetVoice = () => {
    voiceRequestRef.current++;
    voicePressRef.current = false;
    voiceSessionRef.current?.cancel();
    voiceSessionRef.current = null;
    clearVoiceTimer(voiceTimerRef);
    setRecording(false);
    setVoicePaused(false);
    setRecordSec(0);
    setPreview(null);
  };

  return {
    recording,
    preview,
    preparePreview: () => endVoice(true, true),
    voicePaused,
    recordSec,
    beginVoice,
    toggleVoicePause,
    endVoice,
    readVoiceLevel,
    resetVoice,
  };
}
