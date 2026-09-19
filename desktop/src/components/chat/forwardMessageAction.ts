import { baileysForwardMessage } from "@/lib/baileys";
import { gatedMediaSend } from "@/channels/mediaGate";
import type { AppState } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { translateCurrent } from "@/i18n";
import type { ForwardTarget } from "./ForwardMessageModal";

type MessageKey = {
  id: string;
  remoteJid: string;
  fromMe?: boolean;
};

type ForwardMessageActionDeps = {
  message: Message;
  targets: ForwardTarget[];
  resolveMessageKey: (message: Message) => MessageKey | null;
  setForwardSending: (sending: boolean) => void;
  setForwardMessage: (message: Message | null) => void;
  pushToast: AppState["pushToast"];
};

export async function forwardMessage({
  message,
  targets,
  resolveMessageKey,
  setForwardSending,
  setForwardMessage,
  pushToast,
}: ForwardMessageActionDeps) {
  const key = resolveMessageKey(message);
  if (!key) {
    pushToast(translateCurrent("runtime.forwardMissingId"), "error");
    return targets.map((target) => target.chatId);
  }
  setForwardSending(true);
  try {
    const results = await Promise.allSettled(
      targets.map((target) =>
        gatedMediaSend(
          { phoneE164: target.recipient, accountId: target.accountId },
          () => baileysForwardMessage(target.recipient, key, target.accountId)
        )
      )
    );
    const failed = targets.filter((_, index) => results[index]?.status === "rejected");
    const sent = targets.length - failed.length;
    if (sent) {
      pushToast(`已转发到 ${sent} 个会话`, "success");
    }
    if (failed.length) {
      const names = failed.slice(0, 3).map((target) => target.label).join("、");
      pushToast(
        `${failed.length} 个会话转发失败：${names}${failed.length > 3 ? "…" : ""}`,
        "error"
      );
    } else {
      setForwardMessage(null);
    }
    return failed.map((target) => target.chatId);
  } finally {
    setForwardSending(false);
  }
}
