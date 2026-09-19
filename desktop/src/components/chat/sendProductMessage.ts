import { baileysSendProduct } from "@/lib/baileys";
import { gatedMediaSend } from "@/channels/mediaGate";
import type { AppState } from "@/store/appStore";
import type { Contact, WhatsAppProduct } from "@/types/crm";
import type { ChannelId } from "@/channels";
import { translateCurrent } from "@/i18n";

type SendProductMessageDeps = {
  product: WhatsAppProduct;
  contact: Contact;
  recipient: string;
  caption: string;
  chatAccountId: string | null;
  channelId: ChannelId;
  selectedPhoneId: string | null;
  setSending: (sending: boolean) => void;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  pushToast: AppState["pushToast"];
};

export async function sendProductMessage({
  product,
  contact,
  recipient,
  caption,
  chatAccountId,
  channelId,
  selectedPhoneId,
  setSending,
  enqueueOutgoingMessage,
  patchMessage,
  pushToast,
}: SendProductMessageDeps) {
  if (channelId !== "baileys") {
    pushToast(translateCurrent("runtime.productUnsupported"), "error");
    return;
  }
  setSending(true);
  try {
    const raw = await gatedMediaSend(
      { phoneE164: recipient, accountId: chatAccountId },
      () => baileysSendProduct(recipient, product.id, caption, chatAccountId)
    );
    const price = product.price
      ? ` ${product.currency} ${(product.price / 1000).toFixed(2)}`
      : "";
    const msgId = enqueueOutgoingMessage({
      body: `[商品] ${product.name}${price}${caption ? `\n${caption}` : ""}`,
      phoneE164: recipient,
      contactId: contact.id,
      channelId,
      deviceId: selectedPhoneId,
      accountId: chatAccountId || undefined,
      deliveryStatus: "sent",
    });
    if (msgId) {
      patchMessage(msgId, {
        mediaType: "product",
        mediaUrl: product.imageUrl || undefined,
        mediaCaption: caption || undefined,
        waMessageId: raw.id,
        waKey:
          raw.id && raw.jid
            ? { id: raw.id, remoteJid: raw.jid, fromMe: true }
            : undefined,
      });
    }
    pushToast(translateCurrent("runtime.productSent"), "success");
  } catch (error) {
    pushToast(
      error instanceof Error ? error.message : translateCurrent("runtime.productSendFailed"),
      "error"
    );
    throw error;
  } finally {
    setSending(false);
  }
}
