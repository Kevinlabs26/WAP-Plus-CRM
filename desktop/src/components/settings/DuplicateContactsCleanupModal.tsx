import { useState } from "react";
import { GitMerge, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useAppStore, flushPersist } from "@/store/appStore";
import { useI18n } from "@/i18n";
import type { DuplicateContactGroup } from "@/lib/contactDeduplication";

interface DuplicateContactsCleanupModalProps {
  open: boolean;
  accountId?: string;
  groups: DuplicateContactGroup[];
  onClose: () => void;
}

export function DuplicateContactsCleanupModal({
  open,
  accountId,
  groups,
  onClose,
}: DuplicateContactsCleanupModalProps) {
  const { t } = useI18n();
  const [merging, setMerging] = useState(false);

  if (!open) return null;

  const totalExtraCount = groups.reduce(
    (sum, group) => sum + group.duplicates.length,
    0
  );

  const handleConfirmMerge = async () => {
    if (merging || !groups.length) return;
    setMerging(true);
    try {
      const summary = useAppStore.getState().dedupeAccountContacts(accountId);
      await flushPersist(useAppStore.getState);
      if (summary.removedContacts > 0) {
        useAppStore.getState().pushToast(
          t("contactManage.dedupeDone", {
            groups: summary.groupsMerged,
            removed: summary.removedContacts,
          }),
          "success"
        );
      } else {
        useAppStore.getState().pushToast(t("contactManage.dedupeNone"), "info");
      }
      onClose();
    } catch (error) {
      useAppStore.getState().pushToast(String(error), "error");
    } finally {
      setMerging(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("contactManage.dedupeTitle")}
    >
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
              <GitMerge className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold">
                {t("contactManage.dedupeTitle")}
              </h2>
              <p className="mt-0.5 text-[12px] text-zinc-400">
                {t("contactManage.dedupeSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={merging}
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-zinc-800/80 bg-emerald-950/25 px-5 py-2.5 text-[12px] text-emerald-300">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>{t("contactManage.dedupeSafeNote")}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-zinc-400">
              {t("contactManage.dedupeNone")}
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.groupKey}
                className="rounded-lg border border-zinc-800/90 bg-zinc-900/60 px-3.5 py-2.5 text-[12px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] font-medium text-zinc-200">
                    {group.normalizedPhone}
                  </span>
                  {group.mergedTagsPreview.length > 0 && (
                    <span className="truncate text-[11px] text-brand">
                      {group.mergedTagsPreview.join(" · ")}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-emerald-400">
                    {t("contactManage.dedupeKeep")}:{" "}
                    <strong className="font-medium text-zinc-100">
                      {group.keeper.name || group.normalizedPhone}
                    </strong>
                  </span>
                  <span className="text-amber-400">
                    {t("contactManage.dedupeMergeFrom")}:{" "}
                    {group.duplicates
                      .map((item) => item.name || item.phone || item.id)
                      .join("、")}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <Button disabled={merging} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={merging || totalExtraCount === 0}
            onClick={() => void handleConfirmMerge()}
          >
            {merging
              ? t("common.saving")
              : t("contactManage.dedupeConfirm", { extra: totalExtraCount })}
          </Button>
        </div>
      </div>
    </div>
  );
}
