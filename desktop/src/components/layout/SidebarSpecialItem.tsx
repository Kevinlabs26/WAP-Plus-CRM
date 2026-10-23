import {
  Archive,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Inbox,
  FolderPlus,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export type SidebarSpecialItem =
  | { kind: "hint"; text: string }
  | { kind: "archive_toggle"; showArchived: boolean; archivedCount: number }
  | { kind: "new_folder"; isAllAccountsView: boolean }
  | { kind: "folder_empty"; folderId: string; dragging: boolean; dropActive: boolean }
  | {
      kind: "lead_date_header";
      groupId: string;
      label: string;
      total: number;
      collapsed: boolean;
    }
  | {
      kind: "ungrouped_header";
      total: number;
      unread: number;
      containsSelected?: boolean;
      collapsed: boolean;
      isAllAccountsView: boolean;
      dropActive: boolean;
    }
  | { kind: "empty"; query: string; contactsCount: number; syncing: boolean };

type Props = {
  item: SidebarSpecialItem;
  onToggleArchived: () => void;
  onCreateFolder: () => void;
  onToggleUngrouped: () => void;
  onToggleLeadDate?: (groupId: string) => void;
  onOpenLeadDateMenu?: (
    event: React.MouseEvent<HTMLButtonElement>,
    groupId: string
  ) => void;
  onSync: () => void;
};

export function SidebarSpecialItem({
  item,
  onToggleArchived,
  onCreateFolder,
  onToggleUngrouped,
  onToggleLeadDate,
  onOpenLeadDateMenu,
  onSync,
}: Props) {
  const { t } = useI18n();
  if (item.kind === "hint") {
    return <div className="px-2 py-1 text-2xs text-zinc-600">{item.text}</div>;
  }

  if (item.kind === "archive_toggle") {
    return (
      <div className="px-1 pb-1">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-2xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          onClick={onToggleArchived}
        >
          <Archive className="h-3 w-3" />
          {item.showArchived ? t("folder.archivedBack") : t("folder.archived", { count: item.archivedCount })}
        </button>
      </div>
    );
  }

  if (item.kind === "new_folder") {
    return (
      <div className="px-1 pb-1 pt-0.5">
        <button
          type="button"
          className="flex h-9 w-full items-center gap-1.5 rounded-md border border-dashed border-zinc-700/80 px-2.5 text-left text-[12px] font-medium text-zinc-400 transition-colors hover:border-brand/50 hover:bg-zinc-900 hover:text-brand"
          onClick={onCreateFolder}
        >
          <FolderPlus className="h-3.5 w-3.5 shrink-0" />
          {item.isAllAccountsView ? t("folder.newCrossAccount") : t("folder.new")}
        </button>
      </div>
    );
  }

  if (item.kind === "folder_empty") {
    return (
      <div data-chat-folder-drop={item.folderId} className={cn("ml-2 rounded-md px-2 py-3 text-2xs text-zinc-500", item.dropActive && "bg-brand/10 ring-1 ring-inset ring-brand/40")}>
        {item.dragging
          ? item.folderId === "__ungrouped"
            ? t("folder.moveOut")
            : t("folder.moveIn")
          : item.folderId === "__ungrouped"
            ? t("folder.allGrouped")
            : t("folder.empty")}
      </div>
    );
  }

  if (item.kind === "lead_date_header") {
    return (
      <div className="flex items-center gap-1 px-1 pb-1 pt-1.5 text-zinc-500">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-zinc-900/80 hover:text-zinc-300"
          onClick={() => onToggleLeadDate?.(item.groupId)}
          aria-expanded={!item.collapsed}
        >
          {item.collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          <CalendarDays className="h-3 w-3 shrink-0" />
          <span className="truncate text-[10px] font-semibold uppercase tracking-wide">
            {item.label}
          </span>
          <span className="text-[10px] font-normal tabular-nums text-zinc-600">
            {item.total}
          </span>
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300"
          onClick={(event) => onOpenLeadDateMenu?.(event, item.groupId)}
          title={t("leadInbox.dateActions")}
          aria-label={t("leadInbox.dateActions")}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (item.kind === "ungrouped_header") {
    return (
      <div
        data-chat-folder-drop="__ungrouped"
        className="mb-0.5 mt-1 px-1"
      >
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-zinc-900/80",
            item.dropActive && "bg-brand/10 ring-1 ring-brand/40"
          )}
          onClick={onToggleUngrouped}
          aria-expanded={!item.collapsed}
        >
          {item.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )}
          <Inbox className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-400">
            {item.isAllAccountsView ? t("folder.ungroupedAll") : t("folder.ungrouped")}
          </span>
          {item.containsSelected && <span className={cn("shrink-0 text-xs font-medium text-brand", !item.collapsed && "sr-only")} title={t("folder.currentChat")}>{t("folder.current")}</span>}
          <span className="shrink-0 text-xs tabular-nums text-zinc-500 font-normal" title={t("folder.chatCount", { count: item.total })} aria-label={t("folder.chatCount", { count: item.total })}>{item.total}</span>
          {item.unread > 0 && (
            <span className="inline-flex min-h-5 shrink-0 items-center justify-center rounded-full bg-brand/15 px-1.5 text-xs font-semibold tabular-nums text-brand" title={t("folder.unreadChatCount", { count: item.unread })} aria-label={t("folder.unreadChatCount", { count: item.unread })}>
              {item.unread > 99 ? "99+" : item.unread}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-3 text-2xs leading-5 text-zinc-500">
      <div>
        {item.query
          ? t("folder.noMatch")
          : item.contactsCount > 0
            ? t("folder.noPreview")
            : t("folder.noChats")}
      </div>
      {!item.query && (
        <button
          type="button"
          disabled={item.syncing}
          onClick={onSync}
          className="rounded-md border border-zinc-700/80 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-300 hover:border-brand/40 hover:text-brand disabled:opacity-50"
        >
          {item.syncing ? t("sidebar.syncing") : t("folder.syncNow")}
        </button>
      )}
    </div>
  );
}
