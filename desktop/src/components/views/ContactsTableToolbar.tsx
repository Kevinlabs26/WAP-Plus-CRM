import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Download,
  FilePlus2,
  GitMerge,
  RotateCcw,
  Search,
} from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { formatAccountDisplay } from "@/lib/accountLabels";
import type {
  ContactInactiveFilter,
  ContactSortField,
  ContactsTableFilterState,
} from "@/lib/contactsTableQuery";
import type { WaAccount } from "@/types/account";
import type { SalesStage } from "@/types/crm";
import { useI18n } from "@/i18n";

interface ContactsTableToolbarProps {
  filter: ContactsTableFilterState;
  totalPeopleCount: number;
  filteredCount: number;
  selectedCount: number;
  pendingFollowUpCount: number;
  duplicateGroupCount: number;
  duplicateExtraCount: number;
  accounts: WaAccount[];
  stages: Array<{ id: SalesStage; label: string }>;
  availableTags: string[];
  isBaileys: boolean;
  busy: boolean;
  onFilterChange: (patch: Partial<ContactsTableFilterState>) => void;
  onResetFilters: () => void;
  onOpenImport: () => void;
  onOpenDedupe: () => void;
  onExportCsv: () => void;
}

/** Header summary, multi-dimensional filter controls, and primary actions for ContactsView. */
export function ContactsTableToolbar({
  filter,
  totalPeopleCount,
  filteredCount,
  selectedCount,
  pendingFollowUpCount,
  duplicateGroupCount,
  duplicateExtraCount,
  accounts,
  stages,
  availableTags,
  isBaileys,
  busy,
  onFilterChange,
  onResetFilters,
  onOpenImport,
  onOpenDedupe,
  onExportCsv,
}: ContactsTableToolbarProps) {
  const { t } = useI18n();
  const hasActiveFilter = Boolean(
    filter.keyword.trim() ||
      filter.accountId ||
      filter.stage ||
      filter.tag ||
      filter.inactiveDays !== "all" ||
      filter.onlyWithFollowUp
  );

  return (
    <div className="shrink-0 space-y-3 border-b border-zinc-800/80 bg-zinc-950/60 px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100">
              {t("contactsTable.title")}
            </h1>
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
              {t("contactsTable.countSummary", {
                shown: filteredCount,
                total: totalPeopleCount,
              })}
            </span>
            {pendingFollowUpCount > 0 && (
              <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand">
                {t("contactsTable.pendingFollowUps", { count: pendingFollowUpCount })}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-zinc-400">
            {t("contactsTable.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {duplicateGroupCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={onOpenDedupe}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
            >
              <GitMerge className="h-3.5 w-3.5" />
              {t("contactManage.dedupeBanner", {
                groups: duplicateGroupCount,
                extra: duplicateExtraCount,
              })}
            </button>
          )}
          <Button disabled={busy || filteredCount === 0} onClick={onExportCsv}>
            <Download className="h-3.5 w-3.5" />
            {selectedCount > 0
              ? t("contactsTable.exportSelected", { count: selectedCount })
              : t("crm.export")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onOpenImport}>
            <FilePlus2 className="h-3.5 w-3.5" />
            {t("crm.import")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            aria-label={t("contactsTable.searchPlaceholder")}
            placeholder={t("contactsTable.searchPlaceholder")}
            value={filter.keyword}
            onChange={(event) => onFilterChange({ keyword: event.target.value })}
            className="h-8 pl-8 text-[12px]"
          />
        </div>

        {isBaileys && accounts.length > 0 && (
          <select
            aria-label={t("contactsTable.filterAccount")}
            className="ui-control h-8 px-2.5 text-[12px]"
            value={filter.accountId}
            onChange={(event) => onFilterChange({ accountId: event.target.value })}
          >
            <option value="">{t("contactsTable.allAccounts")}</option>
            {accounts.map((account, index) => (
              <option key={account.id} value={account.id}>
                {formatAccountDisplay({ ...account, index1: index + 1 })}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label={t("contactsTable.filterStage")}
          className="ui-control h-8 px-2.5 text-[12px]"
          value={filter.stage}
          onChange={(event) => onFilterChange({ stage: event.target.value })}
        >
          <option value="">{t("contactsTable.allStages")}</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>

        <select
          aria-label={t("contactsTable.filterTag")}
          className="ui-control h-8 max-w-[160px] px-2.5 text-[12px]"
          value={filter.tag}
          onChange={(event) => onFilterChange({ tag: event.target.value })}
        >
          <option value="">{t("contactsTable.allTags")}</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>

        <select
          aria-label={t("contactsTable.filterInactive")}
          className="ui-control h-8 px-2.5 text-[12px]"
          value={filter.inactiveDays}
          onChange={(event) =>
            onFilterChange({ inactiveDays: event.target.value as ContactInactiveFilter })
          }
        >
          <option value="all">{t("contactsTable.inactiveAll")}</option>
          <option value="7">{t("contactsTable.inactive7")}</option>
          <option value="14">{t("contactsTable.inactive14")}</option>
          <option value="30">{t("contactsTable.inactive30")}</option>
          <option value="never">{t("contactsTable.inactiveNever")}</option>
        </select>

        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            checked={filter.onlyWithFollowUp}
            onChange={(event) => onFilterChange({ onlyWithFollowUp: event.target.checked })}
          />
          {t("contactsTable.onlyFollowUp")}
        </label>

        <div className="ml-auto flex items-center gap-1.5">
          <select
            aria-label={t("contactsTable.sortBy")}
            className="ui-control h-8 px-2.5 text-[12px]"
            value={filter.sortBy}
            onChange={(event) =>
              onFilterChange({ sortBy: event.target.value as ContactSortField })
            }
          >
            <option value="lastMessage">{t("contactsTable.sortLastMessage")}</option>
            <option value="name">{t("contactsTable.sortName")}</option>
            <option value="stage">{t("contactsTable.sortStage")}</option>
            <option value="nextFollowUp">{t("contactsTable.sortFollowUp")}</option>
          </select>
          <button
            type="button"
            aria-label={t("contactsTable.toggleSortDir")}
            title={t("contactsTable.toggleSortDir")}
            onClick={() =>
              onFilterChange({ sortDir: filter.sortDir === "desc" ? "asc" : "desc" })
            }
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          >
            {filter.sortDir === "desc" ? (
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
            )}
          </button>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={onResetFilters}
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("contactsTable.resetFilters")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
