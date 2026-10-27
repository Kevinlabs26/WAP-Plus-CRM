import { useEffect, useRef } from "react";
import {
  dispatchSendText,
  normalizeChannelId,
  type ChannelId,
} from "@/channels";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { isRetryableOutgoing } from "@/store/outgoingRetry";
import {
  isWaAccountConnected,
  resolveWaSendAccountId,
} from "@/lib/accountConnection";
import { canSendAutoReply } from "@/lib/aiSafety";
import { currentAutoReplyContext, hashAiReplyContext } from "@/lib/aiReplyContext";
import { translateCurrent } from "@/i18n";

const MAX_AUTO_RETRIES = 5;

function backoffMs(retryCount: number, hintMs?: number): number {
  if (hintMs && hintMs > 0) return Math.min(hintMs, 15 * 60_000);
  const base = 2000 * Math.pow(2, Math.max(0, retryCount));
  return Math.min(base, 5 * 60_000);
}

function isTransientError(result: {
  error?: string;
  message?: string;
  status?: string;
}): boolean {
  const err = `${result.error || ""} ${result.message || ""}`.toLowerCase();
  if (result.error === "rate_limited") return true;
  if (result.error === "overheated" || result.error === "send_paused")
    return false;
  if (result.error === "baileys_delivery_unknown") return false;
  if (result.error === "baileys_not_connected") return true;
  if (result.status === "queued") return true;
  return (
    err.includes("fetch") ||
    err.includes("timeout") ||
    err.includes("network") ||
    err.includes("econn") ||
    err.includes("不可用") ||
    err.includes("未连接") ||
    err.includes("disconnect") ||
    err.includes("429") ||
    err.includes("rate")
  );
}

/**
 * 轻量出站队列：轮询 queued/failed 消息，断线/限速后自动重试。
 * 不阻塞 UI；与 ChatPanel 手动「重试」共用 updateMessageDelivery。
 */
