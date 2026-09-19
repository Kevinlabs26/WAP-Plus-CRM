import {
  Archive,
  ChevronDown,
  ChevronRight,
  Inbox,
  FolderPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export type SidebarSpecialItem =
  | { kind: "hint"; text: string }
  | { kind: "archive_toggle"; showArchived: boolean; archivedCount: number }
  | { kind: "new_folder"; isAllAccountsView: boolean }
  | { kind: "folder_empty"; folderId: string; dragging: boolean }
  | {
      kind: "ungrouped_header";
      total: number;
      unread: number;
      collapsed: boolean;
      isAllAccountsView: boolean;
      dropActive: boolean;
    }
  | { kind: "empty"; query: string; contactsCount: number; syncing: boolean };

type Props = {
  item: SidebarSpecialItem;
  onRegisterUngroupedRef?: (element: HTMLDivElement | null) => void;
  onToggleArchived: () => void;
  onCreateFolder: () => void;
  onToggleUngrouped: () => void;
  onSync: () => void;
};

export function SidebarSpecialItem({
  item,
  onRegisterUngroupedRef,
  onToggleArchived,
  onCreateFolder,
  onToggleUngrouped,
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
      <div className="ml-2 px-2 py-1.5 text-2xs text-zinc-600">
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

  if (item.kind === "ungrouped_header") {
    return (
      <div
        ref={onRegisterUngroupedRef}
        className="mb-0.5 mt-1 px-1"
      >
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-zinc-900/80",
            item.dropActive && "bg-brand/10 ring-1 ring-brand/40"
          )}
          onClick={onToggleUngrouped}
        >
          {item.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )}
          <Inbox className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span className="truncate text-[12px] font-medium text-zinc-500">
            {item.isAllAccountsView ? t("folder.ungroupedAll") : t("folder.ungrouped")}
          </span>
          <span className="text-[11px] tabular-nums text-zinc-500 font-normal">{item.total}</span>
          {item.unread > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-700 text-white dark:bg-emerald-600 dark:text-white px-1 text-[10px] font-bold tabular-nums shadow-2xs">
              {item.unread}
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
