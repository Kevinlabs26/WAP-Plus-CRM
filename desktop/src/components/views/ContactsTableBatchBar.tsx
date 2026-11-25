import { useState } from "react";
import { CloudUpload, Trash2, X } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { formatAccountDisplay } from "@/lib/accountLabels";
import type { WaAccount } from "@/types/account";
import type { SalesStage } from "@/types/crm";
import { useI18n } from "@/i18n";

interface ContactsTableBatchBarProps {
  selectedCount: number;
  stages: Array<{ id: SalesStage; label: string }>;
  accounts: WaAccount[];
  connectedAccountIds: string[];
  isBaileys: boolean;
  cloudTargetAccountId: string;
  savingCloud: boolean;
  onCloudTargetChange: (accountId: string) => void;
  onBatchSetStage: (stage: SalesStage) => void;
  onBatchAddTag: (tag: string) => void;
  onBatchScheduleFollowUp: (dueAt: string) => void;
  onBatchSaveToCloud: () => void;
  onBatchDelete: () => void;
  onClearSelection: () => void;
}

/** Contextual batch-action bar displayed whenever one or more contacts are checked. */
export function ContactsTableBatchBar({
  selectedCount,
  stages,
  accounts,
  connectedAccountIds,
  isBaileys,
  cloudTargetAccountId,
  savingCloud,
  onCloudTargetChange,
  onBatchSetStage,
  onBatchAddTag,
  onBatchScheduleFollowUp,
  onBatchSaveToCloud,
  onBatchDelete,
  onClearSelection,
}: ContactsTableBatchBarProps) {
  const { t } = useI18n();
  const [stageDraft, setStageDraft] = useState<string>("");
  const [tagDraft, setTagDraft] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState("");

  if (selectedCount === 0) return null;

  return (
    <div className="shrink-0 border-b border-brand/25 bg-brand/10 px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-semibold text-brand">
          {t("contactManage.selected", { count: selectedCount })}
        </span>

        <div className="flex items-center gap-1">
          <select
            aria-label={t("contactsTable.batchStage")}
            className="ui-control h-8 px-2 text-[12px]"
            disabled={savingCloud}
            value={stageDraft}
            onChange={(event) => setStageDraft(event.target.value)}
          >
            <option value="">{t("contactsTable.batchStage")}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </select>
          <Button
            disabled={savingCloud || !stageDraft}
            onClick={() => {
              if (!stageDraft) return;
              onBatchSetStage(stageDraft as SalesStage);
              setStageDraft("");
            }}
          >
            {t("common.confirm")}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Input
            aria-label={t("crm.addTagPlaceholder")}
            placeholder={t("crm.addTagPlaceholder")}
            disabled={savingCloud}
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            className="h-8 w-36 text-[12px]"
          />
          <Button
            disabled={savingCloud || !tagDraft.trim()}
            onClick={() => {
              onBatchAddTag(tagDraft.trim());
              setTagDraft("");
            }}
          >
            {t("crm.addTag")}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <input
            type="date"
            aria-label={t("crm.schedule")}
            disabled={savingCloud}
            value={followUpDraft}
            onChange={(event) => setFollowUpDraft(event.target.value)}
            className="ui-control h-8 px-2 text-[12px]"
          />
          <Button
            disabled={savingCloud || !followUpDraft}
            onClick={() => {
              onBatchScheduleFollowUp(followUpDraft);
              setFollowUpDraft("");
            }}
          >
            {t("crm.schedule")}
          </Button>
        </div>

        {isBaileys && accounts.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              aria-label={t("contactManage.target")}
              className="ui-control h-8 max-w-[180px] px-2 text-[12px]"
              disabled={savingCloud}
              value={cloudTargetAccountId}
              onChange={(event) => onCloudTargetChange(event.target.value)}
            >
              <option value="">{t("batchContacts.selectConnectedAccount")}</option>
              {accounts.map((account, index) => (
                <option key={account.id} value={account.id}>
                  {formatAccountDisplay({ ...account, index1: index + 1 })}
                  {connectedAccountIds.includes(account.id) ? "" : ` · ${t("common.offline")}`}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              disabled={savingCloud || !connectedAccountIds.includes(cloudTargetAccountId)}
              onClick={onBatchSaveToCloud}
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {t(savingCloud ? "common.saving" : "contactManage.saveAccount")}
            </Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            disabled={savingCloud}
            onClick={onBatchDelete}
            className="border-rose-500/40 text-rose-300 hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("common.delete")}
          </Button>
          <button
            type="button"
            disabled={savingCloud}
            onClick={onClearSelection}
            aria-label={t("common.cancel")}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
