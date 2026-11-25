import type { ChatFolder } from "@/store/types";
import type { WaAccount } from "@/types/account";
import type { ChatPreview, Contact, GroupDetails } from "@/types/crm";
import { FolderGroupImportDialog } from "./FolderGroupImportDialog";
import { useI18n } from "@/i18n";

export interface SidebarGroupFolderDialogState {
  folderId: string;
  mode: "links" | "existing";
}

interface SidebarFolderGroupImportHostProps {
  dialog: SidebarGroupFolderDialogState;
  chatFolders: ChatFolder[];
  chats: ChatPreview[];
  contacts: Contact[];
  waAccounts: WaAccount[];
  connectedAccountIds: string[];
  dataAccountId: string;
  syncAccountId: string;
  accountLabelOf: (accountId?: string | null) => string;
  onClose: () => void;
  onMoveChatToFolder: (chatId: string, folderId: string) => void;
  onAddJoinedGroup: (
    folderId: string,
    groupJid: string,
    group: GroupDetails,
    accountId: string
  ) => void | Promise<void>;
  onFileImportedGroup: (folderId: string, chatId: string) => void;
  onNotifyMoved: (message: string) => void;
}

/** Resolves scoped group candidates and mounts FolderGroupImportDialog for a sidebar folder. */
export function SidebarFolderGroupImportHost({
  dialog,
  chatFolders,
  chats,
  contacts,
  waAccounts,
  connectedAccountIds,
  dataAccountId,
  syncAccountId,
  accountLabelOf,
  onClose,
  onMoveChatToFolder,
  onAddJoinedGroup,
  onFileImportedGroup,
  onNotifyMoved,
}: SidebarFolderGroupImportHostProps) {
  const { t } = useI18n();
  const folder = chatFolders.find((item) => item.id === dialog.folderId);
  if (!folder) return null;

  const scopedAccountId =
    folder.scope?.type === "account"
      ? folder.scope.accountId
      : folder.scope?.type === "all"
        ? null
        : dataAccountId;
  const folderMembers = new Set(folder.chatIds);
  const folderGroups = chats.filter((chat) => {
    const accountId = chat.accountId || chat.phoneId;
    return (
      chat.isGroup === true &&
      !chat.localOnly &&
      !folderMembers.has(chat.id) &&
      (!scopedAccountId || accountId === scopedAccountId)
    );
  });

  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const existingGroupChatIds: Record<string, string> = {};
  for (const chat of chats) {
    if (chat.isGroup !== true) continue;
    const jid = contactsById.get(chat.contactId)?.channelAddress;
    if (!jid) continue;
    const accountId = chat.accountId || chat.phoneId;
    const key = `${accountId}|${jid}`;
    if (
      !existingGroupChatIds[key] ||
      chat.id === `bridge-chat-${chat.contactId}` ||
      chat.id === `chat-${chat.contactId}`
    ) {
      existingGroupChatIds[key] = chat.id;
    }
  }

  const initialAccountId =
    scopedAccountId ||
    (connectedAccountIds.includes(syncAccountId)
      ? syncAccountId
      : connectedAccountIds[0] || "");

  return (
    <FolderGroupImportDialog
      mode={dialog.mode}
      folderName={folder.name}
      groups={folderGroups}
      accounts={waAccounts}
      connectedAccountIds={connectedAccountIds}
      existingGroupChatIds={existingGroupChatIds}
      accountLabelOf={accountLabelOf}
      initialAccountId={initialAccountId}
      fixedAccountId={scopedAccountId || undefined}
      onClose={onClose}
      onMoveGroups={(chatIds) => {
        chatIds.forEach((chatId) => onMoveChatToFolder(chatId, folder.id));
        onNotifyMoved(
          t("folderGroups.moved", { count: chatIds.length, name: folder.name })
        );
        onClose();
      }}
      onJoined={(groupJid, group, accountId) =>
        onAddJoinedGroup(folder.id, groupJid, group, accountId)
      }
      onAlreadyJoined={(chatId) => onFileImportedGroup(folder.id, chatId)}
    />
  );
}
