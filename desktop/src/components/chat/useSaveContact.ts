import { useState } from "react";
import type { AppState } from "@/store/appStore";
import type { ChatPreview, Contact } from "@/types/crm";
import { displayContactLabel, resolveSendTarget } from "@/lib/utils";
import { savePhoneContact } from "@/lib/bridge";

type UseSaveContactOptions = {
  activeContact: Contact | null | undefined;
  activeChat: ChatPreview | undefined;
  isBaileys: boolean;
  bridgeConnected: boolean;
  chatAccountId: string;
  selectedPhoneId: string | null;
  updateContact: AppState["updateContact"];
  pushToast: AppState["pushToast"];
};

/**
 * 保存联系人到 CRM / 手机通讯录弹层，从 ChatPanel 抽离。
 */
export function useSaveContact(opts: UseSaveContactOptions) {
  const [saveContactDialog, setSaveContactDialog] = useState<{
    phone: string;
    initialName: string;
  } | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  const handleSaveContact = () => {
    if (
      !opts.activeContact ||
      opts.activeContact.isGroup ||
      opts.activeChat?.isGroup
    )
      return;
    const phone = resolveSendTarget({
      phone: opts.activeContact.phone,
      channelAddress: opts.activeContact.channelAddress,
      entityId: opts.activeContact.id,
    });
    if (!/^\+\d{7,15}$/.test(phone)) {
      opts.pushToast("当前会话没有可保存的手机号码", "error");
      return;
    }
    const currentLabel = displayContactLabel(
      opts.activeContact.name,
      opts.activeContact.phone,
      opts.activeContact.channelAddress
    );
    const suggestedName =
      /^\+\d+$/.test(currentLabel) || currentLabel === "未备注联系人"
        ? ""
        : currentLabel;
    setSaveContactDialog({ phone, initialName: suggestedName });
  };

  const confirmSaveContact = async (name: string) => {
    if (!opts.activeContact || !saveContactDialog) return;
    const { phone } = saveContactDialog;
    setSavingContact(true);
    try {
      opts.updateContact(opts.activeContact.id, {
        name,
        phone,
        source: "manual",
        accountId: opts.activeContact.accountId || opts.chatAccountId,
      });
      if (opts.isBaileys) {
        opts.pushToast(
          "已保存到 CRM；Baileys 账号无法写入手机通讯录",
          "success"
        );
        return;
      }
      if (!opts.bridgeConnected) {
        opts.pushToast(
          "已保存到 CRM；手机 Bridge 未连接，暂未写入通讯录",
          "info"
        );
        return;
      }
      const ack = await savePhoneContact(
        opts.activeContact.boundPhoneId ||
          opts.activeChat?.phoneId ||
          opts.selectedPhoneId ||
          undefined,
        name,
        phone
      );
      opts.pushToast(
        ack?.payload?.status === "exists"
          ? "已保存到 CRM；该号码已在手机通讯录中"
          : "已保存到 CRM 和手机通讯录",
        "success"
      );
    } catch (error) {
      opts.pushToast(
        `已保存到 CRM；手机通讯录写入失败：${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    } finally {
      setSaveContactDialog(null);
      setSavingContact(false);
    }
  };

  return {
    saveContactDialog,
    setSaveContactDialog,
    savingContact,
    handleSaveContact,
    confirmSaveContact,
  };
}
