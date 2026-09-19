import type { MutableRefObject } from "react";
import { useI18n } from "@/i18n";

export type FolderDialogState =
  | { type: "create"; parentId?: string }
  | { type: "rename"; folderId: string; name: string }
  | { type: "import"; folderId: string; text: string }
  | { type: "clear"; folderId: string; name: string }
  | { type: "delete"; folderId: string; name: string };

export type PendingFolderAction = {
  chatId: string;
  mode: "move" | "clone";
};

type FolderDialogProps = {
  dialog: FolderDialogState;
  pendingAction: PendingFolderAction | null;
  nameDraft: string;
  importText: string;
  importFolderName?: string;
  nameInputRef: MutableRefObject<HTMLInputElement | null>;
  onNameDraftChange: (value: string) => void;
  onImportTextChange: (value: string) => void;
  onClose: () => void;
  onSubmitName: (name: string) => void;
  onSubmitImport: () => void;
  onConfirmClear: () => void;
  onConfirmDelete: () => void;
};

export function FolderDialog({
  dialog,
  pendingAction,
  nameDraft,
  importText,
  importFolderName,
  nameInputRef,
  onNameDraftChange,
  onImportTextChange,
  onClose,
  onSubmitName,
  onSubmitImport,
  onConfirmClear,
  onConfirmDelete,
}: FolderDialogProps) {
  const { t } = useI18n();
  const isNameDialog = dialog.type === "create" || dialog.type === "rename";
  const submitName = () => {
    const name = nameInputRef.current?.value.trim() || "";
    if (name) onSubmitName(name);
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="border-b border-zinc-800 px-5 py-4">
          <h3 className="text-[15px] font-semibold text-zinc-100">
            {dialog.type === "create" && t("dialog.createGroup")}
            {dialog.type === "rename" && t("dialog.renameGroup")}
            {dialog.type === "import" && t("dialog.importNumbers", { name: importFolderName || t("folder.new") })}
            {dialog.type === "clear" && t("dialog.clearMembers")}
            {dialog.type === "delete" && t("dialog.deleteGroup")}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            {dialog.type === "create" &&
              (pendingAction
                ? pendingAction.mode === "move"
                  ? t("dialog.createMove")
                  : t("dialog.createClone")
                : t("dialog.createHint"))}
            {dialog.type === "rename" && t("dialog.renameHint")}
            {dialog.type === "import" && t("dialog.importHint")}
            {dialog.type === "clear" &&
              t("dialog.clearHint", { name: dialog.name })}
            {dialog.type === "delete" &&
              t("dialog.deleteHint", { name: dialog.name })}
          </p>
        </div>

        <div className="px-5 py-4">
          {isNameDialog && (
            <label className="block text-[11px] text-zinc-500">
              {t("dialog.groupName")}
              <input
                autoFocus
                ref={(element) => {
                  nameInputRef.current = element;
                }}
                defaultValue={nameDraft}
                maxLength={40}
                onChange={(event) => onNameDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitName();
                  }
                }}
                placeholder={t("dialog.groupPlaceholder")}
                className="ui-control mt-1.5 h-9 w-full px-3 text-[13px]"
              />
            </label>
          )}

          {dialog.type === "import" && (
            <textarea
              autoFocus
              value={importText}
              onChange={(event) => onImportTextChange(event.target.value)}
              rows={8}
              placeholder={"+12025550123\n+12025550124"}
              className="ui-control w-full resize-y px-3 py-2.5 text-[12px] leading-5"
            />
          )}

          {(dialog.type === "clear" || dialog.type === "delete") && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-[12px] leading-5 text-zinc-300">
              {dialog.type === "clear"
                ? t("dialog.clearWarning")
                : t("dialog.deleteWarning")}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-950/40 px-5 py-3">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
          >
            {t("dialog.cancel")}
          </button>
          {dialog.type === "create" && (
            <button
              type="button"
              className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
              onClick={submitName}
            >
              {pendingAction
                ? pendingAction.mode === "move"
                  ? t("dialog.createAndMove")
                  : t("dialog.createAndClone")
                : t("dialog.create")}
            </button>
          )}
          {dialog.type === "rename" && (
            <button
              type="button"
              className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
              onClick={submitName}
            >
              {t("dialog.save")}
            </button>
          )}
          {dialog.type === "import" && (
            <button
              type="button"
              className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
              disabled={!importText.trim()}
              onClick={onSubmitImport}
            >
              {t("dialog.import")}
            </button>
          )}
          {dialog.type === "clear" && (
            <button
              type="button"
              className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3.5 py-1.5 text-[12px] font-medium text-rose-200 hover:bg-rose-500/25"
              onClick={onConfirmClear}
            >
              {t("dialog.confirmClear")}
            </button>
          )}
          {dialog.type === "delete" && (
            <button
              type="button"
              className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3.5 py-1.5 text-[12px] font-medium text-rose-200 hover:bg-rose-500/25"
              onClick={onConfirmDelete}
            >
              {t("dialog.confirmDelete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
