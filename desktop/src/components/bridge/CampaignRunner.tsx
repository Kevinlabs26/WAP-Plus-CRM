/**
 * 克制版群发引擎：单飞、走 dispatchSendText 门闸，不与普通队列混池。
 * 支持媒体：按 campaign.media + mediaMode 分配，走 sendImageMessage/sendFileMessage
 * （Baileys 与 Android Bridge 双通道）。
 */
import { useEffect, useRef } from "react";
import { dispatchSendText, normalizeChannelId } from "@/channels";
import { useAppStore } from "@/store/appStore";
import type { AppState } from "@/store/appStore";
import type { BroadcastCampaign, BroadcastItem } from "@/types/broadcast";
import { readMediaCache } from "@/lib/mediaCache";
import { sendImageMessage } from "../chat/sendImageMessage";
import { sendFileMessage } from "../chat/sendFileMessage";
import { openAndroidMediaShare as openAndroidMediaShareAction } from "../chat/openAndroidMediaShare";
import { isWaAccountConnected } from "@/lib/accountConnection";

/** 按 mediaMode 给条目挑一份媒体并发送（双通道）；返回 null=成功，字符串=失败原因 */
async function sendBroadcastMedia(opts: {
  state: AppState;
  campaign: BroadcastCampaign;
  item: BroadcastItem;
  channelId: string;
}): Promise<string | null> {
  const { state, campaign, item, channelId } = opts;
  const media = campaign.media || [];
  if (!media.length) return "战役没有媒体";
  const isBaileys = normalizeChannelId(channelId) === "baileys";

  let picked = media[0];
  if (media.length > 1) {
    if (campaign.mediaMode === "random") {
      picked = media[Math.floor(Math.random() * media.length)];
    } else if (campaign.mediaMode === "roundrobin") {
      const idx = campaign.items.findIndex((i) => i.id === item.id);
      picked = media[Math.max(0, idx) % media.length];
    }
  }
  if (!picked) return "媒体选择失败";

  const dataUrl = await readMediaCache(picked.id);
  if (!dataUrl) return "媒体缓存已失效，请重建战役";
  let file: File;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    file = new File([blob], picked.fileName || "broadcast-media", {
      type: picked.mime || "application/octet-stream",
    });
  } catch {
    return "读取媒体失败";
  }

  const deps = {
    sending: false,
    stickToBottom: () => {},
    resolveRecipient: () => ({
      contact: { id: item.contactId },
      recipient: item.phoneE164,
    }),
    // 广播逐条不弹 toast（进度面板可见），失败靠 item.error 记录
    pushToast: () => {},
    isBaileys,
    chatConnected: isBaileys
      ? isWaAccountConnected(
          state.settings.waAccounts,
          campaign.accountId,
          state.settings.liveBaileysAccountId,
          state.baileysUi.connection
        )
      : state.bridge.connected,
    setBaileysLoginOpen: state.setBaileysLoginOpen,
    setSending: () => {},
    toStickerDataUrl: async () => "",
    getDraftReply: () => "",
    setDraftReply: () => {},
    enqueueOutgoingMessage: state.enqueueOutgoingMessage,
    patchMessage: state.patchMessage,
    updateMessageDelivery: state.updateMessageDelivery,
    channelId: normalizeChannelId(channelId),
    selectedPhoneId: state.selectedPhoneId,
    chatAccountId: campaign.accountId,
    openAndroidMediaShare: (
      f: File,
      d: string,
      caption: string,
      phoneE164: string
    ) =>
      openAndroidMediaShareAction({
        file: f,
        dataUrl: d,
        caption,
        phoneE164,
        selectedPhoneId: state.selectedPhoneId,
      }),
  };

  const caption = item.bodyRendered || undefined;
  try {
    const ok =
      picked.kind === "image"
        ? await sendImageMessage(file, false, caption, deps)
        : await sendFileMessage(file, caption, deps);
    return ok ? null : "媒体发送失败";
  } catch {
    return "媒体发送异常";
  }
}

const TICK_MS = 900;

