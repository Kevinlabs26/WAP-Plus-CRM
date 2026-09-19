import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import type { ActivityKind } from "@/types/crm";
import { SectionLabel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/core";

const KIND_STYLE: Record<
  ActivityKind,
  { dot: string; label: TranslationKey }
> = {
  note: { dot: "bg-zinc-400", label: "activity.note" },
  stage: { dot: "bg-amber-400", label: "activity.stage" },
  message_out: { dot: "bg-brand", label: "activity.sent" },
  message_in: { dot: "bg-sky-400", label: "activity.received" },
  follow_up: { dot: "bg-violet-400", label: "activity.followUp" },
  contact_created: { dot: "bg-emerald-400", label: "activity.created" },
  phone_bound: { dot: "bg-teal-400", label: "activity.bound" },
  system: { dot: "bg-zinc-500", label: "activity.system" },
};

export function ActivityTimeline({
  contactId,
  limit = 12,
  compact,
}: {
  contactId: string;
  limit?: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const activities = useAppStore((s) => s.activities);

  const items = useMemo(
    () =>
      activities
        .filter((a) => a.contactId === contactId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    [activities, contactId, limit]
  );

  if (items.length === 0) {
    return (
      <p className="text-2xs text-zinc-600">
        {t("activity.empty")}
      </p>
    );
  }

  return (
    <div>
      {!compact && <SectionLabel>{t("activity.title")}</SectionLabel>}
      <ol className={cn("relative space-y-0", !compact && "mt-1")}>
        {items.map((a, i) => {
          const meta = KIND_STYLE[a.kind] ?? KIND_STYLE.system;
          return (
            <li key={a.id} className="flex gap-2.5 pb-3 last:pb-0">
              <div className="flex w-3 flex-col items-center">
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full ring-2 ring-zinc-950",
                    meta.dot
                  )}
                />
                {i < items.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-zinc-800" />
                )}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-zinc-200">
                    {a.title || t(meta.label)}
                  </span>
                  <span className="shrink-0 text-2xs tabular-nums text-zinc-600">
                    {formatWhen(a.at)}
                  </span>
                </div>
                {a.detail && (
                  <p className="mt-0.5 line-clamp-2 text-2xs text-zinc-500">
                    {a.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
