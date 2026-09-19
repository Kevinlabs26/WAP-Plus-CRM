import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { campaignProgress } from "@/lib/broadcastCampaign";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { useI18n, type TranslationKey } from "@/i18n";

type Props = {
  campaignId: string;
  onBack: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetryFailed: () => void;
  onCancel: () => void;
};

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

  return (
    <div className="space-y-4">
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
          <Button variant="secondary" className="!min-h-8 gap-1" onClick={onRetryFailed}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t("broadcast.run.retryFailed", { count: p.failed })}
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

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex justify-between text-[12px] text-zinc-400">
          <span>
            {t("broadcast.run.sent", { count: p.sent })} · {t("broadcast.run.failed", { count: p.failed })} · {t("broadcast.run.skipped", { count: p.skipped })} · {t("broadcast.run.pending", { count: p.pending })}
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand/80 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="max-h-96 space-y-1 overflow-y-auto">
        {c.items.map((it) => (
          <li
            key={it.id}
            className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-1.5 text-[11px]"
          >
            <div className="flex justify-between gap-2">
              <span className="truncate font-medium text-zinc-200">
                {it.contactName}
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  it.status === "sent" && "text-emerald-400",
                  it.status === "failed" && "text-rose-400",
                  it.status === "pending" && "text-zinc-500",
                  it.status === "sending" && "text-brand",
                  it.status === "skipped" && "text-zinc-600"
                )}
              >
                {t(ITEM_STATUS_LABELS[it.status] || "broadcast.run.item.pending")}
              </span>
            </div>
            {it.error && (
              <p className="mt-0.5 truncate text-2xs text-zinc-600">{it.error}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
