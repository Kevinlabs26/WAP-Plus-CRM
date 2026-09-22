import { RotateCcw, X } from "lucide-react";
import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import {
  createDefaultLeadInboxSettings,
  type LeadInboxAccountScope,
  type LeadInboxDateGrouping,
  type LeadInboxSort,
} from "@/store/settingsDefaults";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

type Props = { onClose: () => void };

export function LeadInboxSettingsPopover({ onClose }: Props) {
  const { t } = useI18n();
  const settings = useAppStore((s) => s.settings.leadInbox);
  const accounts = useAppStore((s) => s.settings.waAccounts);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const patch = (value: Partial<typeof settings>) => {
    updateSettings({ leadInbox: { ...settings, ...value } });
  };
  const dismissedCount = settings.dismissedChatIds?.length ?? 0;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-inbox-settings-title"
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="max-h-[min(86vh,42rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700/90 bg-zinc-900 p-5 shadow-2xl shadow-black/50">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <h3 id="lead-inbox-settings-title" className="text-sm font-semibold text-zinc-100">{t("leadInbox.settingsTitle")}</h3>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">{t("leadInbox.settingsHint")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="mb-4 flex items-center gap-2 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2 text-[12px] text-zinc-200">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
          className="accent-emerald-500"
        />
        {t("leadInbox.enabled")}
      </label>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/25 p-3">
        <h4 className="mb-2 text-[11px] font-medium text-zinc-300">{t("leadInbox.displayRules")}</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-[10px] text-zinc-500">
          <span className="mb-1 block">{t("leadInbox.dateGrouping")}</span>
          <select
            value={settings.dateGrouping}
            onChange={(event) => patch({ dateGrouping: event.target.value as LeadInboxDateGrouping })}
            className="ui-control h-8 w-full text-[11px]"
          >
            <option value="day">{t("leadInbox.dateDay")}</option>
            <option value="week">{t("leadInbox.dateWeek")}</option>
            <option value="month">{t("leadInbox.dateMonth")}</option>
            <option value="none">{t("leadInbox.dateNone")}</option>
          </select>
        </label>
        <label className="text-[10px] text-zinc-500">
          <span className="mb-1 block">{t("leadInbox.dateRange")}</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={settings.dateRangeDays || ""}
            onChange={(event) => patch({ dateRangeDays: Number(event.target.value) || 0 })}
            placeholder={t("leadInbox.dateAll")}
            className="ui-control h-8 w-full text-[11px]"
          />
        </label>
        <label className="text-[10px] text-zinc-500">
          <span className="mb-1 block">{t("leadInbox.sort")}</span>
          <select
            value={settings.sort}
            onChange={(event) => patch({ sort: event.target.value as LeadInboxSort })}
            className="ui-control h-8 w-full text-[11px]"
          >
            <option value="first_contact">{t("leadInbox.sortFirst")}</option>
            <option value="last_message">{t("leadInbox.sortLast")}</option>
            <option value="unread">{t("leadInbox.sortUnread")}</option>
          </select>
        </label>
      </div>
      </section>

      <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/25 p-3">
        <h4 className="mb-2 text-[11px] font-medium text-zinc-300">{t("leadInbox.accountRules")}</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="text-[10px] text-zinc-500">
          <span className="mb-1 block">{t("leadInbox.accountScope")}</span>
          <select
            value={settings.accountScope}
            onChange={(event) => patch({ accountScope: event.target.value as LeadInboxAccountScope })}
            className="ui-control h-8 w-full text-[11px]"
          >
            <option value="view">{t("leadInbox.accountView")}</option>
            <option value="all">{t("leadInbox.accountAll")}</option>
            <option value="selected">{t("leadInbox.accountSelected")}</option>
          </select>
        </label>
        <label className="flex min-h-8 items-center gap-2 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={settings.includeGroups}
            onChange={(event) => patch({ includeGroups: event.target.checked })}
            className="accent-emerald-500"
          />
          {t("leadInbox.includeGroups")}
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={settings.mergeAccounts}
          onChange={(event) => patch({ mergeAccounts: event.target.checked })}
          className="accent-emerald-500"
        />
        {t("leadInbox.mergeAccounts")}
      </label>
      </section>

      {settings.accountScope === "selected" && (
        <div className="mt-2 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="text-[10px] text-zinc-500">{t("leadInbox.chooseAccounts")}</p>
          {accounts.length ? accounts.map((account) => {
            const checked = settings.selectedAccountIds.includes(account.id);
            return (
              <label key={account.id} className="flex items-center gap-2 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = new Set(settings.selectedAccountIds);
                    if (event.target.checked) next.add(account.id);
                    else next.delete(account.id);
                    patch({ selectedAccountIds: [...next] });
                  }}
                  className="accent-emerald-500"
                />
                <span className="truncate">{account.label || account.userName || account.id}</span>
              </label>
            );
          }) : <p className="text-[10px] text-zinc-600">{t("leadInbox.noAccounts")}</p>}
        </div>
      )}

      <label className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={settings.removeAfterReply}
          onChange={(event) => patch({ removeAfterReply: event.target.checked })}
          className="accent-emerald-500"
        />
        {t("leadInbox.removeAfterReply")}
      </label>

      <div className="mt-4 flex flex-col gap-3 border-t border-zinc-800 pt-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 flex-1 text-[10px] leading-4 text-zinc-600">{t("leadInbox.captureHint")}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
          {dismissedCount > 0 && (
            <button
              type="button"
              onClick={() => patch({ dismissedChatIds: [] })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/10"
              title={t("leadInbox.removedCount", {
                count: dismissedCount,
              })}
            >
              <RotateCcw className="h-3 w-3" />
              {t("leadInbox.restoreRemoved")}
            </button>
          )}
          <button
            type="button"
            onClick={() => patch(createDefaultLeadInboxSettings())}
            className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
          >
            <RotateCcw className="h-3 w-3" />
            {t("leadInbox.reset")}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
