/**
 * 多账号健康度列表 — 挂设备页 / 设置连接区。
 */
import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { computeAllAccountsHealth } from "@/lib/accountHealth";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { AccountHealthCard } from "./AccountHealthCard";
import { SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

export function AccountHealthPanel({
  compact,
}: {
  compact?: boolean;
}) {
  const { t } = useI18n();
  const messages = useAppStore((s) => s.messages);
  const settings = useAppStore((s) => s.settings);
  const accounts = settings.waAccounts || [];

  const items = useMemo(
    () =>
      computeAllAccountsHealth({
        accounts,
        messages,
        caps: {
          perPhonePerHour: settings.ratePerHour,
          perPhonePerMinute: settings.ratePerMinute,
          minIntervalSec: settings.rateMinIntervalSec,
        },
      }),
    [
      accounts,
      messages,
      settings.ratePerHour,
      settings.ratePerMinute,
      settings.rateMinIntervalSec,
    ]
  );

  if (!accounts.length) {
    return (
      <p className="text-[11px] text-zinc-600">
        {t("health.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!compact && (
        <div>
          <SectionLabel>{t("health.title")}</SectionLabel>
          <p className="mt-1 text-2xs leading-4 text-zinc-600">
            {t("health.hint")}
          </p>
        </div>
      )}
      {items.map((h, i) => {
        const acc = accounts.find((a) => a.id === h.accountId);
        const title = formatAccountDisplay({
          label: acc?.label,
          userName: acc?.userName,
          index1: i + 1,
        });
        return (
          <AccountHealthCard
            key={h.accountId}
            health={h}
            title={title}
            compact={compact}
          />
        );
      })}
    </div>
  );
}
