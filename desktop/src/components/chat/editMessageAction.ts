import type { Message } from "@/types/crm";
import type { AppState } from "@/store/appStore";
import { gatedMediaSend } from "@/channels/mediaGate";
import { baileysMessageEdit } from "@/lib/baileys";
import { translateCurrent } from "@/i18n";

type EditDeps = {
  message: Message | undefined;
  messageKey: Parameters<typeof baileysMessageEdit>[0] | null;
  chatConnected: boolean;
  accountId: string;
  text: string;
  setSending: (value: boolean) => void;
  updateMessageDelivery: AppState["updateMessageDelivery"];
  setDraftReply: (text: string) => void;
  setEditingId: (id: string | null) => void;
  setReplyTo: (value: null) => void;
  pushToast: AppState["pushToast"];
};

export async function editMessageAction({
  message,
  messageKey,
  chatConnected,
  accountId,
  text,
  setSending,
  updateMessageDelivery,
  setDraftReply,
  setEditingId,
  setReplyTo,
  pushToast,
}: EditDeps) {
  if (!message || !messageKey) {
    pushToast(translateCurrent("runtime.editMissingId"), "error");
    setEditingId(null);
    return;
  }

  setSending(true);
  try {
    if (!chatConnected) {
      pushToast(translateCurrent("chat.connectFirst"), "error");
      return;
    }
    await gatedMediaSend(
      { phoneE164: messageKey.remoteJid, accountId },
      () => baileysMessageEdit(messageKey, text, accountId)
    );
    updateMessageDelivery(message.id, { body: text, edited: true });
    setDraftReply("");
    setEditingId(null);
    setReplyTo(null);
    pushToast(translateCurrent("runtime.edited"), "success");
  } catch (error) {
    pushToast(error instanceof Error ? error.message : translateCurrent("runtime.editFailed"), "error");
  } finally {
    setSending(false);
  }
}
