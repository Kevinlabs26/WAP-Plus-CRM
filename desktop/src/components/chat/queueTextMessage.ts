import type { AppState } from "@/store/appStore";
import type { TranslationKey } from "../../i18n/core";

type QueueTextDeps = {
  text: string;
  chatId: string | null;
  recipient: string;
  contactId: string;
  channelId: string;
  deviceId: string | null;
  accountId?: string | null;
  softReconnect: boolean;
  needsScan: boolean;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  pushToast: AppState["pushToast"];
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  translate?: (key: TranslationKey) => string;
};

export function queueTextMessage({
  text,
  chatId,
  recipient,
  contactId,
  channelId,
  deviceId,
  accountId,
  softReconnect,
  needsScan,
  enqueueOutgoingMessage,
  pushToast,
  setBaileysLoginOpen,
  translate: translateFn,
}: QueueTextDeps) {
  const translate = translateFn || ((key: TranslationKey) =>
    key === "runtime.queueConnectionRestored"
      ? "线路重连中，消息已排队，恢复后自动发送"
      : key === "runtime.queueWaitingLogin"
        ? "未登录，已加入队列 — 请扫码"
        : "未连接，已加入发送队列");
  const id = enqueueOutgoingMessage({
    body: text,
    chatId,
    phoneE164: recipient,
    contactId,
    channelId,
    deviceId,
    accountId: accountId || undefined,
    deliveryStatus: "queued",
    lastError: softReconnect
      ? translate("runtime.queueConnectionRestored")
      : needsScan
        ? translate("runtime.queueWaitingLogin")
        : translate("runtime.queueWaitingConnection"),
    nextAttemptAt: new Date(Date.now() + (softReconnect ? 2500 : 1000)).toISOString(),
  });
  if (!id) return null;

  pushToast(
    softReconnect
      ? translate("runtime.queueConnectionRestored")
      : needsScan
        ? translate("runtime.queueWaitingLogin")
        : translate("runtime.queueWaitingConnection"),
    "info"
  );
  if (needsScan) setBaileysLoginOpen(true);
  return id;
}
