import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  UserRoundX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type FolderHeaderRowProps = {
  name: string;
  collapsed: boolean;
  depth: number;
  total: number;
  unread: number;
  dropActive: boolean;
  folderDropActive: boolean;
  dragging: boolean;
  onRegisterRef: (element: HTMLDivElement | null) => void;
  onToggle: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onCreateChild: () => void;
  onOpenMultiWindow: () => void;
  onImport: () => void;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
};

export function FolderHeaderRow({
  name,
  collapsed,
  depth,
  total,
  unread,
  dropActive,
  folderDropActive,
  dragging,
  onRegisterRef,
  onToggle,
  onStartDrag,
  onCreateChild,
  onOpenMultiWindow,
  onImport,
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
      x: Math.max(8, Math.min(x, window.innerWidth - 184)),
      y: Math.max(8, Math.min(y, window.innerHeight - 208)),
    });
  };
  const run = (action: () => void) => {
    setMenu(null);
    action();
  };
  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

  return (
    <div className={cn("mb-0.5 px-1", depth > 0 && "ml-3")}>
      <div
        className={cn(
          "group/folder flex items-center gap-0.5 rounded-md px-1 py-1.5 transition-colors hover:bg-zinc-900/80",
          dropActive && "bg-brand/10 ring-1 ring-brand/40",
          folderDropActive && "bg-brand/15 ring-1 ring-brand/60"
        )}
        ref={onRegisterRef}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span
            className="truncate text-[12px] font-medium text-zinc-300"
            title={name}
          >
            {name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 font-normal">
            {total}
          </span>
          {unread > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-700 text-white dark:bg-emerald-600 dark:text-white px-1 text-[10px] font-bold tabular-nums shadow-2xs">
              {unread}
            </span>
          )}
        </button>
        <button
          type="button"
          title={t("folder.dragOrder")}
          aria-label={t("folder.dragOrder")}
          className={cn(
            "cursor-grab rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover/folder:opacity-100 active:cursor-grabbing",
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
          className="fixed z-[9999] min-w-[11rem] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {depth === 0 && (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => run(onCreateChild)}
            >
              <FolderPlus className="h-3.5 w-3.5 text-zinc-500" />
              {t("folder.createChild")}
            </button>
          )}
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
