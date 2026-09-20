import { computeAccountHealth } from "@/lib/accountHealth";
import {
  dispatchSendText,
  sendRuntimeFromSettings,
  type ChannelId,
} from "@/channels";
import type { AppState, AppSettings } from "@/store/appStore";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { translateCurrent } from "@/i18n";

type QuotedMessage = {
  id: string;
  remoteJid: string;
  fromMe?: boolean;
  participant?: string;
  body: string;
};

type SendTextDeps = {
  msgId: string;
  text: string;
  recipient: string;
  contact: Contact;
  activeChat: ChatPreview | undefined;
  selectedPhoneId: string | null;
  channelId: ChannelId;
  chatAccountId: string;
  settings: Pick<
    AppSettings,
    | "rateLimitEnabled"
    | "blockSendWhenOverheated"
    | "ratePerMinute"
    | "ratePerHour"
    | "rateMinIntervalSec"
    // 门闸完整配置：缺失会导致暂停/新号 warmup/跨号间隔保护失效
    | "sendPausedAccountIds"
    | "rateJitterSec"
    | "globalMinGapSec"
    | "waAccounts"
    | "sendChannel"
  >;
  messages: Message[];
  quoted?: QuotedMessage;
  mentionedJid?: string[];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  setReplyTo: (value: null) => void;
  clearDraft: () => void;
  clearMentions: () => void;
  setSending: (value: boolean) => void;
  pushToast: AppState["pushToast"];
};

export async function sendTextMessage({
  msgId,
  text,
  recipient,
  contact,
  activeChat,
  selectedPhoneId,
  channelId,
  chatAccountId,
  settings,
  messages,
  quoted,
  mentionedJid,
  updateMessageDelivery,
  setBaileysLoginOpen,
  setReplyTo,
  clearDraft,
  clearMentions,
  setSending,
  pushToast,
}: SendTextDeps) {
  try {
    const sendAid =
      chatAccountId ||
      activeChat?.accountId ||
      contact.accountId ||
      "";
    if (settings.blockSendWhenOverheated !== false && sendAid) {
      const health = computeAccountHealth({
        accountId: sendAid,
        messages,
        caps: {
          perPhonePerHour: settings.ratePerHour,
          perPhonePerMinute: settings.ratePerMinute,
          minIntervalSec: settings.rateMinIntervalSec,
        },
      });
      if (health.level === "red") {
        updateMessageDelivery(msgId, {
          deliveryStatus: "failed",
          lastError: health.summary,
        });
        pushToast(
          translateCurrent("runtime.sendBlocked", { summary: health.summary }),
          "error"
        );
        return;
      }
    }

    const result = await dispatchSendText(
      {
        text,
        phoneE164: recipient,
        displayName: contact.name,
        deviceId: selectedPhoneId,
        contactId: contact.id,
        accountId: sendAid || undefined,
        ...(quoted ? { quoted } : {}),
        ...(mentionedJid?.length ? { mentionedJid } : {}),
      },
      {
        // 统一从 settings 拼完整门闸运行时（暂停/warmup/全局间隔/jitter），
        // 仅覆盖调用方解析出的通道 id，避免与 settings.sendChannel 漂移。
        ...sendRuntimeFromSettings(settings, messages),
        channelId,
      }
    );

    if (result.status === "unsupported") {
      updateMessageDelivery(msgId, {
        deliveryStatus: "failed",
        lastError: result.message,
      });
      pushToast(result.message, "error");
      return;
    }

    if (!result.ok) {
      const rateLimited = result.error === "rate_limited";
      const notConnected = result.error === "baileys_not_connected";
      const deliveryUnknown = result.error === "baileys_delivery_unknown";
      if (notConnected) setBaileysLoginOpen(true);
      const wait =
        result.retryAfterMs && result.retryAfterMs > 0
          ? result.retryAfterMs
          : rateLimited
            ? 5000
            : 3000;
      const queue =
        !deliveryUnknown &&
        (rateLimited ||
          notConnected ||
          result.status === "queued" ||
          /fetch|timeout|network|429/i.test(
            `${result.error || ""} ${result.message || ""}`
          ));
      updateMessageDelivery(msgId, {
        deliveryStatus: queue ? "queued" : "failed",
        lastError: result.message || result.error || translateCurrent("runtime.sendFailed"),
        nextAttemptAt: queue
          ? new Date(Date.now() + wait).toISOString()
          : undefined,
      });
      pushToast(
        queue
          ? result.message || translateCurrent("runtime.queueRetry")
          : result.message || result.error || translateCurrent("runtime.sendFailed"),
        queue ? "info" : "error"
      );
      return;
    }

    const raw = result.raw as { id?: string; jid?: string } | undefined;
    const waId = raw && typeof raw.id === "string" ? raw.id : undefined;
    const remoteJid =
      (raw && typeof raw.jid === "string" && raw.jid) ||
      (recipient.includes("@")
        ? recipient
        : recipient
          ? `${recipient.replace(/\D/g, "")}@s.whatsapp.net`
          : "");
    updateMessageDelivery(msgId, {
      deliveryStatus: result.status === "local" ? "local" : "sent",
      lastError: undefined,
      nextAttemptAt: undefined,
      ...(waId ? { waMessageId: waId } : {}),
      ...(waId && remoteJid
        ? { waKey: { id: waId, remoteJid, fromMe: true } }
        : {}),
    });
    setReplyTo(null);
    clearMentions();
    clearDraft();
    pushToast(result.message || translateCurrent("runtime.sent"), "success");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = translateCurrent("runtime.sendUnknown", {
      reason: detail.slice(0, 120),
    });
    updateMessageDelivery(msgId, {
      // 请求异常时无法确认是否已送达，只能交给人工核对后再重试。
      deliveryStatus: "failed",
      lastError: message,
      nextAttemptAt: undefined,
    });
    pushToast(message, "error");
  } finally {
    setSending(false);
  }
}
