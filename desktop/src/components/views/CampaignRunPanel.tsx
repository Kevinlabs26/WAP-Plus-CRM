import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { campaignProgress } from "@/lib/broadcastCampaign";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { useI18n, type TranslationKey } from "@/i18n";
import { useMemo, useState } from "react";
import { broadcastItemUncertain } from "@/lib/broadcastCampaign";
import { planItemReceipt } from "@/lib/scheduledPlanProgress";
import { Avatar } from "@/components/ui/Avatar";

type Props = {
  campaignId: string;
  onBack: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetryFailed: (ids: string[], unknown?: boolean) => void;
  onCancel: () => void;
};
type ResultFilter = "all" | "sent" | "attention" | "pending" | "skipped";
const SEND_GATED_CODES = new Set(["overheated", "send_paused", "baileys_not_connected", "automation_cancelled", "send_blocked"]);

const CAMPAIGN_STATUS_LABELS: Record<string, TranslationKey> = {
  running: "broadcast.run.item.sending",
  paused: "broadcast.run.pause",
  draft: "broadcast.run.item.pending",
  done: "broadcast.run.item.sent",
  cancelled: "broadcast.run.item.skipped",
};

const ITEM_STATUS_LABELS: Record<string, TranslationKey> = {
  pending: "broadcast.run.item.pending",
  sending: "broadcast.run.item.sending",
  sent: "broadcast.run.item.sent",
  failed: "broadcast.run.item.failed",
  skipped: "broadcast.run.item.skipped",
};

