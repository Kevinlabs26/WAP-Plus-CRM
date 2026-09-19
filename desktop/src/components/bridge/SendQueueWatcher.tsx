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
  const flushLock = useRef(false);
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const flushOne = async (queued: Message) => {
      // 前一条的网络请求期间，用户可能取消、删除或推迟了本条消息。
      const state = useAppStore.getState();
      const msg = state.messages.find((item) => item.id === queued.id);
      if (!msg || !isRetryableOutgoing(msg)) return;
      if (state.settings.scheduledMessages?.some(
        (task) => task.messageId === msg.id && task.status === "cancelled"
      )) return;
      if (inflight.current.has(msg.id)) return;
      if (!msg.phoneE164 || !msg.body) return;
      // 媒体由聊天面板按原 data URL 重试，不能退化成占位文本发送。
      if (msg.mediaType) return;

      const settings = state.settings;
      const channelId = normalizeChannelId(
        msg.channelId || settings.sendChannel
      ) as ChannelId;
      if (msg.accountId && channelId === "baileys" &&
          !settings.waAccounts.some((account) => account.id === msg.accountId)) {
        state.updateMessageDelivery(msg.id, {
          deliveryStatus: "failed",
          lastError: "原发送账号不存在",
          retryCount: MAX_AUTO_RETRIES,
          nextAttemptAt: undefined,
        });
        return;
      }
      const requestedAccountId =
        msg.accountId ||
        (msg.contactId
          ? state.contacts.find((c) => c.id === msg.contactId)?.accountId
          : undefined) ||
        settings.liveBaileysAccountId ||
        settings.activeAccountId;
      const accountId = resolveWaSendAccountId(
        settings.waAccounts,
        requestedAccountId,
        settings.liveBaileysAccountId,
        state.baileysUi.connection
      );

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
            lastError: msg.lastError || "等待 WhatsApp 连接",
            nextAttemptAt: next,
          });
        }
        return;
      }

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

        const transient = isTransientError(result);
        const canRetry = transient && attempt < MAX_AUTO_RETRIES;
        const wait = backoffMs(attempt, result.retryAfterMs);
        useAppStore.getState().updateMessageDelivery(msg.id, {
          deliveryStatus: canRetry ? "queued" : "failed",
          lastError: result.message || result.error || "发送失败",
          nextAttemptAt: canRetry
            ? new Date(Date.now() + wait).toISOString()
            : undefined,
        });
      } catch (e) {
        if (cancelled) return;
        const text = e instanceof Error ? e.message : String(e);
        const canRetry = attempt < MAX_AUTO_RETRIES;
        useAppStore.getState().updateMessageDelivery(msg.id, {
          deliveryStatus: canRetry ? "queued" : "failed",
          lastError: text.slice(0, 160),
          nextAttemptAt: canRetry
            ? new Date(Date.now() + backoffMs(attempt)).toISOString()
            : undefined,
        });
      } finally {
        inflight.current.delete(msg.id);
      }
    };

    const tick = async () => {
      if (cancelled || flushLock.current) return;
      flushLock.current = true;
      try {
        const due = useAppStore
          .getState()
          .listRetryableOutgoing()
          .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
          .slice(0, 3);
        for (const msg of due) {
          if (cancelled) break;
          await flushOne(msg);
        }
      } finally {
        flushLock.current = false;
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
