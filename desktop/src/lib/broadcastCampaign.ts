import type {
  BroadcastCampaign,
  BroadcastItem,
  BroadcastMedia,
  BroadcastMediaMode,
  BroadcastVariant,
} from "@/types/broadcast";
import {
  BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC,
  BROADCAST_DEFAULT_EXTRA_GAP_SEC,
  BROADCAST_HARD_CAP,
  BROADCAST_HISTORY_MAX,
  BROADCAST_MAX_VARIANTS,
} from "@/types/broadcast";
import type { Contact } from "@/types/crm";
import {
  contactSendablePhone,
  renderBroadcastTemplate,
  validateBroadcastTemplate,
} from "@/lib/broadcastTemplate";
import { applyAccountWarmup } from "@/lib/accountWarmup";
import type { SendRateLimits } from "@/channels/types";
import { DEFAULT_RATE_LIMITS } from "@/channels/rateLimit";
import { isDeliveryUncertain } from "@/store/outgoingRetry";
import type { Message } from "@/types/crm";

export function broadcastItemUncertain(item: BroadcastItem, messages: Message[]) {
  const message = messages.find(m=>m.id===item.messageId);
  return message ? isDeliveryUncertain(message) : isDeliveryUncertain({direction:"out",deliveryStatus:"failed",lastError:item.error});
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeCampaigns(raw: unknown): BroadcastCampaign[] {
  if (!Array.isArray(raw)) return [];
  const out: BroadcastCampaign[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const c = row as Partial<BroadcastCampaign>;
    const id = String(c.id || "").trim();
    if (!id) continue;
    const items: BroadcastItem[] = [];
    if (Array.isArray(c.items)) {
      for (const it of c.items) {
        if (!it || typeof it !== "object") continue;
        const item = it as Partial<BroadcastItem>;
        const iid = String(item.id || "").trim();
        if (!iid) continue;
        const unknown = /发送结果未知|baileys_delivery_unknown/.test(String(item.error || ""));
        items.push({
          id: iid,
          contactId: String(item.contactId || ""),
          contactName: String(item.contactName || ""),
          accountId: item.accountId ? String(item.accountId).trim().slice(0, 120) || undefined : undefined,
          phoneE164: String(item.phoneE164 || ""),
          bodyRendered: String(item.bodyRendered || ""),
          variantId: item.variantId ? String(item.variantId).slice(0, 120) : undefined,
          mediaId: item.mediaId ? String(item.mediaId).slice(0, 120) : undefined,
          // 应用退出时仍为 sending 的结果无法确认，不能静默重发。
          status:
            item.status === "sending" || (item.status === "pending" && unknown)
              ? "failed"
              : item.status === "sent" ||
                  item.status === "failed" ||
                  item.status === "skipped" ||
                  item.status === "pending"
                ? item.status
                : "pending",
          error:
            item.status === "sending"
              ? "上次发送结果未知，请核对后手动重试"
              : item.error
                ? String(item.error).slice(0, 300)
                : undefined,
          sentAt: item.sentAt ? String(item.sentAt) : undefined,
          messageId: item.messageId ? String(item.messageId) : undefined,
        });
      }
    }
    let status = c.status as BroadcastCampaign["status"];
    // 刷新后 running 不能自动续发，降为 paused，需用户点继续
    if (status === "running") status = "paused";
    if (
      status !== "draft" &&
      status !== "paused" &&
      status !== "cancelled" &&
      status !== "done"
    ) {
      status = "draft";
    }
    out.push({
      id,
      accountId: String(c.accountId || "").trim() || "wa-default",
      priority: Number.isFinite(c.priority) ? c.priority : 0,
      title: c.title ? String(c.title).slice(0, 80) : undefined,
      template: String(c.template || "").slice(0, 2000),
      media: normalizeBroadcastMedia(c.media),
      variants: Array.isArray(c.variants) ? c.variants.slice(0, BROADCAST_MAX_VARIANTS).filter(v => v && typeof v === "object").map(v => ({
        id: String(v.id || "").slice(0, 120),
        template: String(v.template || "").slice(0, 2000),
        media: normalizeBroadcastMedia(v.media),
        mediaMode: v.mediaMode === "random" || v.mediaMode === "roundrobin" ? v.mediaMode : "single",
      })) : undefined,
      mediaMode:
        c.mediaMode === "random" || c.mediaMode === "roundrobin"
          ? c.mediaMode
          : undefined,
      status,
      createdAt: String(c.createdAt || new Date().toISOString()),
      startedAt: c.startedAt ? String(c.startedAt) : undefined,
      finishedAt: c.finishedAt ? String(c.finishedAt) : undefined,
      extraGapSec: Math.min(
        120,
        Math.max(20, Number(c.extraGapSec) || BROADCAST_DEFAULT_EXTRA_GAP_SEC)
      ),
      extraGapMaxSec: Math.min(
        120,
        Math.max(
          20,
          Number(c.extraGapSec) || BROADCAST_DEFAULT_EXTRA_GAP_SEC,
          Number(c.extraGapMaxSec) ||
            Number(c.extraGapSec) ||
            BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC
        )
      ),
      items,
    });
  }
  return out
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, BROADCAST_HISTORY_MAX);
}