/** 战役运行面板：暂停/继续/中止 + 进度条 + 逐条结果。 */
export function CampaignRunPanel({
  campaignId,
  onBack,
  onPause,
  onResume,
  onRetryFailed,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const [selected,setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const messages = useAppStore(s=>s.messages);
  const contacts = useAppStore(s=>s.contacts);
  const accounts = useAppStore(s=>s.settings.waAccounts || []);
  const phones = useAppStore(s=>s.phones);
  const contactsById = useMemo(() => new Map(contacts.map(contact => [contact.id, contact])), [contacts]);
  const c = useAppStore((s) =>
    (s.broadcastCampaigns || []).find((x) => x.id === campaignId)
  );
  if (!c) {
    return (
      <p className="text-[12px] text-zinc-500">
        {t("broadcast.run.missing")} {" "}
        <button type="button" className="text-brand" onClick={onBack}>
          {t("broadcast.run.back")}
        </button>
      </p>
    );
  }
  const p = campaignProgress(c);
  const pct = p.total ? Math.round(((p.sent + p.failed + p.skipped) / p.total) * 100) : 0;
  const messagesById=new Map(messages.map(m=>[m.id,m]));
  const pendingWithError = c.items.filter(item => item.status === "pending" && Boolean(item.error || item.errorCode)).length;
  const attentionCount = p.failed + pendingWithError;
  const plainPending = Math.max(0, p.pending - pendingWithError);
  const visibleItems = c.items.filter(item => {
    if (filter === "all") return true;
    if (filter === "sent") return item.status === "sent";
    if (filter === "attention") return item.status === "failed" || item.status === "pending" && Boolean(item.error || item.errorCode);
    if (filter === "pending") return item.status === "pending" && !item.error && !item.errorCode || item.status === "sending";
    return item.status === "skipped";
  });
  const retrySelection=selected.filter(id=>c.items.some(i=>i.id===id&&i.status==="failed"&&!broadcastItemUncertain(i,messages)));

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="!min-h-8" onClick={onBack}>
          {t("broadcast.run.back")}
        </Button>
        {c.status === "running" && (
          <Button variant="secondary" className="!min-h-8 gap-1" onClick={onPause}>
            <Pause className="h-3.5 w-3.5" />
            {t("broadcast.run.pause")}
          </Button>
        )}
        {(c.status === "paused" || c.status === "draft") && (
          <Button variant="primary" className="!min-h-8 gap-1" onClick={onResume}>
            <Play className="h-3.5 w-3.5" />
            {t("broadcast.run.resume")}
          </Button>
        )}
        {p.failed > 0 && c.status !== "running" && (
          <Button variant="secondary" disabled={!retrySelection.length} className="!min-h-8 gap-1" onClick={()=>onRetryFailed(retrySelection)}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t("broadcast.run.retryFailed", { count: retrySelection.length })}
          </Button>
        )}
        {c.status !== "done" && c.status !== "cancelled" && (
          <Button variant="ghost" className="!min-h-8 gap-1" onClick={onCancel}>
            <Square className="h-3.5 w-3.5" />
            {t("broadcast.run.cancel")}
          </Button>
        )}
        <span className="text-[11px] text-zinc-500">
          {t("broadcast.run.status", {
            status: t(CAMPAIGN_STATUS_LABELS[c.status] || "broadcast.run.item.pending"),
          })}
        </span>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex justify-between text-[12px] text-zinc-400">
          <span>
            {t("broadcast.run.sent", { count: p.sent })} · {t("broadcast.run.failed", { count: p.failed })} · {t("broadcast.run.needsAttention", { count: pendingWithError })} · {t("broadcast.run.pending", { count: plainPending })} · {t("broadcast.run.skipped", { count: p.skipped })}
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand/80 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">{t("broadcast.run.deliveryHint")}</p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label={t("broadcast.run.resultFilters")}>
        {([
          ["all", p.total],
          ["sent", p.sent],
          ["attention", attentionCount],
          ["pending", plainPending],
          ["skipped", p.skipped],
        ] as [ResultFilter, number][]).map(([key, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors", filter === key ? "border-brand/50 bg-brand/10 text-brand" : "border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200")}>
          {t(`broadcast.run.filter.${key}`)} <span className="ml-1 tabular-nums opacity-70">{count}</span>
        </button>)}
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {visibleItems.map((it) => {
          const uncertain = broadcastItemUncertain(it,messages);
          const attentionKind = it.status === "pending" && it.errorCode === "rate_limited" ? "rateLimited"
            : it.status === "pending" && SEND_GATED_CODES.has(it.errorCode || "") ? "blocked"
              : it.status === "pending" && (it.error || it.errorCode) ? "attention" : null;
          const statusLabel = it.status === "sent"
            ? t(`planQueue.receipt.${planItemReceipt({status:"sent",messageId:it.messageId},messagesById)}`)
            : it.status === "failed" && uncertain ? t("broadcast.run.item.uncertain")
              : attentionKind ? t(`broadcast.run.item.${attentionKind}`)
                : t(ITEM_STATUS_LABELS[it.status] || "broadcast.run.item.pending");
          const statusTone = it.status === "sent" ? "bg-emerald-500/10 text-emerald-300"
            : it.status === "failed" ? uncertain ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"
              : attentionKind === "blocked" ? "bg-amber-500/10 text-amber-300"
                : attentionKind === "rateLimited" ? "bg-sky-500/10 text-sky-300"
                  : attentionKind ? "bg-rose-500/10 text-rose-300"
                    : it.status === "sending" ? "bg-brand/10 text-brand" : "bg-zinc-800 text-zinc-400";
          return (
          <li
            key={it.id}
            className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-1.5 text-[11px]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {it.status === "failed" && c.status !== "running" && !broadcastItemUncertain(it,messages) && <input type="checkbox" aria-label={t("planQueue.selectRetry",{name:it.contactName})} checked={selected.includes(it.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,it.id]:ids.filter(id=>id!==it.id))} />}
                <Avatar name={it.contactName} seed={it.phoneE164 || it.contactId} src={contactsById.get(it.contactId)?.avatarFullUrl || contactsById.get(it.contactId)?.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-zinc-200">{it.contactName}</span>
                  <span className="block truncate text-2xs text-zinc-500">{it.phoneE164 || "—"} · {c.channelId === "android_bridge" ? phones.find(phone => phone.id === c.accountId)?.name || c.accountId : accounts.find(account => account.id === (it.accountId || c.accountId))?.label || it.accountId || c.accountId}</span>
                </span>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", statusTone)}>{statusLabel}</span>
            </div>
            {it.variantId && <p className="mt-1 text-2xs text-zinc-500">
              {t("broadcast.variant", { number: (c.variants?.findIndex(v => v.id === it.variantId) ?? -1) + 1 })}
              {" · "}{it.bodyRendered.slice(0, 80)}
              {it.mediaId && <> · {c.variants?.find(v => v.id === it.variantId)?.media?.find(m => m.id === it.mediaId)?.fileName || t("broadcast.mediaCount", { count: 1 })}</>}
            </p>}
            {(it.error || it.errorCode) && (
              <p className={cn("mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed", attentionKind === "blocked" || it.status === "failed" ? "text-rose-300" : "text-amber-300")}>{t("broadcast.run.reason", { reason: it.error || it.errorCode || "" })}</p>
            )}
            {(it.sentAt || it.attemptedAt) && <time className="mt-1 block text-2xs text-zinc-600">{new Date(it.sentAt || it.attemptedAt || "").toLocaleString()}</time>}
            {it.status === "failed" && c.status !== "running" && uncertain && <Button size="sm" onClick={()=>onRetryFailed([it.id],true)}>{t("planQueue.reviewRetry")}</Button>}
          </li>
          );
        })}
        {!visibleItems.length && <li className="py-8 text-center text-xs text-zinc-500">{t("broadcast.run.filterEmpty")}</li>}
      </ul>
    </div>
  );
}