export function SendQueueWatcher() {
  const inflightAccounts = useRef(new Set<string>());
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const accountFor = (msg: Message, state = useAppStore.getState()) => resolveWaSendAccountId(
      state.settings.waAccounts,
      msg.accountId || state.contacts.find(c => c.id === msg.contactId)?.accountId ||
        state.settings.liveBaileysAccountId || state.settings.activeAccountId,
      state.settings.liveBaileysAccountId,
      state.baileysUi.connection
    );

    const flushOne = async (queued: Message) => {
      // 前一条的网络请求期间，用户可能取消、删除或推迟了本条消息。
      let state = useAppStore.getState();
      let msg = state.messages.find((item) => item.id === queued.id);
      if (!msg || !isRetryableOutgoing(msg)) return;
      if (state.settings.scheduledMessages?.some(
        (task) => task.messageId === queued.id && task.status === "cancelled"
      )) return;
      if (inflight.current.has(msg.id)) return;
      if (!msg.phoneE164 || !msg.body) return;
      // 媒体由聊天面板按原 data URL 重试，不能退化成占位文本发送。
      if (msg.mediaType) return;

      let settings = state.settings;
      const aiContextKey = msg.systemKind === "ai_auto_reply" ? currentAutoReplyContext(state, msg) : null;
      if (msg.systemKind === "ai_auto_reply") {
        let verified = false;
        if (aiContextKey && msg.aiReplyContextHash && canSendAutoReply(settings, state.messages, msg)) {
          try { verified = await hashAiReplyContext(aiContextKey) === msg.aiReplyContextHash; }
          catch { /* 无法校验时交给人工，不能每轮重试未知的自动回复。 */ }
        }
        if (cancelled) return;
        const latest = useAppStore.getState();
        const current = latest.messages.find((item) => item.id === queued.id);
        // 摘要校验会让出执行权；不能复活期间取消、删除或推迟的消息。
        if (!current || !isRetryableOutgoing(current) || current.body !== msg.body ||
            current.phoneE164 !== msg.phoneE164 || current.accountId !== msg.accountId || current.channelId !== msg.channelId ||
            current.aiReplyContextHash !== msg.aiReplyContextHash ||
            latest.settings.scheduledMessages?.some(task => task.messageId === current.id && task.status === "cancelled")) return;
        if (!verified || currentAutoReplyContext(latest, current) !== aiContextKey) {
          latest.updateMessageDelivery(current.id, {
            deliveryStatus: "failed", retryCount: MAX_AUTO_RETRIES, nextAttemptAt: undefined,
            lastError: "自动回复无法验证当前配置和上下文，请重新生成或手动撰写回复",
          });
          return;
        }
        state = latest;
        msg = current;
        settings = latest.settings;
      }
      const channelId = normalizeChannelId(
        msg.channelId || settings.sendChannel
      ) as ChannelId;
      if (msg.accountId && channelId === "baileys" &&
          !settings.waAccounts.some((account) => account.id === msg.accountId)) {
        state.updateMessageDelivery(msg.id, {
          deliveryStatus: "failed",
          lastError: translateCurrent("runtime.originalAccountMissing"),
          retryCount: MAX_AUTO_RETRIES,
          nextAttemptAt: undefined,
        });
        return;
      }
      const accountId = accountFor(msg, state);

      if (
        channelId === "baileys" &&
        !isWaAccountConnected(
          settings.waAccounts,
          accountId,
          settings.liveBaileysAccountId,
          state.baileysUi.connection
        )
      ) {
        // 未连接：推迟重试，避免 listRetryable 一直捞同一批空转
        const next = new Date(Date.now() + 5000).toISOString();
        if (!msg.nextAttemptAt || Date.parse(msg.nextAttemptAt) <= Date.now()) {
          state.updateMessageDelivery(msg.id, {
            deliveryStatus: "queued",
            lastError:
              msg.lastError || translateCurrent("runtime.queueWaitingConnection"),
            nextAttemptAt: next,
          });
        }
        return;
      }

      if (!msg.phoneE164 || !msg.body) return;
      inflight.current.add(msg.id);
      const attempt = (msg.retryCount ?? 0) + 1;
      state.updateMessageDelivery(msg.id, {
        deliveryStatus: "pending",
        lastError: undefined,
        retryCount: attempt,
      });

      try {
        const result = await dispatchSendText(
          {
            text: msg.body,
            phoneE164: msg.phoneE164,
            contactId: msg.contactId,
            deviceId: msg.deviceId ?? state.selectedPhoneId,
            accountId,
            ...(msg.quoted?.remoteJid ? { quoted: msg.quoted } : {}),
          },
          {
            channelId,
            canSend: msg.systemKind === "ai_auto_reply" ? () => {
              const latest = useAppStore.getState();
              const message = latest.messages.find((item) => item.id === msg.id);
              return !!message && message.deliveryStatus === "pending" &&
                currentAutoReplyContext(latest, message) === aiContextKey &&
                canSendAutoReply(latest.settings, latest.messages, message);
            } : undefined,
            rateLimitEnabled: settings.rateLimitEnabled !== false,
            rateLimits: {
              perPhonePerMinute: settings.ratePerMinute,
              perPhonePerHour: settings.ratePerHour,
              minIntervalSec: settings.rateMinIntervalSec,
            },
            blockSendWhenOverheated: settings.blockSendWhenOverheated !== false,
            sendPausedAccountIds: settings.sendPausedAccountIds || [],
            rateJitterSec: settings.rateJitterSec ?? 2,
            globalMinGapSec: settings.globalMinGapSec ?? 2,
            messages: state.messages,
            waAccounts: settings.waAccounts,
          }
        );

        if (cancelled) return;

        if (result.ok) {
          const waId = (() => {
            const raw = result.raw as { id?: string } | undefined;
            return raw && typeof raw.id === "string" ? raw.id : undefined;
          })();
          useAppStore.getState().updateMessageDelivery(msg.id, {
            deliveryStatus:
              result.status === "local" ? "local" : "sent",
            lastError: undefined,
            nextAttemptAt: undefined,
            ...(waId ? { waMessageId: waId } : {}),
          });
          return;
        }

        const rateLimited = result.error === "rate_limited";
        const transient = isTransientError(result);
        // 冷却/限速本身就是可恢复状态，不消耗普通瞬时错误的重试额度。
        const canRetry = rateLimited || (transient && attempt < MAX_AUTO_RETRIES);
        const wait = backoffMs(attempt, result.retryAfterMs);
        useAppStore.getState().updateMessageDelivery(msg.id, {
          deliveryStatus: canRetry ? "queued" : "failed",
          deliveryUncertain: result.error === "baileys_delivery_unknown",
          lastError:
            result.message || result.error || translateCurrent("runtime.sendFailed"),
          ...(rateLimited ? { retryCount: Math.max(0, attempt - 1) } : {}),
          nextAttemptAt: canRetry
            ? new Date(Date.now() + wait).toISOString()
            : undefined,
        });
      } catch (e) {
        if (cancelled) return;
        const text = e instanceof Error ? e.message : String(e);
        useAppStore.getState().updateMessageDelivery(msg.id, {
          // 请求抛异常时无法确认 WhatsApp 是否已经收到，禁止自动重发，
          // 避免把一次未知结果变成重复消息。
          deliveryStatus: "failed",
          lastError: translateCurrent("runtime.sendUnknown", {
            reason: text.slice(0, 120),
          }),
          deliveryUncertain: true,
          retryCount: MAX_AUTO_RETRIES,
          nextAttemptAt: undefined,
        });
      } finally {
        inflight.current.delete(msg.id);
      }
    };

    const tick = () => {
      if (cancelled) return;
      const state = useAppStore.getState();
      const due = state.listRetryableOutgoing().filter(msg =>
        !msg.mediaType && isRetryableOutgoing(msg) &&
        !state.settings.scheduledMessages?.some(task => task.messageId === msg.id && task.status === "cancelled")
      ).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      for (const msg of due) {
        if (cancelled || inflightAccounts.current.size >= 3) break;
        const account = accountFor(msg, state) || msg.deviceId || "legacy";
        if (inflightAccounts.current.has(account) || inflight.current.has(msg.id)) continue;
        inflightAccounts.current.add(account);
        // 同号保序；慢账号不占住其它账号的重试，发送仍经过统一限速门闸。
        void flushOne(msg).catch(error => {
          if (!cancelled) useAppStore.getState().pushToast(String(error), "error");
        }).finally(() => {
          inflightAccounts.current.delete(account);
          if (!cancelled) {
            const current = useAppStore.getState().messages.find(item => item.id === msg.id);
            if (!current || !isRetryableOutgoing(current)) tick();
          }
        });
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
