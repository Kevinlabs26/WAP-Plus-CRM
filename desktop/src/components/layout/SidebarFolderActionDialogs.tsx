import type { RefObject } from "react";
import { useAppStore } from "@/store/appStore";
import type { ChatFolder } from "@/store/types";
import { useI18n } from "@/i18n";
import {
  FolderDialog,
  type FolderDialogState,
  type PendingFolderAction,
} from "./FolderDialog";

interface SidebarFolderActionDialogsProps {
  dialog: FolderDialogState;
  pendingAction: PendingFolderAction | null;
  nameDraft: string;
  importText: string;
  chatFolders: ChatFolder[];
  nameInputRef: RefObject<HTMLInputElement | null>;
  isAllAccountsView: boolean;
  onNameDraftChange: (value: string) => void;
  onImportTextChange: (value: string) => void;
  onClose: () => void;
  onClearPendingAction: () => void;
  onCreateFolder: (name: string, parentId?: string) => string | null;
  onRenameFolder: (folderId: string, name: string) => void;
  onMoveChatToFolder: (chatId: string, folderId: string) => void;
  onCloneChatToFolder: (chatId: string, folderId: string) => void;
  onDismissLeadChats: (chatIds: string[]) => void;
  onImportPhonesToFolder: (folderId: string, rawText: string) => void;
  onClearFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onNotifySuccess: (message: string) => void;
}

/** Coordinates folder create/rename/import/clear/delete dialog submissions. */
export function SidebarFolderActionDialogs({
  dialog,
  pendingAction,
  nameDraft,
  importText,
  chatFolders,
  nameInputRef,
  isAllAccountsView,
  onNameDraftChange,
  onImportTextChange,
  onClose,
  onClearPendingAction,
  onCreateFolder,
  onRenameFolder,
  onMoveChatToFolder,
  onCloneChatToFolder,
  onDismissLeadChats,
  onImportPhonesToFolder,
  onClearFolder,
  onDeleteFolder,
  onNotifySuccess,
}: SidebarFolderActionDialogsProps) {
  const { t } = useI18n();

  const handleSubmitName = (name: string) => {
    if (dialog.type === "create") {
      const createdId = onCreateFolder(name, dialog.parentId);
      if (createdId && pendingAction) {
        const targetChatIds = pendingAction.chatIds?.length
          ? pendingAction.chatIds
          : [pendingAction.chatId];
        if (pendingAction.mode === "move") {
          if (pendingAction.dismissFromLead && isAllAccountsView) {
            const currentSettings = useAppStore.getState().settings;
            useAppStore.getState().updateSettings({
              chatFolders: currentSettings.chatFolders.map((folder) =>
                folder.id === createdId
                  ? { ...folder, scope: { type: "all" as const } }
                  : folder
              ),
            });
          }
          targetChatIds.forEach((chatId) => onMoveChatToFolder(chatId, createdId));
          if (pendingAction.dismissFromLead) {
            onDismissLeadChats(targetChatIds);
          }
          onNotifySuccess(
            pendingAction.dismissFromLead
              ? t("leadInbox.movedDate", { count: targetChatIds.length, name })
              : `已移到「${name}」`
          );
        } else {
          targetChatIds.forEach((chatId) => onCloneChatToFolder(chatId, createdId));
        }
        onClearPendingAction();
      }
    } else if (dialog.type === "rename") {
      onRenameFolder(dialog.folderId, name);
    }
    onClose();
  };

  return (
    <FolderDialog
      dialog={dialog}
      pendingAction={pendingAction}
      nameDraft={nameDraft}
      importText={importText}
      importFolderName={
        dialog.type === "import"
          ? chatFolders.find((folder) => folder.id === dialog.folderId)?.name
          : undefined
      }
      nameInputRef={nameInputRef}
      onNameDraftChange={onNameDraftChange}
      onImportTextChange={onImportTextChange}
      onClose={() => {
        onClose();
        onClearPendingAction();
      }}
      onSubmitName={handleSubmitName}
      onSubmitImport={() => {
        if (dialog.type !== "import") return;
        onImportPhonesToFolder(dialog.folderId, importText);
        onImportTextChange("");
        onClose();
      }}
      onConfirmClear={() => {
        if (dialog.type !== "clear") return;
        onClearFolder(dialog.folderId);
        onClose();
      }}
      onConfirmDelete={() => {
        if (dialog.type !== "delete") return;
        onDeleteFolder(dialog.folderId);
        onClose();
      }}
    />
  );
}
