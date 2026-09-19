import type { ChannelId } from "@/channels";
import { gatedMediaSend } from "@/channels/mediaGate";
import { baileysSendVoice } from "@/lib/baileys";
import type { AppState } from "@/store/appStore";
import { translateCurrent } from "@/i18n";
import type { VoiceSession } from "./beginVoiceRecording";

type FinishVoiceRecordingDeps = {
  pushToast: AppState["pushToast"];
  setRecording: (recording: boolean) => void;
  setRecordSec: (seconds: number) => void;
  setSending: (sending: boolean) => void;
  resolveRecipient: () => {
    contact: { id: string } | null;
    recipient: string | null;
  };
  stickToBottom: () => void;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  channelId: ChannelId;
  selectedPhoneId: string | null;
  chatAccountId: string | null | undefined;
};

export async function finishVoiceRecording(
  send: boolean,
  session: VoiceSession | null,
  deps: FinishVoiceRecordingDeps
) {
  if (!session) {
    deps.setRecording(false);
    deps.setRecordSec(0);
    return;
  }
  if (!send) {
    session.cancel();
    deps.setRecording(false);
    deps.setRecordSec(0);
    deps.pushToast(translateCurrent("runtime.recordCancelled"), "info");
    return;
  }
  deps.setSending(true);
  let msgId: string | null = null;
  try {
    const result = await session.stop();
    deps.setRecording(false);
    if (result.durationSec < 1 || result.byteLength < 200) {
    deps.pushToast(translateCurrent("runtime.recordTooShort"), "info");
      return;
    }
    if (result.durationSec > 120) {
    deps.pushToast(translateCurrent("runtime.recordTooLong"), "error");
      return;
    }
    const { contact, recipient } = deps.resolveRecipient();
    if (!contact || !recipient) {
    deps.pushToast(translateCurrent("runtime.noRecipient"), "error");
      return;
    }
    deps.stickToBottom();
    const body = `[语音 ${result.durationSec}s]`;
    msgId = deps.enqueueOutgoingMessage({
      body,
      phoneE164: recipient,
      contactId: contact.id,
      channelId: deps.channelId,
      deviceId: deps.selectedPhoneId,
      accountId: deps.chatAccountId || undefined,
      deliveryStatus: "pending",
    });
    if (msgId) {
      deps.patchMessage(msgId, {
        mediaType: "audio",
        mediaUrl: result.dataUrl,
        mediaMime: result.mimeType,
        mediaSeconds: result.durationSec,
        mediaPtt: true,
      });
    }
    const raw = await gatedMediaSend(
      { phoneE164: recipient, accountId: deps.chatAccountId },
      () =>
        baileysSendVoice(recipient, result.dataUrl, {
          seconds: result.durationSec,
          mimetype: result.mimeType,
          ptt: true,
          accountId: deps.chatAccountId,
        })
    );
    if (msgId) {
      deps.updateMessageDelivery(msgId, {
        deliveryStatus: "sent",
        waMessageId:
          raw && typeof raw.id === "string" ? raw.id : undefined,
        lastError: undefined,
      });
    }
    deps.pushToast(translateCurrent("runtime.voiceSent"), "success");
  } catch (e) {
    deps.setRecording(false);
    // 失败必须回滚气泡状态，否则永久停留在「发送中」且无重试出口
    const message = e instanceof Error ? e.message : translateCurrent("runtime.voiceSendFailed");
    if (msgId) {
      deps.updateMessageDelivery(msgId, {
        deliveryStatus: "failed",
        lastError: message,
      });
    }
    deps.pushToast(message, "error");
  } finally {
    deps.setRecordSec(0);
    deps.setSending(false);
  }
}
