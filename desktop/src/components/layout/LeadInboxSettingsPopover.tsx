import { RotateCcw, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import {
  createDefaultLeadInboxSettings,
  type LeadInboxAccountScope,
  type LeadInboxDateGrouping,
  type LeadInboxSort,
  type LeadInboxStatusFilter,
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

  return (
    <div className="mb-2 max-h-[min(60vh,28rem)] overflow-y-auto rounded-xl border border-brand/25 bg-zinc-900/95 p-3 shadow-xl shadow-black/30">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-zinc-100">{t("leadInbox.settingsTitle")}</h3>
          <p className="mt-0.5 text-[10px] text-zinc-500">{t("leadInbox.settingsHint")}</p>
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

      <label className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => patch({ enabled: event.target.checked })}
          className="accent-emerald-500"
        />
        {t("leadInbox.enabled")}
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-zinc-500">
          <span className="mb-1 block">{t("leadInbox.status")}</span>
          <select
            value={settings.statusFilter}
            onChange={(event) => patch({ statusFilter: event.target.value as LeadInboxStatusFilter })}
            className="ui-control h-8 w-full text-[11px]"
          >
            <option value="pending">{t("leadInbox.statusPending")}</option>
            <option value="all">{t("leadInbox.statusAll")}</option>
            <option value="replied">{t("leadInbox.statusReplied")}</option>
          </select>
        </label>
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

      <div className="mt-2 grid grid-cols-2 gap-2">
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
        <label className="flex items-end gap-2 pb-1 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={settings.includeGroups}
            onChange={(event) => patch({ includeGroups: event.target.checked })}
            className="accent-emerald-500"
          />
          {t("leadInbox.includeGroups")}
        </label>
      </div>

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

      <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={settings.mergeAccounts}
          onChange={(event) => patch({ mergeAccounts: event.target.checked })}
          className="accent-emerald-500"
        />
        {t("leadInbox.mergeAccounts")}
      </label>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800 pt-2">
        <p className="text-[10px] leading-4 text-zinc-600">{t("leadInbox.captureHint")}</p>
        <button
          type="button"
          onClick={() => patch(createDefaultLeadInboxSettings())}
          className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          <RotateCcw className="h-3 w-3" />
          {t("leadInbox.reset")}
        </button>
      </div>
    </div>
  );
}
