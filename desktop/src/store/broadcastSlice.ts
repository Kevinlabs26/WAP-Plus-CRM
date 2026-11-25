import {
  buildCampaignOrError,
  trimCampaigns,
  broadcastItemUncertain,
  campaignHasMedia,
} from "@/lib/broadcastCampaign";
import type { AppState, SliceContext } from "./types";
import { resolveActiveSalesStage } from "@/lib/contactWorkflow";
import { accountCreatedAtOf, persist } from "./persist";
import { planSteps, recipientKey } from "@/lib/scheduledPlans";
import { routeBroadcastAccounts } from "@/lib/broadcastAccountRouting";
import { applyAccountWarmup } from "@/lib/accountWarmup";
import { DEFAULT_RATE_LIMITS } from "@/channels/rateLimit";
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
      const android = input.channelId === "android_bridge";
      if (android && (state.settings.sendChannel !== "android_bridge" || !state.bridge.connected || state.bridge.deviceId !== input.accountId)) {
        return { ok: false, reason: "请连接并选用原定的 Android 手机" };
      }
      if (android && (input.media?.length || input.variants?.some(variant => variant.media?.length))) {
        return { ok: false, reason: "Android 群发仅支持文本" };
      }
      const contactIds = [...input.contactIds];
      const contacts = [...state.contacts];
      for (const phone of parseBroadcastPhones((input.phoneNumbers || []).join("\n"))) {
        const existing = contacts.find(
          (contact) =>
            !contact.isGroup &&
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
          stage: resolveActiveSalesStage("new", state.settings.salesStageOrder),
          source: "broadcast",
        });
        contactIds.push(id);
      }
      const selectedContactIds = new Set(contactIds);
      const phones = contacts.flatMap(contact => selectedContactIds.has(contact.id) && contactSendablePhone(contact) || []);
      const routing: ReturnType<typeof routeBroadcastAccounts> = android
        ? {accountByPhone: {}, contacted: 0, unclear: 0, unassigned: 0}
        : routeBroadcastAccounts(state, phones, input.accountId, input.firstContactQuotas);
      const {accountByPhone} = routing;
      if (routing.unclear) return {ok:false, reason:"有收件人的原发送账号无法确认，请核对名单"};
      if (routing.unassigned) return {ok:false, reason:"首次联系人数尚未全部分配，请调整各账号人数"};
      const expected = input.expectedAccountByPhone;
      if (!android && expected && (Object.keys(expected).length !== Object.keys(accountByPhone).length ||
          Object.entries(accountByPhone).some(([phone, account]) => expected[phone] !== account))) {
        return {ok:false, reason:"收件人的发送账号已变化，请返回预览重新确认"};
      }
      for (const contact of contacts.slice(state.contacts.length)) {
        const phone = contactSendablePhone(contact);
        if (phone && accountByPhone[phone]) contact.accountId = accountByPhone[phone];
      }
      const rateLimits = {
        ...DEFAULT_RATE_LIMITS,
        perPhonePerMinute: state.settings.ratePerMinute ?? DEFAULT_RATE_LIMITS.perPhonePerMinute,
        perPhonePerHour: state.settings.ratePerHour ?? DEFAULT_RATE_LIMITS.perPhonePerHour,
        minIntervalSec: state.settings.rateMinIntervalSec ?? DEFAULT_RATE_LIMITS.minIntervalSec,
      };
      for (const id of android ? [] : new Set(Object.values(accountByPhone))) {
        const account = state.settings.waAccounts.find(item => item.id === id);
        if (!account) return { ok: false, reason: "发送账号不存在，请重新选择账号" };
        const warmup = applyAccountWarmup(rateLimits, account.warmupExempt ? undefined : accountCreatedAtOf(state.settings, id));
        if (warmup.active) return { ok: false, reason: `账号 ${account.label || id} 仍在新号保护期内（${warmup.factorLabel}），暂不可群发` };
      }
      const res = buildCampaignOrError({
        accountId: input.accountId,
        accountByPhone,
        template: input.template,
        contactIds,
        contacts,
        extraGapSec: input.extraGapSec,
        extraGapMaxSec: input.extraGapMaxSec,
        media: input.media,
        mediaMode: input.mediaMode,
        variants: input.variants,
        accountCreatedAt: accountCreatedAtOf(state.settings, input.accountId),
        blockWarmup: false,
        rateLimits: {
          perPhonePerMinute: state.settings.ratePerMinute,
          perPhonePerHour: state.settings.ratePerHour,
          minIntervalSec: state.settings.rateMinIntervalSec,
        },
      });
      if (!res.ok) return { ok: false, reason: res.reason };
      if (android) res.campaign.channelId = "android_bridge";
      if (!campaignHasMedia(res.campaign)) {
        const targets=new Map(res.campaign.items.filter(i=>i.status==="pending").map(i=>[recipientKey(i.accountId || input.accountId,i.phoneE164),i.bodyRendered.trim()]));
        const newer=(state.settings.scheduledPlans||[]).filter(p=>!["done","cancelled","expired"].includes(p.status)&&Math.abs(Date.parse(p.dueAt)-Date.now())<=86400_000&&planSteps(p).length===1&&!p.media&&p.items.some(i=>["pending","sending","unknown"].includes(i.status)&&targets.get(recipientKey(i.accountId,i.recipient))===p.text.trim()));
        const older=state.broadcastCampaigns.filter(c=>["draft","running","paused"].includes(c.status)&&!campaignHasMedia(c)&&c.items.some(i=>["pending","sending"].includes(i.status)&&targets.get(recipientKey(i.accountId || c.accountId,i.phoneE164))===i.bodyRendered.trim()));
        const duplicateIds=[...newer,...older].map(p=>p.id).filter(id=>!input.confirmedDuplicateIds?.includes(id));
        if(duplicateIds.length)return {ok:false,reason:`发现 ${duplicateIds.length} 个可能重复的未完成任务，请先核对`,duplicateIds};
      }
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
      if (c.channelId === "android_bridge" && (state.settings.sendChannel !== "android_bridge" || !state.bridge.connected || state.bridge.deviceId !== c.accountId)) {
        return { ok: false, reason: "请重新连接此群发任务绑定的 Android 手机" };
      }
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
                  i.status === "pending" ? { ...i, status: "pending", errorCode: undefined, error: undefined } : i
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
      if (c.items.some((item) => item.status === "sending")) {
        return { ok: false, reason: "请等待当前条目的发送结果" };
      }
      if (c.channelId === "android_bridge" && (state.settings.sendChannel !== "android_bridge" || !state.bridge.connected || state.bridge.deviceId !== c.accountId)) {
        return { ok: false, reason: "请重新连接此群发任务绑定的 Android 手机" };
      }
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

    retryFailedBroadcastCampaign: (id, itemIds, confirmedUnknownIds = []) => {
      const state = get();
      const campaign = state.broadcastCampaigns.find((item) => item.id === id);
      if (!campaign || campaign.status === "running" || campaign.items.some(i=>i.status==="sending")) return 0;
      const retryIds = new Set(campaign.items.filter(item => item.status === "failed" && (!itemIds || itemIds.includes(item.id))
        && !state.messages.some(m=>m.id===item.messageId && ["sent","server","delivered","read","played"].includes(m.deliveryStatus || ""))
        && (!broadcastItemUncertain(item,state.messages) || itemIds?.length===1 && confirmedUnknownIds.length===1 && confirmedUnknownIds.includes(item.id))).map(i=>i.id));
      const count = retryIds.size;
      if (!count) return 0;
      set((state) => ({
        broadcastCampaigns: state.broadcastCampaigns.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "paused",
                finishedAt: undefined,
                items: item.items.map((entry) =>
                  entry.status === "failed" && retryIds.has(entry.id)
                    ? { ...entry, status: "pending", deliveryUncertain: false, errorCode: undefined, error: undefined }
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
      const campaign = get().broadcastCampaigns.find((entry) => entry.id === id);
      if (!campaign || campaign.status === "done" || campaign.status === "cancelled") return;
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
        const scheduledPlans = (state.settings.scheduledPlans || []).map(plan => {
          if (["done", "cancelled"].includes(plan.status) || !plan.items.some(item => item.accountId === accountId && item.status !== "sent")) return plan;
          const items = plan.items.map(item => item.accountId === accountId && item.status !== "sent"
            ? { ...item, retired: true, status: "cancelled" as const, error: "planQueue.accountChanged" } : item);
          return { ...plan, items, status: items.some(item => item.status === "pending") ? "paused" as const : "cancelled" as const, error: "planQueue.accountChanged" };
        });
        return {
          scheduledMessages,
          settings: { ...state.settings, scheduledMessages, scheduledPlans },
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
          broadcastCampaigns: state.broadcastCampaigns.map((campaign) => {
            if (!["draft", "running", "paused"].includes(campaign.status) || !campaign.items.some(item => (item.accountId || campaign.accountId) === accountId && item.status !== "sent")) return campaign;
            const items = campaign.items.map(item => (item.accountId || campaign.accountId) === accountId && item.status === "pending"
              ? { ...item, status: "skipped" as const, error: "发送账号已删除" } : item);
            const hasRemaining = items.some(item => (item.status === "pending" || item.status === "sending") && (item.accountId || campaign.accountId) !== accountId);
            return { ...campaign, status: hasRemaining ? "paused" as const : "cancelled" as const, finishedAt: hasRemaining ? undefined : campaign.finishedAt || now, items };
          }),
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
