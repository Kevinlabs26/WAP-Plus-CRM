import type { AutoReplyMode } from "@/lib/autoReplyScope";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Link2,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  Users,
  UserRoundX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type FolderHeaderRowProps = {
  folderId: string;
  name: string;
  collapsed: boolean;
  depth: number;
  total: number;
  unread: number;
  containsSelected?: boolean;
  dropActive: boolean;
  folderDropActive: boolean;
  dragging: boolean;
  autoReplyMode?: AutoReplyMode;
  onAutoReplyModeChange?: (mode: AutoReplyMode | undefined) => void;
  onToggle: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onCreateChild: () => void;
  onOpenMultiWindow: () => void;
  onImport: () => void;
  onImportGroupLinks: () => void;
  onSelectGroups: () => void;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
};

export function FolderHeaderRow({
  folderId,
  name,
  collapsed,
  depth,
  total,
  unread,
  containsSelected = false,
  dropActive,
  folderDropActive,
  dragging,
  autoReplyMode,
  onAutoReplyModeChange,
  onToggle,
  onStartDrag,
  onCreateChild,
  onOpenMultiWindow,
  onImport,
  onImportGroupLinks,
  onSelectGroups,
  onRename,
  onClear,
  onDelete,
}: FolderHeaderRowProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-folder-action-menu]")) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (x: number, y: number) => {
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 248)),
      y: Math.max(8, Math.min(y, window.innerHeight - 390)),
    });
  };
  const run = (action: () => void) => {
    setMenu(null);
    action();
  };
  const changeReplyMode = (mode: string) => {
    if (onAutoReplyModeChange && ["inherit", "auto", "manual"].includes(mode)) {
      run(() => onAutoReplyModeChange(mode === "inherit" ? undefined : mode as AutoReplyMode));
    }
  };
  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

  return (
    <div className="mb-0.5 px-1" style={{ marginLeft: Math.min(depth, 6) * 12 }}>
      <div
        data-chat-folder-drop={folderId}
        data-folder-reorder-target={folderId}
        className={cn(
          "group/folder flex items-center gap-0.5 rounded-md px-1 py-1.5 transition-colors hover:bg-zinc-900/80",
          dropActive && "bg-brand/10 ring-1 ring-brand/40",
          folderDropActive && "bg-brand/15 ring-1 ring-brand/60"
        )}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-400"
            title={name}
          >
            {name}
          </span>
          {containsSelected && <span className={cn("shrink-0 text-xs font-medium text-brand", !collapsed && "sr-only")} title={t("folder.currentChat")}>{t("folder.current")}</span>}
          <span className="shrink-0 text-xs tabular-nums text-zinc-500 font-normal" title={t("folder.chatCount", { count: total })} aria-label={t("folder.chatCount", { count: total })}>
            {total}
          </span>
          {unread > 0 && (
            <span className="inline-flex min-h-5 shrink-0 items-center justify-center rounded-full bg-brand/15 px-1.5 text-xs font-semibold tabular-nums text-brand" title={t("folder.unreadChatCount", { count: unread })} aria-label={t("folder.unreadChatCount", { count: unread })}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        {onAutoReplyModeChange && (
          <select
            value={autoReplyMode || "inherit"}
            aria-label={t("autoReplyScope.folderRuleFor", { name })}
            title={`${t("autoReplyScope.folderMode")} · ${t("autoReplyScope.folderHint")}`}
            className={cn(
              "ui-control h-6 min-h-6 w-[4.5rem] shrink-0 rounded px-1 py-0.5 text-[11px] focus-visible:ring-2 focus-visible:ring-brand/50",
              autoReplyMode === "auto" ? "text-brand" : "text-zinc-400"
            )}
            onChange={event => changeReplyMode(event.target.value)}
          >
            <option value="inherit">{t("autoReplyScope.defaultShort")}</option>
            <option value="auto">{t("multi.replyMode.auto")}</option>
            <option value="manual">{t("multi.replyMode.manual")}</option>
          </select>
        )}
        <button
          type="button"
          title={t("folder.dragOrder")}
          aria-label={t("folder.dragOrder")}
          className={cn(
            "touch-none cursor-grab rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 active:cursor-grabbing",
            dragging && "opacity-100 text-brand"
          )}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartDrag(event);
          }}
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          type="button"
          title={t("folder.actions")}
          aria-label={t("folder.actions")}
          data-folder-action-menu
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={(event) =>
            menu ? setMenu(null) : openMenu(event.clientX, event.clientY)
          }
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {menu && (
        <div
          data-folder-action-menu
          role="menu"
          aria-label={t("folder.actionsFor", { name })}
          className="fixed z-[9999] min-w-[15rem] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {onAutoReplyModeChange && <label className="block border-b border-zinc-800 px-3 py-2 text-[12px] text-zinc-400">
            {t("autoReplyScope.folderMode")}
            <select
              value={autoReplyMode || "inherit"}
              aria-label={t("autoReplyScope.folderMode")}
              className="ui-control mt-1 w-full text-xs"
              onChange={event => changeReplyMode(event.target.value)}
            >
              <option value="inherit">{t("autoReplyScope.inheritDefault")}</option>
              <option value="auto">{t("autoReplyScope.auto")}</option>
              <option value="manual">{t("autoReplyScope.manual")}</option>
            </select>
            <p className="mt-1 text-[10px]">{t("autoReplyScope.folderHint")}</p>
          </label>}
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onCreateChild)}
          >
            <FolderPlus className="h-3.5 w-3.5 text-zinc-500" />
            {t("folder.createChild")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onOpenMultiWindow)}
          >
            <LayoutGrid className="h-3.5 w-3.5 text-zinc-500" />
            {t("folder.openMultiWindow")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onImport)}
          >
            <Upload className="h-3.5 w-3.5 text-zinc-500" />
            {t("folder.importNumbers")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onImportGroupLinks)}
          >
            <Link2 className="h-3.5 w-3.5 text-brand" />
            {t("folderGroups.importLinksAction")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onSelectGroups)}
          >
            <Users className="h-3.5 w-3.5 text-zinc-500" />
            {t("folderGroups.selectAction")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onRename)}
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-500" />
            {t("folder.rename")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => run(onClear)}
          >
            <UserRoundX className="h-3.5 w-3.5 text-zinc-500" />
            {t("folder.clearMembers")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-rose-300 hover:bg-rose-500/10`}
            onClick={() => run(onDelete)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("folder.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
