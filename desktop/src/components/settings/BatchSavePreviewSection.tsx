import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { useI18n } from "@/i18n";
import {
  normalizeBatchPhone,
  parseBatchPastedContacts,
  type BatchContactRow,
} from "./batchSaveContactsHelpers";

const MAX_VISIBLE_ROWS = 300;

type TranslateFn = ReturnType<typeof useI18n>["t"];

type PreviewSectionProps = {
  t: TranslateFn;
  rows: BatchContactRow[];
  pasteText: string;
  prefix: string;
  suffix: string;
  onChangePasteText: (value: string) => void;
  onReplaceRows: (rows: BatchContactRow[]) => void;
  onNotifyParseFailed: () => void;
};

export function BatchSavePreviewSection({
  t,
  rows,
  pasteText,
  prefix,
  suffix,
  onChangePasteText,
  onReplaceRows,
  onNotifyParseFailed,
}: PreviewSectionProps) {
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);

  return (
    <section className="min-h-0 overflow-auto bg-zinc-950/25 p-4">
      <div className="mb-3 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-300">
            {t("batchContacts.pasteTitle")}
          </span>
          <span className="text-[10px] text-zinc-600">{t("batchContacts.pasteHint")}</span>
        </div>
        <textarea
          value={pasteText}
          onChange={(event) => onChangePasteText(event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = event.clipboardData.getData("text/plain");
            onChangePasteText(pasted);
            onReplaceRows(parseBatchPastedContacts(pasted));
          }}
          placeholder={t("batchContacts.pastePlaceholder")}
          rows={3}
          className="ui-control min-h-16 w-full resize-y px-2.5 py-2 text-[11px] leading-5"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-600">{t("batchContacts.autoLoadHint")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-2xs"
            onClick={() => {
              const parsed = parseBatchPastedContacts(pasteText);
              onReplaceRows(parsed);
              if (pasteText.trim() && !parsed.length) onNotifyParseFailed();
            }}
          >
            {t("batchContacts.parse")}
          </Button>
        </div>
      </div>

      <table className="w-full min-w-[620px] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-500 shadow-[0_1px_0_#27272a]">
          <tr>
            <th className="w-10 px-2 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) =>
                  onReplaceRows(rows.map((row) => ({ ...row, selected: event.target.checked })))
                }
              />
            </th>
            <th className="w-56 px-2 py-2 font-medium">{t("batchContacts.name")}</th>
            <th className="w-52 px-2 py-2 font-medium">{t("batchContacts.phone")}</th>
            <th className="px-2 py-2 font-medium">{t("batchContacts.previewName")}</th>
            <th className="w-16 px-2 py-2 font-medium">{t("contactImport.column.status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {visibleRows.map((row) => {
            const normalizedPhone = normalizeBatchPhone(row.phone);
            const isValidPhone = /^\+\d{7,15}$/.test(normalizedPhone);
            const previewFinalName = `${prefix}${row.name.trim() || normalizedPhone.slice(-4)}${suffix}`;
            return (
              <tr key={row.id} className="hover:bg-zinc-900/60">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(event) =>
                      onReplaceRows(
                        rows.map((item) =>
                          item.id === row.id ? { ...item, selected: event.target.checked } : item
                        )
                      )
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.name}
                    onChange={(event) =>
                      onReplaceRows(
                        rows.map((item) =>
                          item.id === row.id ? { ...item, name: event.target.value } : item
                        )
                      )
                    }
                    className="h-7 text-[11px]"
                    placeholder={t("batchContacts.namePlaceholder")}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.phone}
                    onChange={(event) =>
                      onReplaceRows(
                        rows.map((item) =>
                          item.id === row.id ? { ...item, phone: event.target.value } : item
                        )
                      )
                    }
                    className="h-7 font-mono text-[11px]"
                  />
                </td>
                <td className="max-w-64 truncate px-2 py-2 text-brand/80" title={previewFinalName}>
                  {previewFinalName}
                </td>
                <td className={cn("px-2 py-2", isValidPhone ? "text-emerald-400" : "text-rose-400")}>
                  {isValidPhone ? t("batchContacts.valid") : t("contactImport.invalid")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && (
        <div className="flex h-20 items-center justify-center text-[12px] text-zinc-600">
          {t("batchContacts.empty")}
        </div>
      )}
      {rows.length > MAX_VISIBLE_ROWS && (
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          {t("batchContacts.previewLimit", { total: rows.length, visible: MAX_VISIBLE_ROWS })}
        </p>
      )}
    </section>
  );
}
