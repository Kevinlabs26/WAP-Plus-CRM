import { ClipboardPaste } from "lucide-react";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  applyImportNameRule,
  type ContactImportResult,
  type DuplicateHandlingMode,
  type ImportNameRule,
  type ImportRowResult,
} from "@/lib/contactImport";
import {
  filterImportRowsForPreview,
  shouldUpdateDuplicateRow,
  type ImportPreviewFilter,
} from "./contactImportModalHelpers";

const PREVIEW_ROW_LIMIT = 300;

type PreviewProps = {
  importAnalysis: ContactImportResult | null;
  activeFilter: ImportPreviewFilter;
  onSelectFilter: (nextFilter: ImportPreviewFilter) => void;
  duplicateMode: DuplicateHandlingMode;
  nameRule: ImportNameRule;
  nameOverrides: Record<number, string>;
  onChangeNameOverride: (lineNumber: number, nextValue: string) => void;
};

function ImportSummaryFilterCards({
  importAnalysis,
  activeFilter,
  duplicateMode,
  onSelectFilter,
}: {
  importAnalysis: ContactImportResult;
  activeFilter: ImportPreviewFilter;
  duplicateMode: DuplicateHandlingMode;
  onSelectFilter: (nextFilter: ImportPreviewFilter) => void;
}) {
  const { t } = useI18n();
  const updatableCount = importAnalysis.skipped.filter((row) =>
    shouldUpdateDuplicateRow(row, duplicateMode)
  ).length;
  const importableCount = importAnalysis.created.length + updatableCount;
  const duplicateCount = importAnalysis.skipped.filter(
    (row) => row.status === "skip_dup" && !shouldUpdateDuplicateRow(row, duplicateMode)
  ).length;
  const invalidCount =
    importAnalysis.skipped.filter((row) => row.status === "skip_no_phone").length +
    importAnalysis.errors.length;

  const cards: {
    id: ImportPreviewFilter;
    label: string;
    count: number;
    toneClass: string;
    activeClass: string;
  }[] = [
    {
      id: "all",
      label: t("contactImport.total"),
      count: importAnalysis.rows.length,
      toneClass: "border-zinc-700 bg-zinc-800/55 text-zinc-300",
      activeClass: "ring-1 ring-zinc-400",
    },
    {
      id: "ready",
      label: t("contactImport.importable"),
      count: importableCount,
      toneClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
      activeClass: "ring-1 ring-emerald-400",
    },
    {
      id: "duplicates",
      label: t("contactImport.duplicates"),
      count: duplicateCount,
      toneClass: "border-amber-500/25 bg-amber-500/10 text-amber-100",
      activeClass: "ring-1 ring-amber-400",
    },
    {
      id: "invalid",
      label: t("contactImport.invalid"),
      count: invalidCount,
      toneClass: "border-rose-500/25 bg-rose-500/10 text-rose-100",
      activeClass: "ring-1 ring-rose-400",
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        {cards.map((card) => {
          const isSelected = activeFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectFilter(isSelected && card.id !== "all" ? "all" : card.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-shadow hover:brightness-105",
                card.toneClass,
                isSelected && card.activeClass
              )}
            >
              {card.label} <strong className="ml-1">{card.count}</strong>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-zinc-500">{t("contactImport.filterHint")}</p>
    </div>
  );
}

function renderRowStatusBadge(
  row: ImportRowResult,
  duplicateMode: DuplicateHandlingMode,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (row.status === "ready" || shouldUpdateDuplicateRow(row, duplicateMode)) {
    return <span className="text-emerald-400">{t("contactImport.importable")}</span>;
  }
  if (row.status === "skip_dup") {
    if (row.duplicateSource === "batch_duplicate") {
      return <span className="text-amber-400">{t("contactImport.status.batchDuplicate")}</span>;
    }
    if (row.existingContactHasHumanName && row.existingContactName) {
      return (
        <span className="text-amber-400" title={row.existingContactName}>
          {t("contactImport.status.existingNamed", { name: row.existingContactName })}
        </span>
      );
    }
    return <span className="text-amber-400">{t("contactImport.status.existingUnnamed")}</span>;
  }
  return (
    <span className="text-rose-400" title={row.reason}>
      {t("contactImport.invalid")}
    </span>
  );
}

export function ContactImportPreviewSection({
  importAnalysis,
  activeFilter,
  onSelectFilter,
  duplicateMode,
  nameRule,
  nameOverrides,
  onChangeNameOverride,
}: PreviewProps) {
  const { t } = useI18n();

  if (!importAnalysis?.rows.length) {
    return (
      <section className="flex min-h-0 flex-col bg-zinc-950/25 p-4">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <ClipboardPaste className="h-8 w-8 text-zinc-600" />
          <p className="mt-3 text-[13px] text-zinc-400">{t("contactImport.previewEmpty")}</p>
          <p className="mt-1 text-[11px] text-zinc-600">{t("contactImport.previewHint")}</p>
        </div>
      </section>
    );
  }

  const filteredRows = filterImportRowsForPreview(importAnalysis, activeFilter, duplicateMode);
  const visiblePreviewRows = filteredRows.slice(0, PREVIEW_ROW_LIMIT);
  const skippedInactiveCount = importAnalysis.skipped.filter(
    (row) => !shouldUpdateDuplicateRow(row, duplicateMode)
  ).length;

  return (
    <section className="flex min-h-0 flex-col bg-zinc-950/25 p-4">
      <ImportSummaryFilterCards
        importAnalysis={importAnalysis}
        activeFilter={activeFilter}
        duplicateMode={duplicateMode}
        onSelectFilter={onSelectFilter}
      />

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/45">
        <table className="w-full min-w-[680px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-500 shadow-[0_1px_0_#27272a]">
            <tr>
              <th className="w-12 px-3 py-2 font-medium">{t("contactImport.column.row")}</th>
              <th className="w-52 px-3 py-2 font-medium">{t("contactImport.column.name")}</th>
              <th className="w-36 px-3 py-2 font-medium">{t("contactImport.column.phone")}</th>
              <th className="w-32 px-3 py-2 font-medium">{t("contactImport.column.company")}</th>
              <th className="px-3 py-2 font-medium">{t("contactImport.column.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {visiblePreviewRows.map((row, rowIndex) => {
              const rowInput = row.input;
              const isActionableRow =
                row.status === "ready" || shouldUpdateDuplicateRow(row, duplicateMode);
              const editableName = nameOverrides[row.line] ?? rowInput?.name ?? "";
              const computedFinalName = isActionableRow
                ? applyImportNameRule(editableName, rowInput?.phone, rowIndex, nameRule)
                : editableName;

              return (
                <tr
                  key={row.line}
                  className={cn(
                    "hover:bg-zinc-900/60",
                    !isActionableRow && "opacity-75"
                  )}
                >
                  <td className="px-3 py-2 font-mono text-zinc-600">{row.line}</td>
                  <td className="px-3 py-1.5">
                    {isActionableRow ? (
                      <>
                        <Input
                          value={editableName}
                          placeholder={t("contactImport.autoGenerated")}
                          className="h-7 text-[11px]"
                          onChange={(event) => onChangeNameOverride(row.line, event.target.value)}
                        />
                        {(nameRule.prefix || nameRule.suffix || !editableName.trim()) && (
                          <div className="mt-1 truncate text-[9px] text-brand/80">
                            → {computedFinalName}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="block truncate px-1 text-zinc-400">
                        {rowInput?.name || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-300">{rowInput?.phone || "—"}</td>
                  <td className="max-w-40 truncate px-3 py-2 text-zinc-400">
                    {rowInput?.company || "—"}
                  </td>
                  <td className="max-w-60 truncate px-3 py-2">
                    {renderRowStatusBadge(row, duplicateMode, t)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredRows.length > PREVIEW_ROW_LIMIT && (
          <div className="border-t border-zinc-800 px-3 py-2 text-center text-[10px] text-zinc-500">
            {t("contactImport.previewLimit", {
              preview: PREVIEW_ROW_LIMIT,
              total: filteredRows.length,
            })}
          </div>
        )}
      </div>

      {skippedInactiveCount > 0 && (
        <p className="mt-2 text-[10px] text-zinc-500">
          {t("contactImport.skippedHint", { count: skippedInactiveCount })}
        </p>
      )}
    </section>
  );
}
