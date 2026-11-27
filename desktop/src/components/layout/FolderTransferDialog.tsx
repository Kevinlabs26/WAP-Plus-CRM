import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { downloadJson, readJsonFile } from "@/lib/exportData";
import { exportContactFolderBackup, importContactFolderBackup, parseContactFolderBackup } from "@/lib/contactFolderBackup";
import { useAppStore } from "@/store/appStore";
import { flushPersist } from "@/store/persist";
import { isDataRestoreActive } from "@/store/restoreGuard";

type Props = { mode: "import" | "export"; initialAccountId?: string | null; initiallyMerged?: boolean; onClose: () => void };
const MERGED = "__merged__";

export function FolderTransferDialog({ mode, initialAccountId, initiallyMerged, onClose }: Props) {
  const { t } = useI18n();
  const folderAccounts = useAppStore(s => s.settings.waAccounts);
  const [folderAccount, setFolderAccount] = useState(initiallyMerged ? MERGED : initialAccountId || "");
  const merged = folderAccount === MERGED;
  const preferredAccount = merged ? initialAccountId : folderAccount;
  const selectedFolderAccount = folderAccounts.find(account => account.id === preferredAccount) || folderAccounts[0];
  const [folderBackupBusy, setFolderBackupBusy] = useState(false);
  const folderBackupFile = useRef<HTMLInputElement>(null);
  async function transferFolders(file?: File) {
    if (!selectedFolderAccount || folderBackupBusy) return;
    const accountId = selectedFolderAccount.id;
    setFolderBackupBusy(true);
    try {
      const backup = file ? parseContactFolderBackup(await readJsonFile(file)) : undefined;
      if (backup && !await useAppStore.getState().requestConfirm({
        title: t("folderTransfer.import"), description: t(merged ? "folderTransfer.confirmMerged" : "folderTransfer.confirm", {
          account: selectedFolderAccount.label || accountId,
          folders: backup.folders.length, members: backup.members.length,
        }), confirmLabel: t("folderTransfer.import"), cancelLabel: t("common.cancel"),
      })) return;
      const state = useAppStore.getState();
      if (!state.hydrated || isDataRestoreActive() || !state.settings.waAccounts.some(account => account.id === accountId)) {
        throw new Error("folderTransfer.unavailable");
      }
      const data = { contacts: state.contacts, chats: state.chats, chatFolders: state.settings.chatFolders, chatFolderClones: state.settings.chatFolderClones };
      if (!backup) {
        downloadJson("contact-folders.json", exportContactFolderBackup(data, merged ? null : accountId));
        onClose();
        return;
      }
      const next = importContactFolderBackup(data, backup, accountId, merged ? state.settings.waAccounts.map(account => account.id) : undefined);
      useAppStore.setState({ contacts: next.contacts, chats: next.chats, settings: { ...state.settings, chatFolders: next.chatFolders, chatFolderClones: next.chatFolderClones } });
      state.recomputeStats();
      await flushPersist(() => useAppStore.getState());
      state.pushToast(t("folderTransfer.done", { assigned: next.assigned, skipped: next.skipped }), "success");
      onClose();
    } catch (error) {
      useAppStore.getState().pushToast(t(error instanceof Error && error.message === "folderTransfer.invalid"
        ? "folderTransfer.invalid" : "folderTransfer.unavailable"), "error");
    } finally { setFolderBackupBusy(false); }
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !folderBackupBusy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [folderBackupBusy, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={event => { if (event.target === event.currentTarget && !folderBackupBusy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="folder-transfer-title"
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-xl">
        <h2 id="folder-transfer-title" className="font-semibold">{t(mode === "import" ? "folderTransfer.import" : "folderTransfer.export")}</h2>
        <label className="flex flex-col gap-1 text-sm">
          {t("folderTransfer.account")}
          <select autoFocus className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            value={merged ? MERGED : selectedFolderAccount?.id || ""} disabled={folderBackupBusy} onChange={event => setFolderAccount(event.target.value)}>
            <option value={MERGED}>{t("account.allAccountsMerged")}</option>
            {folderAccounts.map(account => <option key={account.id} value={account.id}>{account.label || account.id}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={folderBackupBusy} onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" variant="primary" disabled={!selectedFolderAccount || folderBackupBusy}
            onClick={() => mode === "import" ? folderBackupFile.current?.click() : void transferFolders()}>
            {t(mode === "import" ? "folderTransfer.import" : "folderTransfer.export")}
          </Button>
          <input ref={folderBackupFile} type="file" accept=".json,.txt,application/json,text/plain" className="hidden" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void transferFolders(file);
          }} />
        </div>
      </section>
    </div>,
    document.body,
  );
}