export function CampaignRunner() {
  const lock = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled || lock.current) return;
      lock.current = true;
      try {
        const state = useAppStore.getState();
        if (!state.hydrated || !state.uiReady) return;

        const campaign = (state.broadcastCampaigns || []).find(
          (c) => c.status === "running"
        );
        if (!campaign) return;

        const settings = state.settings;
        if ((settings.sendPausedAccountIds || []).includes(campaign.accountId)) {
          state.pauseBroadcastCampaign(campaign.id);
          state.pushToast("群发已暂停：账号在监测中被暂停发送", "info");
          return;
        }

        const channelId = normalizeChannelId(settings.sendChannel);
        if (
          channelId === "baileys" &&
          !isWaAccountConnected(
            settings.waAccounts,
            campaign.accountId,
            settings.liveBaileysAccountId,
            state.baileysUi.connection
          )
        ) {
          state.pauseBroadcastCampaign(campaign.id);
          state.pushToast("群发已暂停：WhatsApp 未连接", "info");
          return;
        }

        const item = campaign.items.find((i) => i.status === "pending");
        if (!item) {
          state.completeBroadcastCampaignIfIdle(campaign.id);
          return;
        }

        // 标记 sending
        state.patchBroadcastItem(campaign.id, item.id, {
          status: "sending",
          error: undefined,
        });

        const chatId = state.ensureChatForContact(
          item.contactId,
          campaign.accountId
        );
        if (!chatId) {
          state.patchBroadcastItem(campaign.id, item.id, {
            status: "failed",
            error: "无法创建会话",
          });
          return;
        }

        const hasMedia = !!(campaign.media && campaign.media.length > 0);

        // 复用已有气泡（限速/暂停后再试），避免重复出站行；仅文本路径需要
        let msgId = hasMedia ? null : (item.messageId || null);
        if (!hasMedia && msgId) {
          state.updateMessageDelivery(msgId, {
            deliveryStatus: "pending",
            lastError: undefined,
          });
        } else if (!hasMedia) {
          msgId = state.enqueueOutgoingMessage({
            body: item.bodyRendered,
            chatId,
            contactId: item.contactId,
            phoneE164: item.phoneE164,
            channelId,
            accountId: campaign.accountId,
            deviceId: state.selectedPhoneId,
            deliveryStatus: "pending",
            // 禁止 SendQueueWatcher 自动重试（与战役 runner 双发）
            systemKind: "broadcast_campaign",
          });
          if (msgId) {
            state.patchBroadcastItem(campaign.id, item.id, {
              messageId: msgId,
            });
          }
        }

        let result: {
          ok: boolean;
          delivered?: boolean;
          status?: string;
          message?: string;
          error?: string;
          retryAfterMs?: number;
          raw?: unknown;
        };
        if (hasMedia) {
          const mediaErr = await sendBroadcastMedia({
            state,
            campaign,
            item,
            channelId,
          });
          result = mediaErr === null
            ? { ok: true, delivered: true, status: "sent", message: "已发送" }
            : {
                ok: false,
                delivered: false,
                status: "failed",
                error: "send_failed",
                message: mediaErr || "媒体发送失败",
              };
        } else {
          result = await dispatchSendText(
            {
              text: item.bodyRendered,
              phoneE164: item.phoneE164,
              displayName: item.contactName,
              contactId: item.contactId,
              accountId: campaign.accountId,
              deviceId: state.selectedPhoneId,
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
              messages: useAppStore.getState().messages,
              waAccounts: settings.waAccounts,
            }
          );
        }

        if (cancelled) return;

        // 战役可能已被用户暂停/取消
        const latest = useAppStore
          .getState()
          .broadcastCampaigns.find((c) => c.id === campaign.id);
        if (!latest) {
          if (msgId) {
            useAppStore.getState().updateMessageDelivery(msgId, {
              deliveryStatus: "local",
              lastError: "群发记录不存在，发送结果未知",
            });
          }
          return;
        }

        // 取消只能阻止尚未发送的条目；在途请求成功则照实记 sent，
        // 失败则收口为 skipped，不能重新回到 pending。
        if (latest.status === "cancelled" && !result.ok) {
          if (msgId) {
            useAppStore.getState().updateMessageDelivery(msgId, {
              deliveryStatus: "local",
              lastError: "战役已取消",
            });
          }
          useAppStore.getState().patchBroadcastItem(campaign.id, item.id, {
            status: "skipped",
            error: "战役已取消",
            messageId: msgId || undefined,
          });
          return;
        }

        if (result.ok) {
          const waId = (() => {
            const raw = result.raw as { id?: string } | undefined;
            return raw && typeof raw.id === "string" ? raw.id : undefined;
          })();
          if (msgId) {
            useAppStore.getState().updateMessageDelivery(msgId, {
              deliveryStatus: result.status === "local" ? "local" : "sent",
              lastError: undefined,
              ...(waId ? { waMessageId: waId } : {}),
            });
          }
          useAppStore.getState().patchBroadcastItem(campaign.id, item.id, {
            status: "sent",
            sentAt: new Date().toISOString(),
            messageId: msgId || undefined,
            error: undefined,
          });
        } else {
          const err = result.error || "";
          const hard =
            err === "overheated" ||
            err === "send_paused" ||
            err === "baileys_not_connected" ||
            err === "baileys_delivery_unknown";

          if (err === "rate_limited") {
            // 气泡保持 pending（队列不捡 pending）；战役 item 仍 pending 待 runner 再试
            if (msgId) {
              useAppStore.getState().updateMessageDelivery(msgId, {
                deliveryStatus: "pending",
                lastError: result.message || "限速冷却中",
              });
            }
            useAppStore.getState().patchBroadcastItem(campaign.id, item.id, {
              status: "pending",
              error: result.message || "限速冷却中",
            });
            const wait = Math.min(
              result.retryAfterMs && result.retryAfterMs > 0
                ? result.retryAfterMs
                : 8000,
              120_000
            );
            await new Promise((r) => setTimeout(r, wait));
            return;
          }

          if (hard) {
            // failed + systemKind=broadcast → 队列跳过；战役暂停后由用户继续再发
            if (msgId) {
              useAppStore.getState().updateMessageDelivery(msgId, {
                deliveryStatus: "failed",
                lastError: result.message || err || "发送失败",
              });
            }
            useAppStore.getState().patchBroadcastItem(campaign.id, item.id, {
              status: "pending",
              error: result.message || err,
            });
            useAppStore.getState().pauseBroadcastCampaign(campaign.id);
            useAppStore
              .getState()
              .pushToast(
                `群发已暂停：${result.message || err}`,
                "error"
              );
            return;
          }

          if (msgId) {
            useAppStore.getState().updateMessageDelivery(msgId, {
              deliveryStatus: "failed",
              lastError: result.message || err || "发送失败",
            });
          }
          useAppStore.getState().patchBroadcastItem(campaign.id, item.id, {
            status: "failed",
            error: (result.message || err || "发送失败").slice(0, 200),
          });
        }

        // 每条重新抽取随机间隔，避免固定节奏。
        const gapMinSec = Math.max(5, campaign.extraGapSec || 20);
        const gapMaxSec = Math.max(gapMinSec, campaign.extraGapMaxSec || 30);
        const gapSec = gapMinSec + Math.random() * (gapMaxSec - gapMinSec);
        await new Promise((r) => setTimeout(r, Math.round(gapSec * 1000)));

        useAppStore.getState().completeBroadcastCampaignIfIdle(campaign.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const state = useAppStore.getState();
        const campaign = (state.broadcastCampaigns || []).find((c) =>
          c.items.some((item) => item.status === "sending")
        );
        if (campaign) {
          const item = campaign.items.find((i) => i.status === "sending");
          if (item) {
            if (item.messageId) {
              state.updateMessageDelivery(item.messageId, {
                deliveryStatus: "failed",
                lastError: msg.slice(0, 160),
              });
            }
            state.patchBroadcastItem(campaign.id, item.id, {
              status: "failed",
              error: msg.slice(0, 200),
            });
          }
        }
      } finally {
        lock.current = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, TICK_MS);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
