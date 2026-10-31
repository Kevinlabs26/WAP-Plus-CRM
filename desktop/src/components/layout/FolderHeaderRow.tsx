import type { AutoReplyMode } from "@/lib/autoReplyScope";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Clock3,
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
  onAiPrompt?: () => void;
  onSchedule?: () => void;
  onBroadcast?: () => void;
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
  onAiPrompt,
  onSchedule,
  onBroadcast,
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
  const [replyMenu, setReplyMenu] = useState<{ left: number; top: number; focus: boolean } | null>(null);
  const replyTrigger = useRef<HTMLButtonElement>(null);
  const replyPopup = useRef<HTMLDivElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = () => { cancelClose(); setReplyMenu(null); setMenu(null); };
  const openReplyMenu = (anchor: HTMLButtonElement, focus = false) => {
    cancelClose();
    const rect = anchor.getBoundingClientRect();
    setReplyMenu({
      left: Math.max(8, Math.min(rect.right + 2 + 224 <= window.innerWidth - 8 ? rect.right + 2 : rect.left - 226, window.innerWidth - 232)),
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 184)),
      focus,
    });
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setReplyMenu(null), 180);
  };

  useEffect(() => () => cancelClose(), []);
  useEffect(() => { if (menu) replyTrigger.current?.focus(); }, [menu]);
  useEffect(() => {
    if (replyMenu?.focus) replyPopup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [replyMenu]);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.<HTMLElement>("[data-folder-action-menu]")?.dataset.folderActionMenu === folderId) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (replyMenu) { setReplyMenu(null); replyTrigger.current?.focus(); }
        else { close(); actionsTrigger.current?.focus(); }
      }
    };
    const onScroll = (event: Event) => {
      if (!(event.target as HTMLElement | null)?.closest?.("[data-folder-action-menu]")) close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, replyMenu]);

  const openMenu = (x: number, y: number) => {
    cancelClose();
    setReplyMenu(null);
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 248)),
      y: Math.max(8, Math.min(y, window.innerHeight - 312)),
    });
  };
  const run = (action: () => void) => {
    close();
    actionsTrigger.current?.focus();
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
          ref={actionsTrigger}
          type="button"
          title={t("folder.actions")}
          aria-label={t("folder.actions")}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          data-folder-action-menu={folderId}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            menu ? close() : openMenu(event.detail === 0 ? rect.left : event.clientX, event.detail === 0 ? rect.bottom : event.clientY);
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      {menu && createPortal(
        <div
          data-folder-action-menu={folderId}
          role="menu"
          aria-label={t("folder.actionsFor", { name })}
          className="fixed z-[9999] min-w-[15rem] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
          style={{ left: menu.x, top: menu.y, maxHeight: Math.max(0, window.innerHeight - menu.y - 8) }}
          onContextMenu={(event) => event.preventDefault()}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onMouseOver={event => {
            const item = (event.target as HTMLElement).closest('[role="menuitem"]');
            if (item && item !== replyTrigger.current) setReplyMenu(null);
          }}
          onScroll={() => setReplyMenu(null)}
          onKeyDown={event => {
            if (event.key === "Tab") { close(); actionsTrigger.current?.focus(); return; }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {onAutoReplyModeChange && <button ref={replyTrigger} type="button" role="menuitem"
            aria-haspopup="menu" aria-expanded={!!replyMenu} aria-controls={replyMenu ? `folder-reply-${folderId}` : undefined}
            className={`${itemClass} border-b border-zinc-800`}
            onMouseEnter={event => openReplyMenu(event.currentTarget)}
            onClick={event => openReplyMenu(event.currentTarget, true)}
            onKeyDown={event => {
              if (["ArrowRight", "Enter", " "].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); openReplyMenu(event.currentTarget, true);
              }
            }}>
            <span className="flex-1">{t("autoReplyScope.folderMode")}</span>
            <span className="text-zinc-500">{t(autoReplyMode === "auto" ? "multi.replyMode.auto" : autoReplyMode === "manual" ? "multi.replyMode.manual" : "autoReplyScope.defaultShort")}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          </button>}
          {onAiPrompt && <button type="button" role="menuitem" className={itemClass} onClick={() => run(onAiPrompt)}>
            <Pencil className="h-3.5 w-3.5 text-brand" />{t("folderAi.action")}
          </button>}
          {onBroadcast && <button type="button" role="menuitem" className={itemClass} onClick={() => run(onBroadcast)}>
            <Users className="h-3.5 w-3.5 text-brand" />{t("planQueue.folderBroadcast")}
          </button>}
          {onSchedule && <button type="button" role="menuitem" className={itemClass} onClick={() => run(onSchedule)}>
            <Clock3 className="h-3.5 w-3.5 text-brand" />{t("planQueue.create")}
          </button>}
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
        </div>, document.body
      )}
      {menu && replyMenu && onAutoReplyModeChange && createPortal(
        <div ref={replyPopup} id={`folder-reply-${folderId}`} data-folder-action-menu={folderId} role="menu"
          aria-label={t("autoReplyScope.folderRuleFor", { name })}
          className="fixed z-[10000] w-56 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
          style={{ left: replyMenu.left, top: replyMenu.top }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          onContextMenu={event => event.preventDefault()}
          onKeyDown={event => {
            if (event.key === "Tab") { close(); actionsTrigger.current?.focus(); return; }
            if (["ArrowLeft", "Escape"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation(); setReplyMenu(null); replyTrigger.current?.focus(); return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}>
          {(["inherit", "auto", "manual"] as const).map(mode => <button key={mode} type="button" role="menuitemradio"
            aria-checked={(autoReplyMode || "inherit") === mode} className={itemClass} onClick={() => changeReplyMode(mode)}>
            <Check className={cn("h-3.5 w-3.5 shrink-0 text-brand", (autoReplyMode || "inherit") !== mode && "invisible")} />
            {t(mode === "inherit" ? "autoReplyScope.inheritDefault" : mode === "auto" ? "autoReplyScope.auto" : "autoReplyScope.manual")}
          </button>)}
          <p className="border-t border-zinc-800 px-3 py-2 text-[11px] leading-4 text-zinc-500">{t("autoReplyScope.folderHint")}</p>
        </div>, document.body
      )}
    </div>
  );
}
