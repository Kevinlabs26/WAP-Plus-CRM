import {
  buildCampaignOrError,
  trimCampaigns,
} from "@/lib/broadcastCampaign";
import type { AppState, SliceContext } from "./types";
import { accountCreatedAtOf, persist } from "./persist";
import {
  contactSendablePhone,
  parseBroadcastPhones,
} from "@/lib/broadcastTemplate";

export function createBroadcastSlice({
  set,
  get,
}: SliceContext): Pick<
  AppState,
  | "createBroadcastCampaign"
  | "startBroadcastCampaign"
  | "pauseBroadcastCampaign"
  | "resumeBroadcastCampaign"
  | "retryFailedBroadcastCampaign"
  | "cancelBroadcastCampaign"
  | "retireAccountMessaging"
  | "completeBroadcastCampaignIfIdle"
  | "patchBroadcastItem"
> {
  return {
    createBroadcastCampaign: (input) => {
      const state = get();
      const contactIds = [...input.contactIds];
      const contacts = [...state.contacts];
      for (const phone of parseBroadcastPhones((input.phoneNumbers || []).join("\n"))) {
        const existing = contacts.find(
          (contact) =>
            !contact.isGroup &&
            (!contact.accountId || contact.accountId === input.accountId) &&
            contactSendablePhone(contact) === phone
        );
        if (existing) {
          contactIds.push(existing.id);
          continue;
        }
        const id = `c-broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        contacts.push({
          id,
          name: "",
          phone,
          accountId: input.accountId,
          tags: [],
          stage: "new",
          source: "broadcast",
        });
        contactIds.push(id);
      }
      const res = buildCampaignOrError({
        accountId: input.accountId,
        template: input.template,
        contactIds,
        contacts,
        extraGapSec: input.extraGapSec,
        extraGapMaxSec: input.extraGapMaxSec,
        media: input.media,
        mediaMode: input.mediaMode,
        accountCreatedAt: accountCreatedAtOf(state.settings, input.accountId),
        rateLimits: {
          perPhonePerMinute: state.settings.ratePerMinute,
          perPhonePerHour: state.settings.ratePerHour,
          minIntervalSec: state.settings.rateMinIntervalSec,
        },
      });
      if (!res.ok) return { ok: false, reason: res.reason };
      set((s) => ({
        contacts,
        broadcastCampaigns: trimCampaigns([res.campaign, ...s.broadcastCampaigns]),
      }));
      persist(get);
      return { ok: true, id: res.campaign.id };
    },

    startBroadcastCampaign: (id) => {
      const state = get();
      const c = state.broadcastCampaigns.find((x) => x.id === id);
      if (!c) return { ok: false, reason: "战役不存在" };
      if (c.status === "running") return { ok: true };
      if (state.broadcastCampaigns.some((x) => x.id !== id && x.status === "running")) {
        return { ok: false, reason: "已有群发正在运行，请先暂停或结束" };
      }
      if (!c.items.some((i) => i.status === "pending")) {
        return { ok: false, reason: "没有待发送条目" };
      }
      set((s) => ({
        broadcastCampaigns: s.broadcastCampaigns.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "running",
                startedAt: x.startedAt || new Date().toISOString(),
                items: x.items.map((i) =>
                  i.status === "pending" ? { ...i, status: "pending", error: undefined } : i
                ),
              }
            : x
        ),
      }));
      persist(get);
      return { ok: true };
    },

    pauseBroadcastCampaign: (id) => {
      set((s) => ({
        broadcastCampaigns: s.broadcastCampaigns.map((x) =>
          x.id === id && x.status === "running" ? { ...x, status: "paused" } : x
        ),
      }));
      persist(get);
    },

    resumeBroadcastCampaign: (id) => {
      const state = get();
      const c = state.broadcastCampaigns.find((x) => x.id === id);
      if (!c) return { ok: false, reason: "战役不存在" };
      if (state.broadcastCampaigns.some((x) => x.id !== id && x.status === "running")) {
        return { ok: false, reason: "已有群发正在运行，请先暂停或结束" };
      }
      if (!c.items.some((i) => i.status === "pending")) {
        return { ok: false, reason: "没有待发送条目" };
      }
      set((s) => ({
        broadcastCampaigns: s.broadcastCampaigns.map((x) =>
          x.id === id ? { ...x, status: "running" } : x
        ),
      }));
      persist(get);
      return { ok: true };
    },

    retryFailedBroadcastCampaign: (id) => {
      const campaign = get().broadcastCampaigns.find((item) => item.id === id);
      const count = campaign?.items.filter((item) => item.status === "failed").length || 0;
      if (!count) return 0;
      set((state) => ({
        broadcastCampaigns: state.broadcastCampaigns.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "paused",
                finishedAt: undefined,
                items: item.items.map((entry) =>
                  entry.status === "failed"
                    ? { ...entry, status: "pending", error: undefined }
                    : entry
                ),
              }
            : item
        ),
      }));
      persist(get);
      return count;
    },

    cancelBroadcastCampaign: (id) => {
      set((s) => ({
        broadcastCampaigns: s.broadcastCampaigns.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "cancelled",
                finishedAt: x.finishedAt || new Date().toISOString(),
                items: x.items.map((i) =>
                  i.status === "pending"
                    ? { ...i, status: "skipped", error: "战役已取消" }
                    : i
                ),
              }
            : x
        ),
      }));
      persist(get);
    },

    retireAccountMessaging: (accountId) => {
      const now = new Date().toISOString();
      set((state) => {
        const scheduledMessages = (state.settings.scheduledMessages || []).map((task) =>
          task.accountId === accountId && (task.status === "pending" || task.status === "queued")
            ? { ...task, status: "cancelled" as const, error: "发送账号已删除" }
            : task
        );
        return {
          scheduledMessages,
          settings: { ...state.settings, scheduledMessages },
          messages: state.messages.map((message) =>
            message.direction === "out" &&
            message.accountId === accountId &&
            (message.deliveryStatus === "pending" ||
              message.deliveryStatus === "queued" ||
              message.deliveryStatus === "failed")
              ? {
                  ...message,
                  deliveryStatus: "failed",
                  lastError: "发送账号已删除",
                  retryCount: 5,
                  nextAttemptAt: undefined,
                }
              : message
          ),
          broadcastCampaigns: state.broadcastCampaigns.map((campaign) =>
            campaign.accountId === accountId &&
            (campaign.status === "draft" ||
              campaign.status === "running" ||
              campaign.status === "paused")
              ? {
                  ...campaign,
                  status: "cancelled",
                  finishedAt: campaign.finishedAt || now,
                  items: campaign.items.map((item) =>
                    item.status === "pending"
                      ? { ...item, status: "skipped", error: "发送账号已删除" }
                      : item
                  ),
                }
              : campaign
          ),
        };
      });
      persist(get);
    },

    completeBroadcastCampaignIfIdle: (id) => {
      const state = get();
      const c = state.broadcastCampaigns.find((x) => x.id === id);
      if (!c) return;
      if (c.items.some((i) => i.status === "pending" || i.status === "sending")) return;
      // 用户已暂停/取消的战役不得被自动置为完成：最后一条在途消息的结果
      // 返回时，会把用户「暂停以排查失败」的操作无声覆盖成 done。
      if (c.status === "paused" || c.status === "cancelled") return;
      set((s) => ({
        broadcastCampaigns: s.broadcastCampaigns.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "done",
                finishedAt: x.finishedAt || new Date().toISOString(),
              }
            : x
        ),
      }));
      persist(get);
    },

    patchBroadcastItem: (campaignId, itemId, patch) => {
      set((s) => ({
        broadcastCampaigns: s.broadcastCampaigns.map((c) =>
          c.id !== campaignId
            ? c
            : {
                ...c,
                items: c.items.map((i) =>
                  i.id === itemId ? { ...i, ...patch } : i
                ),
              }
        ),
      }));
      persist(get);
    },
  };
}
