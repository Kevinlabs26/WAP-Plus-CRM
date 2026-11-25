import { CornerDownRight, EyeOff, FolderInput, FolderPlus } from "lucide-react";
import { LEAD_INBOX_FOLDER_ID } from "@/store/settingsDefaults";
import type { ChatFolder } from "@/store/types";
import type { ChatPreview, Contact } from "@/types/crm";
import { useI18n } from "@/i18n";

export interface SidebarLeadDateMenuState {
  x: number;
  y: number;
  label: string;
  chatIds: string[];
}

interface SidebarLeadDateMenuProps {
  menu: SidebarLeadDateMenuState;
  chatFolders: ChatFolder[];
  chats: ChatPreview[];
  contacts: Contact[];
  dataAccountId: string;
  buildFolderTreeRows: (folders: ChatFolder[]) => Array<{ folder: ChatFolder; depth: number }>;
  formatFolderDisplayName: (folder: ChatFolder) => string;
  onMoveToNewFolder: (chatIds: string[]) => void;
  onMoveToFolder: (chatIds: string[], folderId: string, folderName: string) => void;
  onDismissDate: (chatIds: string[]) => void;
}

/** Context popover for moving or dismissing a date group inside the Lead Inbox folder. */
export function SidebarLeadDateMenu({
  menu,
  chatFolders,
  chats,
  contacts,
  dataAccountId,
  buildFolderTreeRows,
  formatFolderDisplayName,
  onMoveToNewFolder,
  onMoveToFolder,
  onDismissDate,
}: SidebarLeadDateMenuProps) {
  const { t } = useI18n();

  const chatById = new Map(chats.map((item) => [item.id, item]));
  const contactById = new Map(contacts.map((item) => [item.id, item]));
  const menuAccountIds = new Set(
    menu.chatIds
      .map((chatId) => {
        const chat = chatById.get(chatId);
        const contact = chat ? contactById.get(chat.contactId) : undefined;
        return chat?.accountId || contact?.accountId || chat?.phoneId || dataAccountId;
      })
      .filter(Boolean)
  );

  const eligibleFolders = buildFolderTreeRows(chatFolders).filter(({ folder }) => {
    if (folder.id === LEAD_INBOX_FOLDER_ID) return false;
    if (menuAccountIds.size > 1) return folder.scope?.type === "all";
    if (folder.scope?.type === "all") return true;
    const onlyAccount = [...menuAccountIds][0] || dataAccountId;
    return !folder.scope || folder.scope.accountId === onlyAccount;
  });

  return (
    <div
      data-lead-date-menu
      className="fixed z-[10020] w-60 overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900 p-1.5 shadow-2xl shadow-black/50"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="border-b border-zinc-800 px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-zinc-200">{menu.label}</p>
        <p className="mt-0.5 text-[10px] text-zinc-500">
          {t("leadInbox.dateConversationCount", { count: menu.chatIds.length })}
        </p>
      </div>
      <button
        type="button"
        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
        onClick={() => onMoveToNewFolder(menu.chatIds)}
      >
        <FolderPlus className="h-3.5 w-3.5 text-zinc-500" />
        {t("leadInbox.moveDateToNewFolder")}
      </button>
      {chatFolders.length > 0 && (
        <>
          <p className="px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
            {t("leadInbox.moveDateToFolder")}
          </p>
          <div className="max-h-44 overflow-y-auto">
            {eligibleFolders.map(({ folder, depth }) => (
              <button
                key={folder.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                style={{ paddingLeft: 8 + Math.min(depth, 5) * 12 }}
                onClick={() =>
                  onMoveToFolder(menu.chatIds, folder.id, formatFolderDisplayName(folder))
                }
              >
                {depth ? (
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                ) : (
                  <FolderInput className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                )}
                <span className="truncate">{formatFolderDisplayName(folder)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-1 border-t border-zinc-800 pt-1">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-amber-300 hover:bg-amber-500/10"
          onClick={() => onDismissDate(menu.chatIds)}
        >
          <EyeOff className="h-3.5 w-3.5" />
          {t("leadInbox.removeDate")}
        </button>
      </div>
    </div>
  );
}
