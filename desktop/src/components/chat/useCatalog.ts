import { useState } from "react";
import type { ChannelId } from "@/channels";
import type { AppState } from "@/store/appStore";
import { useAppStore } from "@/store/appStore";
import type { Contact, WhatsAppProduct } from "@/types/crm";
import { refreshCatalog as refreshCatalogAction } from "./refreshCatalogAction";
import { sendProductMessage } from "./sendProductMessage";

type UseCatalogOptions = {
  isBaileys: boolean;
  chatConnected: boolean;
  chatAccountId: string | null;
  channelId: ChannelId;
  selectedPhoneId: string | null;
  setSending: (sending: boolean) => void;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  pushToast: AppState["pushToast"];
  resolveRecipient: () => {
    contact: Contact | null;
    recipient: string | null;
  };
  guardBlockedSend: () => boolean;
};

/**
 * 商品目录弹层：打开/刷新/发送商品，从 ChatPanel 抽离。
 */
export function useCatalog(opts: UseCatalogOptions) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [products, setProducts] = useState<WhatsAppProduct[]>([]);

  const refreshCatalog = async () => {
    return refreshCatalogAction({
      chatAccountId: opts.chatAccountId,
      setCatalogLoading,
      setProducts,
      pushToast: opts.pushToast,
    });
  };

  const openCatalog = () => {
    if (!opts.isBaileys) {
      opts.pushToast("当前通道不支持商品卡片", "error");
      return;
    }
    if (!opts.chatConnected) {
      opts.pushToast("请先连接 WhatsApp", "error");
      return;
    }
    setCatalogOpen(true);
    void refreshCatalog();
  };

  const handleSendProduct = async (product: WhatsAppProduct) => {
    if (!opts.isBaileys) {
      opts.pushToast("当前通道不支持商品卡片", "error");
      return;
    }
    if (!opts.guardBlockedSend()) return;
    const { contact, recipient } = opts.resolveRecipient();
    if (!contact || !recipient) throw new Error("No WhatsApp recipient");
    const caption = useAppStore.getState().draftReply.trim();
    return sendProductMessage({
      product,
      contact,
      recipient,
      caption,
      chatAccountId: opts.chatAccountId,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      setSending: opts.setSending,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      patchMessage: opts.patchMessage,
      pushToast: opts.pushToast,
    });
  };

  return {
    catalogOpen,
    setCatalogOpen,
    catalogLoading,
    products,
    refreshCatalog,
    openCatalog,
    handleSendProduct,
  };
}
