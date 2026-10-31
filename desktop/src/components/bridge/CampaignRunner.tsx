/**
 * 克制版群发引擎：单飞、走 dispatchSendText 门闸，不与普通队列混池。
 * 支持媒体：按 campaign.media + mediaMode 分配，走 sendImageMessage/sendFileMessage
 * （Baileys 与 Android Bridge 双通道）。
 */
import { useEffect, useRef } from "react";
import { dispatchSendText, normalizeChannelId } from "@/channels";
import { flushPersist, useAppStore } from "@/store/appStore";
import type { AppState } from "@/store/appStore";
import type { BroadcastCampaign, BroadcastItem } from "@/types/broadcast";
import { readMediaCache } from "@/lib/mediaCache";
import { sendImageMessage } from "../chat/sendImageMessage";
import { sendFileMessage } from "../chat/sendFileMessage";
import { openAndroidMediaShare as openAndroidMediaShareAction } from "../chat/openAndroidMediaShare";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { dataUrlToBlob } from "@/lib/mediaBlob";
import { isDeliveryUncertain } from "@/store/outgoingRetry";
import { MediaGateBlockedError } from "@/channels/mediaGate";
import { nextBatchTask } from "@/lib/scheduledPlans";

type CampaignSendResult = {
  ok: boolean;
  status?: string;
  message?: string;
  error?: string;
  retryAfterMs?: number;
  raw?: unknown;
};