export function trimCampaigns(list: BroadcastCampaign[]): BroadcastCampaign[] {
  return [...list]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, BROADCAST_HISTORY_MAX);
}

export type BuildCampaignInput = {
  accountId: string;
  accountByPhone?: Record<string, string>;
  template: string;
  contactIds: string[];
  contacts: Contact[];
  extraGapSec?: number;
  extraGapMaxSec?: number;
  title?: string;
  /** 账号 createdAt，用于 warmup 禁开 */
  accountCreatedAt?: string | null;
  rateLimits?: Partial<SendRateLimits>;
  /** 默认 true：warmup 中禁止开战役 */
  blockWarmup?: boolean;
  /** 可选媒体池；有媒体时 template 渲染为 caption */
  media?: BroadcastMedia[];
  mediaMode?: BroadcastMediaMode;
  variants?: BroadcastVariant[];
};

export function buildCampaignOrError(
  input: BuildCampaignInput
): { ok: true; campaign: BroadcastCampaign } | { ok: false; reason: string } {
  const accountId = String(input.accountId || "").trim();
  if (!accountId) return { ok: false, reason: "请选择发送账号" };

  const media = normalizeBroadcastMedia(input.media);
  let variants: BroadcastVariant[] | undefined;
  if (input.variants !== undefined) {
    if (!Array.isArray(input.variants) || input.variants.length < 2 || input.variants.length > BROADCAST_MAX_VARIANTS) {
      return { ok: false, reason: `随机群发请添加 2–${BROADCAST_MAX_VARIANTS} 个版本` };
    }
    const ids = new Set<string>();
    variants = [];
    for (const [index, variant] of input.variants.entries()) {
      if (!variant || typeof variant !== "object" || typeof variant.template !== "string" ||
          typeof variant.id !== "string" || !variant.id.trim() || variant.id.length > 120 || ids.has(variant.id)) {
        return { ok: false, reason: `版本 ${index + 1} 无效，请重新添加` };
      }
      ids.add(variant.id);
      const variantMedia = normalizeBroadcastMedia(variant.media);
      if (variant.media !== undefined && (!Array.isArray(variant.media) || variantMedia.length !== variant.media.length ||
          new Set(variantMedia.map(m => m.id)).size !== variantMedia.length)) {
        return { ok: false, reason: `版本 ${index + 1} 的媒体无效，请重新添加` };
      }
      variants.push({ id: variant.id, template: variant.template, media: variantMedia, mediaMode: variant.mediaMode });
    }
  }
  for (const [index, variant] of (variants || [{ template: input.template, media }]).entries()) {
    const v = validateBroadcastTemplate(variant.template, Boolean(variant.media?.length));
    const reason = !v.ok ? v.reason : variant.template.trim() && variant.media?.some(item => item.kind === "audio" && item.voiceNote)
      ? "语音条不能附带文字，请清空文案或改为文件发送" : "";
    if (reason) return { ok: false, reason: variants ? `版本 ${index + 1}：${reason}` : reason };
  }

  if (input.blockWarmup !== false && input.accountCreatedAt) {
    const limits: SendRateLimits = {
      ...DEFAULT_RATE_LIMITS,
      ...input.rateLimits,
    };
    const w = applyAccountWarmup(limits, input.accountCreatedAt);
    if (w.active) {
      return {
        ok: false,
        reason: `该号仍在新号保护期内（${w.factorLabel}），暂不可开群发战役`,
      };
    }
  }

  const idSet = [...new Set(input.contactIds.map((x) => String(x || "").trim()).filter(Boolean))];
  if (!idSet.length) return { ok: false, reason: "请至少选择一位客户" };
  if (idSet.length > BROADCAST_HARD_CAP) {
    return {
      ok: false,
      reason: `单次最多 ${BROADCAST_HARD_CAP} 人（已选 ${idSet.length}）`,
    };
  }

  const byId = new Map(input.contacts.map((c) => [c.id, c]));
  const items: BroadcastItem[] = [];
  const seenPhones = new Set<string>();
  for (const cid of idSet) {
    const c = byId.get(cid);
    if (!c) continue;
    if (c.isGroup) continue;
    const phone = contactSendablePhone(c);
    if (!phone) {
      items.push({
        id: uid("bi"),
        contactId: c.id,
        contactName: c.name || cid,
        phoneE164: "",
        bodyRendered: "",
        status: "skipped",
        error: "无有效手机号",
      });
      continue;
    }
    if (seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    const variant = variants?.[Math.floor(Math.random() * variants.length)];
    const itemMedia = variant?.media || media;
    const mode = variant?.mediaMode || input.mediaMode;
    const pickedMedia = itemMedia[mode === "random" ? Math.floor(Math.random() * itemMedia.length) : mode === "roundrobin" ? items.length % itemMedia.length : 0];
    const body = renderBroadcastTemplate(variant?.template ?? input.template, c);
    if (!body && !itemMedia.length) {
      items.push({
        id: uid("bi"),
        contactId: c.id,
        contactName: c.name || cid,
        phoneE164: phone,
        bodyRendered: "",
        status: "skipped",
        error: "渲染后正文为空",
      });
      continue;
    }
    items.push({
      id: uid("bi"),
      contactId: c.id,
      contactName: c.name || phone,
      accountId: input.accountByPhone?.[phone] || accountId,
      phoneE164: phone,
      bodyRendered: body,
      variantId: variant?.id,
      mediaId: pickedMedia?.id,
      status: "pending",
    });
  }

  const actionable = items.filter((i) => i.status === "pending");
  if (!actionable.length) {
    return { ok: false, reason: "没有可发送的客户（缺少有效号码）" };
  }

  const now = new Date().toISOString();
  const mediaMode: BroadcastMediaMode =
    media.length > 1 && input.mediaMode === "random"
      ? "random"
      : media.length > 1 && input.mediaMode === "roundrobin"
        ? "roundrobin"
        : "single";
  return {
    ok: true,
    campaign: {
      id: uid("bc"),
      accountId,
      title: input.title?.trim().slice(0, 80) || undefined,
      template: input.template.trim(),
      variants,
      media: media.length ? media : undefined,
      mediaMode: media.length ? mediaMode : undefined,
      status: "draft",
      createdAt: now,
      extraGapSec: Math.min(
        120,
        Math.max(20, input.extraGapSec ?? BROADCAST_DEFAULT_EXTRA_GAP_SEC)
      ),
      extraGapMaxSec: Math.min(
        120,
        Math.max(
          20,
          input.extraGapSec ?? BROADCAST_DEFAULT_EXTRA_GAP_SEC,
          input.extraGapMaxSec ?? BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC
        )
      ),
      items,
    },
  };
}

export function campaignHasMedia(campaign: BroadcastCampaign): boolean {
  return Boolean(campaign.media?.length || campaign.variants?.some(v => v.media?.length));
}

/** 版本和附件只在建任务时随机；旧任务保留原有媒体池逻辑。 */
export function broadcastItemMedia(campaign: BroadcastCampaign, item: BroadcastItem): BroadcastMedia[] {
  let pool = campaign.media || [];
  if (campaign.variants !== undefined || item.variantId) {
    const variant = campaign.variants?.find(v => v.id === item.variantId);
    if (!variant) throw new Error("群发版本已失效，请重新创建任务");
    pool = variant.media || [];
    if (pool.length && !item.mediaId) throw new Error("群发附件分配已失效，请重新创建任务");
  }
  if (!item.mediaId) return pool;
  const media = pool.find(m => m.id === item.mediaId);
  if (!media) throw new Error("群发附件已失效，请重新创建任务");
  return [media];
}

/** 收口媒体池：只留合法 kind 与 id，最多 10 个 */
function normalizeBroadcastMedia(
  raw?: BroadcastMedia[] | null
): BroadcastMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: BroadcastMedia[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const kind = m.kind;
    if (
      kind !== "image" &&
      kind !== "video" &&
      kind !== "audio" &&
      kind !== "document"
    )
      continue;
    const id = String(m.id || "").trim();
    if (!id) continue;
    out.push({
      id,
      kind,
      mime: String(m.mime || "").slice(0, 120) || "application/octet-stream",
      fileName: m.fileName ? String(m.fileName).slice(0, 240) : undefined,
      ...(kind === "audio" && m.voiceNote === true ? { voiceNote: true } : {}),
    });
    if (out.length >= 10) break;
  }
  return out;
}

export function campaignProgress(c: BroadcastCampaign) {
  const total = c.items.length;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;
  for (const it of c.items) {
    if (it.status === "sent") sent++;
    else if (it.status === "failed") failed++;
    else if (it.status === "skipped") skipped++;
    else pending++;
  }
  return { total, sent, failed, skipped, pending };
}
