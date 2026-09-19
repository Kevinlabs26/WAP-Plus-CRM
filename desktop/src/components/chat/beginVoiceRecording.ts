import { canRecordVoice, startVoiceRecording } from "@/lib/voiceRecord";
import type { AppState } from "@/store/appStore";
import type { MutableRefObject } from "react";
import { translateCurrent } from "@/i18n";

export type VoiceSession = {
  stop: () => Promise<{
    dataUrl: string;
    mimeType: string;
    durationSec: number;
    byteLength: number;
  }>;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  durationSec: () => number;
  level: () => number;
};

type BeginVoiceRecordingDeps = {
  isBaileys: boolean;
  sending: boolean;
  recording: boolean;
  chatConnected: boolean;
  pushToast: AppState["pushToast"];
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  resolveRecipient: () => {
    contact: { id: string } | null;
    recipient: string | null;
  };
  voicePressRef: MutableRefObject<boolean>;
  voiceSessionRef: MutableRefObject<VoiceSession | null>;
  voiceTimerRef: MutableRefObject<number | null>;
  setRecording: (recording: boolean) => void;
  setVoicePaused: (paused: boolean) => void;
  setRecordSec: (seconds: number) => void;
};

export function clearVoiceTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current != null) {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

export async function beginVoiceRecording(deps: BeginVoiceRecordingDeps) {
  if (
    !deps.isBaileys ||
    deps.sending ||
    deps.recording ||
    deps.voicePressRef.current
  )
    return;
  if (!canRecordVoice()) {
    deps.pushToast(translateCurrent("runtime.recordDesktopMic"), "error");
    return;
  }
  if (!deps.chatConnected) {
    deps.pushToast(translateCurrent("chat.connectFirst"), "error");
    deps.setBaileysLoginOpen(true);
    return;
  }
  const { contact, recipient } = deps.resolveRecipient();
  if (!contact || !recipient) {
    deps.pushToast(translateCurrent("runtime.noRecipient"), "error");
    return;
  }
  try {
    deps.voicePressRef.current = true;
    const session = await startVoiceRecording();
    if (!deps.voicePressRef.current) {
      session.cancel();
      return;
    }
    deps.voiceSessionRef.current = session;
    deps.setRecording(true);
    deps.setVoicePaused(false);
    deps.setRecordSec(0);
    clearVoiceTimer(deps.voiceTimerRef);
    deps.voiceTimerRef.current = window.setInterval(() => {
      deps.setRecordSec(session.durationSec());
    }, 200);
  } catch (e) {
    deps.voicePressRef.current = false;
    deps.setRecording(false);
    deps.setVoicePaused(false);
    deps.pushToast(e instanceof Error ? e.message : translateCurrent("runtime.recordStartFailed"), "error");
  }
}