/** 媒体与文本共用任务状态检查及“结果未知”处理。 */
async function sendBroadcastMedia(opts: {
  state: AppState;
  campaign: BroadcastCampaign;
  item: BroadcastItem;
  channelId: string;
  chatId: string;
  canSend: () => boolean;
}): Promise<CampaignSendResult> {
  const { state, campaign, item, channelId, chatId } = opts;
  const media = campaign.media || [];
  if (!media.length) return { ok: false, message: "战役没有媒体" };
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
  if (!picked) return { ok: false, message: "媒体选择失败" };

  const dataUrl = await readMediaCache(picked.id);
  if (!dataUrl) return { ok: false, message: "媒体缓存已失效，请重建战役" };
  let file: File;
  try {
    const blob = dataUrlToBlob(dataUrl, picked.mime, 14 * 1024 * 1024);
    file = new File([blob], picked.fileName || "broadcast-media", {
      type: picked.mime || "application/octet-stream",
    });
  } catch {
    return { ok: false, message: "读取媒体失败" };
  }

  const deps = {
    requiredMinGapSec: Math.max(20, campaign.extraGapSec || 20),
    persistBeforeSend: () => flushPersist(() => useAppStore.getState()),
    canSend: opts.canSend,
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
    enqueueOutgoingMessage: (input: Parameters<AppState["enqueueOutgoingMessage"]>[0]) => {
      const latest=useAppStore.getState();
      const previousId=latest.broadcastCampaigns.find(c=>c.id===campaign.id)?.items.find(i=>i.id===item.id)?.messageId;
      if(previousId&&latest.messages.some(m=>m.id===previousId&&m.systemKind==="broadcast_campaign"&&!isDeliveryUncertain(m)&&!["sent","server","delivered","read","played"].includes(m.deliveryStatus||""))){
        latest.updateMessageDelivery(previousId,{deliveryStatus:"pending",lastError:undefined,deliveryUncertain:false});return previousId;
      }
      const id = state.enqueueOutgoingMessage({ ...input, systemKind: "broadcast_campaign" });
      if (id) state.patchBroadcastItem(campaign.id, item.id, { messageId: id });
      return id;
    },
    chatId,
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
    const latest = useAppStore.getState();
    const messageId = latest.broadcastCampaigns.find(c => c.id === campaign.id)?.items.find(i => i.id === item.id)?.messageId;
    const message = latest.messages.find(m => m.id === messageId);
    if (ok) return { ok: true, status: message?.deliveryStatus === "local" ? "local" : "sent" };
    return { ok: false, message: message?.lastError || "媒体发送失败",
      error: message && isDeliveryUncertain(message) ? "baileys_delivery_unknown"
        : !opts.canSend() ? "automation_cancelled" : "send_failed" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "媒体发送异常",
      error: error instanceof MediaGateBlockedError ? error.gateError
        : error && typeof error === "object" && "deliveryUncertain" in error && error.deliveryUncertain
          ? "baileys_delivery_unknown" : "send_failed",
      retryAfterMs: error instanceof MediaGateBlockedError ? error.retryAfterMs : undefined };
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
        if (nextBatchTask(state.settings.scheduledPlans || [],state.broadcastCampaigns) !== campaign.id) return;

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
          state.pauseBroadcastCampaign(campaign.id);
          return;
        }

        const hasMedia = !!(campaign.media && campaign.media.length > 0);
        const canSend = () => {
          const latest = useAppStore.getState();
          const current = latest.broadcastCampaigns.find(c => c.id === campaign.id);
          return !cancelled && current?.status === "running" &&
            current.items.some(i => i.id === item.id && i.status === "sending") &&
            normalizeChannelId(latest.settings.sendChannel) === channelId;
        };

        // 复用已有气泡（限速/暂停后再试），避免重复出站行；仅文本路径需要
        let msgId = hasMedia ? null : (item.messageId || null);
        if (!hasMedia && msgId) {
          state.updateMessageDelivery(msgId, {
            deliveryStatus: "pending",
            lastError: undefined,
            deliveryUncertain: false,
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

        if (!hasMedia && !msgId) throw new Error("无法保存出站消息，群发已停止");
        // Persist the in-flight marker before transport, so a crash cannot silently resend it.
        await flushPersist(() => useAppStore.getState());
        let result: CampaignSendResult;
        if (hasMedia) {
          result = await sendBroadcastMedia({
            state,
            campaign,
            item,
            channelId,
            chatId,
            canSend,
          });
          msgId = useAppStore.getState().broadcastCampaigns.find(c => c.id === campaign.id)?.items.find(i => i.id === item.id)?.messageId || null;
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
              canSend,
              requiredMinGapSec: Math.max(20, campaign.extraGapSec || 20),
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
        if (latest.status === "cancelled" && !result.ok && result.error !== "baileys_delivery_unknown") {
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
              deliveryUncertain: false,
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
            err === "automation_cancelled" ||
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
            // 未知结果留在失败项，只能经人工核对重试；普通暂停项可继续。
            if (msgId) {
              useAppStore.getState().updateMessageDelivery(msgId, {
                deliveryStatus: "failed",
                lastError: result.message || err || "发送失败",
                deliveryUncertain: err === "baileys_delivery_unknown",
              });
            }
            useAppStore.getState().patchBroadcastItem(campaign.id, item.id, {
              status: err === "baileys_delivery_unknown" ? "failed" : "pending",
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
          useAppStore.getState().pauseBroadcastCampaign(campaign.id);
          useAppStore.getState().pushToast(`群发已暂停：${result.message || err || "发送失败"}`, "error");
          return;
        }

        // 每条重新抽取随机间隔，避免固定节奏。
        const gapMinSec = Math.max(20, campaign.extraGapSec || 20);
        const gapMaxSec = Math.max(gapMinSec, campaign.extraGapMaxSec || 30);
        const gapSec = gapMinSec + Math.random() * (gapMaxSec - gapMinSec);
        await new Promise((r) => setTimeout(r, Math.round(gapSec * 1000)));

        useAppStore.getState().completeBroadcastCampaignIfIdle(campaign.id);
      } catch (e) {
        const uncertain = !!e && typeof e === "object" && "deliveryUncertain" in e && e.deliveryUncertain === true;
        const detail = e instanceof Error ? e.message : String(e);
        const msg = uncertain ? `发送结果未知：${detail}` : detail;
        const state = useAppStore.getState();
        const campaign = (state.broadcastCampaigns || []).find((c) =>
          c.items.some((item) => item.status === "sending")
        );
        if (campaign) {
          state.pauseBroadcastCampaign(campaign.id);
          const item = campaign.items.find((i) => i.status === "sending");
          if (item) {
            if (item.messageId) {
              state.updateMessageDelivery(item.messageId, {
                deliveryStatus: "failed",
                lastError: msg.slice(0, 160),
                deliveryUncertain: uncertain,
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
