import { baileysSendVoice } from "@/lib/baileys";
import { gatedMediaSend } from "@/channels/mediaGate";
import type { ChannelId } from "@/channels";
import type { AppState } from "@/store/appStore";
import { translateCurrent } from "@/i18n";

type Deps = {
  sending: boolean;
  setSending: (value: boolean) => void;
  guardBlockedSend: () => boolean;
  resolveRecipient: () => { contact: { id: string } | null; recipient: string };
  pushToast: AppState["pushToast"];
  isBaileys: boolean;
  chatConnected: boolean;
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  stickToBottom: () => void;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  channelId: ChannelId;
  selectedPhoneId: string | null;
  chatAccountId: string | null;
  openAndroidMediaShare: (
    file: File,
    dataUrl: string,
    caption: string,
    phoneE164: string
  ) => Promise<object>;
};

function readAudioSeconds(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      audio.remove();
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

export async function sendAudioMessage(
  file: File,
  captionOverride: string | undefined,
  deps: Deps
) {
  if (deps.sending) return false;
  if (!deps.guardBlockedSend()) return false;
  const { contact, recipient } = deps.resolveRecipient();
  if (!contact || !recipient) {
    deps.pushToast(translateCurrent("runtime.noRecipient"), "error");
    return false;
  }
  if (deps.isBaileys && !deps.chatConnected) {
    deps.pushToast(translateCurrent("chat.connectFirst"), "error");
    deps.setBaileysLoginOpen(true);
    return false;
  }
  if (file.size > 14 * 1024 * 1024) {
    deps.pushToast(translateCurrent("runtime.audioTooLarge"), "error");
    return false;
  }

  deps.setSending(true);
  let msgId: string | null = null;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(translateCurrent("runtime.audioReadFailed")));
      reader.readAsDataURL(file);
    });
    const seconds = Math.min(600, await readAudioSeconds(file));
    const caption = captionOverride?.trim() || "";
    msgId = deps.enqueueOutgoingMessage({
      body: caption || `[音频] ${file.name}`,
      phoneE164: recipient,
      contactId: contact.id,
      channelId: deps.channelId,
      deviceId: deps.selectedPhoneId,
      accountId: deps.chatAccountId || undefined,
      deliveryStatus: "pending",
    });
    msgId && deps.patchMessage(msgId, {
      mediaType: "audio",
      mediaUrl: dataUrl,
      mediaMime: file.type || "audio/mp4",
      mediaPtt: true,
      mediaSeconds: seconds || undefined,
      mediaCaption: caption || undefined,
    });

    const raw = deps.isBaileys
      ? await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () =>
            baileysSendVoice(recipient, dataUrl, {
              mimetype: file.type || "audio/mp4",
              ptt: true,
              seconds: seconds || undefined,
              accountId: deps.chatAccountId,
            })
        )
      : await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () => deps.openAndroidMediaShare(file, dataUrl, caption, recipient)
        );
    if (msgId) {
      if (deps.isBaileys) {
        deps.updateMessageDelivery(msgId, {
          deliveryStatus: "sent",
          waMessageId:
            raw && "id" in raw && typeof raw.id === "string"
              ? raw.id
              : undefined,
          lastError: undefined,
        });
      } else {
        deps.updateMessageDelivery(msgId, {
          deliveryStatus: "local",
          lastError: undefined,
        });
      }
    }
    deps.pushToast(
      deps.isBaileys
        ? translateCurrent("runtime.audioSent")
        : translateCurrent("runtime.phoneShareConfirm"),
      "success"
    );
    return true;
  } catch (error) {
    if (msgId) {
      deps.updateMessageDelivery(msgId, {
        deliveryStatus: "failed",
        lastError: error instanceof Error ? error.message : translateCurrent("runtime.voiceSendFailed"),
      });
    }
    deps.pushToast(error instanceof Error ? error.message : translateCurrent("runtime.voiceSendFailed"), "error");
    return false;
  } finally {
    deps.setSending(false);
  }
}
