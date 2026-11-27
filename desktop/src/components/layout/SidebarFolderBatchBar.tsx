import type { ChatFolder } from "@/store/types";
import { useI18n } from "@/i18n";

export interface SidebarFolderBatchAction {
  folderId: string;
  mode: "move" | "delete";
}

interface SidebarFolderBatchBarProps {
  batchAction: SidebarFolderBatchAction;
  selectedCount: number;
  busy: boolean;
  targetFolderId: string;
  deleteConfirmVisible: boolean;
  chatFolders: ChatFolder[];
  formatFolderOptionLabel: (folder: ChatFolder) => string;
  onTargetFolderChange: (folderId: string) => void;
  onCancel: () => void;
  onConfirmMove: () => void;
  onRequestDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onConfirmDelete: () => void;
}

/** Footer bar shown when batch-moving or batch-deleting chats inside a sidebar folder. */
export function SidebarFolderBatchBar({
  batchAction,
  selectedCount,
  busy,
  targetFolderId,
  deleteConfirmVisible,
  chatFolders,
  formatFolderOptionLabel,
  onTargetFolderChange,
  onCancel,
  onConfirmMove,
  onRequestDeleteConfirm,
  onCancelDeleteConfirm,
  onConfirmDelete,
}: SidebarFolderBatchBarProps) {
  const { t } = useI18n();

  return (
    <div className="mt-2 shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/90 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-400">
          {t("folder.batchSelectedCount", { count: selectedCount })}
        </span>
        <button
          type="button"
          className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          disabled={busy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
      </div>
      {batchAction.mode === "move" ? (
        <div className="flex gap-2">
          <select
            aria-label={t("folder.batchTarget")}
            className="ui-control h-8 min-w-0 flex-1 px-2 text-[11px]"
            value={targetFolderId}
            onChange={(event) => onTargetFolderChange(event.target.value)}
          >
            <option value="">{t("folder.ungrouped")}</option>
            {chatFolders
              .filter((folder) => folder.id !== batchAction.folderId)
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {formatFolderOptionLabel(folder)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="shrink-0 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-foreground)] disabled:opacity-40"
            disabled={!selectedCount}
            onClick={onConfirmMove}
          >
            {t("folder.batchMoveConfirm", { count: selectedCount })}
          </button>
        </div>
      ) : deleteConfirmVisible ? (
        <div className="space-y-2">
          <p role="alert" className="text-[11px] leading-4 text-rose-200">
            {t("folder.batchDeleteWarning")}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
              disabled={busy}
              onClick={onCancelDeleteConfirm}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-medium text-rose-200 disabled:opacity-40"
              disabled={busy}
              onClick={onConfirmDelete}
            >
              {t("common.confirm")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="w-full rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-medium text-rose-200 disabled:opacity-40"
          disabled={!selectedCount}
          onClick={onRequestDeleteConfirm}
        >
          {t("folder.batchDeleteConfirm", { count: selectedCount })}
        </button>
      )}
    </div>
  );
}
