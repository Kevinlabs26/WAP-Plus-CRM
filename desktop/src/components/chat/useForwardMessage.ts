import { useMemo, useState } from "react";
import type { AppState } from "@/store/appStore";
import { useAppStore } from "@/store/appStore";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import {
  displayContactLabel,
  resolveSendTarget,
} from "@/lib/utils";
import { getAccountBlocklist, isJidBlocked } from "@/lib/accountWaMeta";
import { resolveMessageKeyFrom } from "./resolveMessageKey";
import { forwardMessage as forwardMessageAction } from "./forwardMessageAction";
import {
  type ForwardTarget,
} from "./ForwardMessageModal";

const EMPTY_FORWARD_TARGETS: ForwardTarget[] = [];

type UseForwardMessageOptions = {
  chats: ChatPreview[];
  contacts: Contact[];
  selectedContactId: string | null;
  blocklistByAccountId: AppState["settings"]["blocklistByAccountId"];
  blocklistJids: AppState["settings"]["blocklistJids"];
  liveBaileysAccountId: string | null | undefined;
  activeAccountId: string | null | undefined;
  pushToast: AppState["pushToast"];
};

/**
 * 转发消息弹层：目标列表（排除拉黑）+ 发送，从 ChatPanel 抽离。
 */
export function useForwardMessage(opts: UseForwardMessageOptions) {
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardSending, setForwardSending] = useState(false);

  const resolveMessageKey = (m: Message) =>
    resolveMessageKeyFrom(
      m,
      useAppStore.getState().contacts,
      opts.selectedContactId
    );

  const forwardTargets = useMemo(() => {
    // 转发弹窗未开：直接短路，避免每批 ingest 都做 O(chats × contacts)
    if (!forwardMessage) return EMPTY_FORWARD_TARGETS;
    return opts.chats
      .map((chat): ForwardTarget | null => {
        const contact = opts.contacts.find(
          (item) => item.id === chat.contactId
        );
        const recipient = resolveSendTarget({
          phone: contact?.phone,
          channelAddress: contact?.channelAddress,
          entityId: contact?.id || chat.contactId,
        });
        if (!recipient) return null;
        // 已拉黑联系人不出现在转发目标里
        if (
          contact &&
          !contact.isGroup &&
          isJidBlocked(
            getAccountBlocklist(
              opts.blocklistByAccountId,
              contact.accountId ||
                chat.accountId ||
                opts.liveBaileysAccountId ||
                opts.activeAccountId ||
                "",
              opts.blocklistJids
            ),
            contact.channelAddress || contact.phone
          )
        ) {
          return null;
        }
        return {
          chatId: chat.id,
          accountId: contact?.accountId || chat.accountId,
          label: displayContactLabel(
            contact?.name || chat.contactName,
            contact?.phone,
            contact?.channelAddress,
            chat.lastMessage,
            { isGroup: !!(contact?.isGroup || chat.isGroup) }
          ),
          subtitle: contact?.isGroup
            ? `群聊 · ${contact.participantCount || 0} 人`
            : contact?.phone || contact?.channelAddress || "WhatsApp",
          recipient,
        };
      })
      .filter((target): target is ForwardTarget => Boolean(target));
  }, [
    opts.chats,
    opts.contacts,
    forwardMessage,
    opts.blocklistByAccountId,
    opts.blocklistJids,
    opts.liveBaileysAccountId,
    opts.activeAccountId,
  ]);

  const handleForwardMessage = async (targets: ForwardTarget[]) => {
    if (!forwardMessage || forwardSending) {
      return targets.map((target) => target.chatId);
    }
    return forwardMessageAction({
      message: forwardMessage,
      targets,
      resolveMessageKey,
      setForwardSending,
      setForwardMessage,
      pushToast: opts.pushToast,
    });
  };

  return {
    forwardMessage,
    setForwardMessage,
    forwardSending,
    forwardTargets,
    handleForwardMessage,
  };
}
