/**
 * 单账号健康度卡片（展示层）。
 */
import { Activity, AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { localizeAccountHealth, type AccountHealth } from "@/lib/accountHealth";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const LEVEL = {
  green: {
    border: "border-emerald-500/25",
    bg: "bg-emerald-500/10",
    text: "text-emerald-200",
    contrast: "health-status-green",
    Icon: CheckCircle2,
    label: "health.good",
  },
  yellow: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    text: "text-amber-100",
    contrast: "health-status-yellow",
    Icon: AlertTriangle,
    label: "health.attention",
  },
  red: {
    border: "border-rose-500/35",
    bg: "bg-rose-500/10",
    text: "text-rose-100",
    contrast: "health-status-red",
    Icon: Flame,
    label: "health.risky",
  },
} as const;

export function AccountHealthCard({
  health,
  connection,
  title,
  compact,
}: {
  health: AccountHealth;
  connection: string;
  title?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const hasActivity = health.sentLastDay > 0;
  const assessed = connection === "connected" && hasActivity;
  const inactiveLabel = connection === "connected"
    ? "health.noActivity"
    : connection === "qr"
      ? "account.waitingQr"
      : connection === "starting" || connection === "reconnecting"
        ? "account.reconnecting"
        : connection === "connecting"
          ? "account.connecting"
          : "account.disconnected";
  const meta = assessed ? LEVEL[health.level] : {
    border: "border-zinc-800", bg: "bg-zinc-900/50", text: "text-zinc-300",
    contrast: "", Icon: Activity, label: inactiveLabel,
  } as const;
  const Icon = meta.Icon;
  const text = localizeAccountHealth(health, t);
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        meta.border,
        meta.bg
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.text, meta.contrast)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-[13px] font-medium", meta.text, meta.contrast)}>
              {title || t("health.title")} · {t(meta.label)}
            </span>
            {assessed && <span className="tabular-nums text-[12px] text-zinc-400">
              {health.score}
            </span>}
          </div>
          <p className="mt-0.5 text-[12px] leading-5 text-zinc-400">
            {assessed ? text.summary : t("health.recentCounts", { hour: health.sentLastHour, day: health.sentLastDay })}
          </p>
          {!assessed && <p className="mt-1 text-2xs leading-5 text-zinc-500">
            {t(connection === "connected" ? "health.noActivityHint" : "health.offlineHint")}
          </p>}
          {!compact && hasActivity && text.hints.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {text.hints.map((h) => (
                <li
                  key={h}
                  className="flex gap-1.5 text-2xs leading-4 text-zinc-500"
                >
                  <Activity className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
