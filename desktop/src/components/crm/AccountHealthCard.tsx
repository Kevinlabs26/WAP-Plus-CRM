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
  title,
  compact,
}: {
  health: AccountHealth;
  title?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const meta = LEVEL[health.level];
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
            <span className={cn("text-[12px] font-medium", meta.text, meta.contrast)}>
              {title || t("health.title")} · {t(meta.label)}
            </span>
            <span className="tabular-nums text-[11px] text-zinc-400">
              {health.score}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">
            {text.summary}
          </p>
          {!compact && text.hints.length > 0 && (
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
