import type { AutoReplyMode } from "@/lib/autoReplyScope";
import { folderBackground, folderRowPadding } from "@/lib/folderAppearance";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
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
import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from "emoji-picker-react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { sheetConnections, useGoogleSheets } from "@/lib/googleSheets";

type FolderHeaderRowProps = {
  folderId: string;
  name: string;
  icon?: string;
  color?: string;
  collapsed: boolean;
  depth: number;
  total: number;
  unread: number;
  containsSelected?: boolean;
  dropActive: boolean;
  folderDropActive: boolean;
  dragging: boolean;
  autoReplyMode?: AutoReplyMode;
  onAppearanceChange?: (icon?: string, color?: string) => void;
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
  onClearTree: () => void;
  onCopyUnreplied?: () => void;
  onDelete: () => void;
};
type SubmenuKind = "reply" | "import" | "organize" | "appearance" | "sheet";

export function FolderHeaderRow({
  folderId,
  name,
  icon,
  color,
  collapsed,
  depth,
  total,
  unread,
  containsSelected = false,
  dropActive,
  folderDropActive,
  dragging,
  autoReplyMode,
  onAppearanceChange,
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
  onClearTree,
  onCopyUnreplied,
  onDelete,
}: FolderHeaderRowProps) {
  const { t } = useI18n();
  const theme = useAppStore(s => s.settings.theme);
  const defaultColor=useAppStore(s=>s.settings.folderDefaultColor);
  const colorDepth=useAppStore(s=>s.settings.folderColorDepth);
  const rowDensity=useAppStore(s=>s.settings.folderRowDensity);
  const sheetBinding=useAppStore(state=>state.settings.chatFolders.find(folder=>folder.id===folderId)?.sheetConnectionId);
  const sheetNames=useGoogleSheets(useShallow(state=>Object.fromEntries(sheetConnections(state).map(item=>[item.id,item.name]))));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [submenu, setSubmenu] = useState<{ kind: SubmenuKind; left: number; top: number; focus: boolean } | null>(null);
  const replyTrigger = useRef<HTMLButtonElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const organizeTrigger = useRef<HTMLButtonElement>(null);
  const sheetTrigger = useRef<HTMLButtonElement>(null);
  const submenuTriggers = { reply: replyTrigger, import: importTrigger, organize: organizeTrigger, appearance: organizeTrigger, sheet:sheetTrigger };
  const submenuPopup = useRef<HTMLDivElement>(null);
  const menuPopup = useRef<HTMLDivElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = () => { cancelClose(); setSubmenu(null); setMenu(null); };
  const openSubmenu = (kind: SubmenuKind, anchor: HTMLButtonElement, focus = false) => {
    cancelClose();
    const rect = anchor.getBoundingClientRect();
    const width = kind === "appearance" ? 352 : 224;
    const height = kind === "appearance" ? 420 : kind === "reply" ? 184 : kind === "organize" && onCopyUnreplied ? 144 : 112;
    setSubmenu({
      kind,
      left: Math.max(8, Math.min(rect.right + 2 + width <= window.innerWidth - 8 ? rect.right + 2 : rect.left - width - 2, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)),
      focus,
    });
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setSubmenu(null), 180);
  };

  useEffect(() => () => cancelClose(), []);
  useLayoutEffect(() => {
    const popup = submenu ? submenuPopup.current : menu ? menuPopup.current : null;
    if (!popup) return;
    const bounds = popup.getBoundingClientRect();
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, Math.min(bounds.top, window.innerHeight - bounds.height - 8));
    if (submenu && (left !== submenu.left || top !== submenu.top)) {
      setSubmenu(current => current ? { ...current, left, top } : current);
    } else if (!submenu && menu && (left !== menu.x || top !== menu.y)) {
      setMenu({ x: left, y: top });
    }
  }, [menu, submenu]);
  useEffect(() => { if (menu) replyTrigger.current?.focus(); }, [menu]);
  useEffect(() => {
    if (submenu?.focus) submenuPopup.current?.querySelector<HTMLButtonElement>(submenu.kind === "reply" ? '[aria-checked="true"]' : '[role="menuitem"]')?.focus();
  }, [submenu]);

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
        if (submenu) { setSubmenu(null); submenuTriggers[submenu.kind].current?.focus(); }
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
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, submenu]);

  const openMenu = (x: number, y: number) => {
    cancelClose();
    setSubmenu(null);
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
        style={{ backgroundColor: folderBackground(color||defaultColor,colorDepth),paddingTop:folderRowPadding(rowDensity),paddingBottom:folderRowPadding(rowDensity) }}
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
          {icon ? <span className="w-4 shrink-0 text-center text-sm leading-4" style={{ filter: color ? `drop-shadow(0 0 2px ${color})` : undefined }} aria-hidden="true">{icon}</span> : <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: color || "#71717a" }} />}
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
          ref={menuPopup}
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
            if (item && !item.hasAttribute("aria-haspopup")) setSubmenu(null);
          }}
          onScroll={() => setSubmenu(null)}
          onKeyDown={event => {
            if (event.key === "Tab") { close(); actionsTrigger.current?.focus(); return; }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            setSubmenu(null);
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {onAutoReplyModeChange && <button ref={replyTrigger} type="button" role="menuitem"
            aria-haspopup="menu" aria-expanded={submenu?.kind === "reply"} aria-controls={submenu?.kind === "reply" ? `folder-reply-${folderId}` : undefined}
            className={`${itemClass} border-b border-zinc-800`}
            onMouseEnter={event => openSubmenu("reply", event.currentTarget)}
            onClick={event => openSubmenu("reply", event.currentTarget, true)}
            onKeyDown={event => {
              if (["ArrowRight", "Enter", " "].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); openSubmenu("reply", event.currentTarget, true);
              }
            }}>
            <span className="flex-1">{t("autoReplyScope.folderMode")}</span>
            <span className="text-zinc-500">{t(autoReplyMode === "auto" ? "multi.replyMode.auto" : autoReplyMode === "manual" ? "multi.replyMode.manual" : "autoReplyScope.defaultShort")}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          </button>}
          {onAiPrompt && <button type="button" role="menuitem" className={itemClass} onClick={() => run(onAiPrompt)}>
            <Pencil className="h-3.5 w-3.5 text-brand" />{t("folderAi.action")}
          </button>}
          <button ref={sheetTrigger} type="button" role="menuitem" className={itemClass} aria-haspopup="menu" aria-expanded={submenu?.kind==="sheet"} onMouseEnter={event=>openSubmenu("sheet",event.currentTarget)} onClick={event=>openSubmenu("sheet",event.currentTarget,true)} onKeyDown={event=>{if(event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();openSubmenu("sheet",event.currentTarget,true);}}}>
            <span className="flex-1">{t("sheets.bindFolder")}</span><ChevronRight className="h-3.5 w-3.5"/>
          </button>
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
            onClick={() => run(onOpenMultiWindow)}
          >
            <LayoutGrid className="h-3.5 w-3.5 text-zinc-500" />
            {t("folder.openMultiWindow")}
          </button>
          {(["import", "organize"] as const).map(kind => <button key={kind} ref={submenuTriggers[kind]} type="button" role="menuitem" className={itemClass}
            aria-haspopup="menu" aria-expanded={submenu?.kind === kind} aria-controls={submenu?.kind === kind ? `folder-${kind}-${folderId}` : undefined}
            onMouseEnter={event => openSubmenu(kind, event.currentTarget)}
            onClick={event => openSubmenu(kind, event.currentTarget, true)}
            onKeyDown={event => {
              if (["ArrowRight", "Enter", " "].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); openSubmenu(kind, event.currentTarget, true);
              }
            }}>
            <span className="flex-1">{t(kind === "import" ? "folder.importMenu" : "folder.organizeMenu")}</span><ChevronRight className="h-3.5 w-3.5" />
          </button>)}
          {onAppearanceChange && <button ref={organizeTrigger} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={submenu?.kind === "appearance"}
            className={itemClass} onMouseEnter={event => openSubmenu("appearance", event.currentTarget)} onClick={event => openSubmenu("appearance", event.currentTarget, true)}>
            <span className="flex-1">文件夹图标和颜色</span><ChevronRight className="h-3.5 w-3.5" />
          </button>}

          <div className="mt-1 border-t border-zinc-800 pt-1">
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
        </div>, document.body
      )}
      {menu && submenu && createPortal(
        <div ref={submenuPopup} id={`folder-${submenu.kind}-${folderId}`} data-folder-action-menu={folderId} role="menu"
          aria-label={submenu.kind === "reply" ? t("autoReplyScope.folderRuleFor", { name }) : t(submenu.kind==="sheet"?"sheets.bindFolder":submenu.kind === "import" ? "folder.importMenu" : "folder.organizeMenu")}
          className={`fixed z-[10000] ${submenu.kind === "appearance" ? "w-[22rem]" : "w-56"} max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50`}
          style={{ left: submenu.left, top: submenu.top }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          onContextMenu={event => event.preventDefault()}
          onKeyDown={event => {
            if (event.key === "Tab") { close(); actionsTrigger.current?.focus(); return; }
            if (["ArrowLeft", "Escape"].includes(event.key)) {
              event.preventDefault(); event.stopPropagation(); setSubmenu(null); submenuTriggers[submenu.kind].current?.focus(); return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(submenu.kind === "reply" ? '[role="menuitemradio"]' : '[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}>
          {submenu.kind === "reply" && (["inherit", "auto", "manual"] as const).map(mode => <button key={mode} type="button" role="menuitemradio"
            aria-checked={(autoReplyMode || "inherit") === mode} className={itemClass} onClick={() => changeReplyMode(mode)}>
            <Check className={cn("h-3.5 w-3.5 shrink-0 text-brand", (autoReplyMode || "inherit") !== mode && "invisible")} />
            {t(mode === "inherit" ? "autoReplyScope.inheritDefault" : mode === "auto" ? "autoReplyScope.auto" : "autoReplyScope.manual")}
          </button>)}
          {submenu.kind === "reply" && <p className="border-t border-zinc-800 px-3 py-2 text-[11px] leading-4 text-zinc-500">{t("autoReplyScope.folderHint")}</p>}
          {submenu.kind==="sheet"&&<>
            {[["",t("sheets.inherit")],["none",t("sheets.noBinding")],...Object.entries(sheetNames)].map(([id,label])=><button key={id} type="button" role="menuitem" aria-current={(sheetBinding||"")===id?"true":undefined} className={itemClass} onClick={()=>run(()=>{const state=useAppStore.getState();state.updateSettings({chatFolders:state.settings.chatFolders.map(folder=>folder.id===folderId?{...folder,sheetConnectionId:id||undefined}:folder)});})}><Check className={cn("h-3.5 w-3.5 shrink-0 text-brand",(sheetBinding||"")!==id&&"invisible")}/><span className="truncate">{label}</span></button>)}
          </>}
          {submenu.kind === "import" && <div>
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
          </div>}
          {submenu.kind === "organize" && <div>
          {onCopyUnreplied && <button type="button" role="menuitem" className={itemClass} onClick={() => run(onCopyUnreplied)}>
            <Copy className="h-3.5 w-3.5 text-zinc-500" />{t("folder.copyUnreplied")}
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
          <button type="button" role="menuitem" className={`${itemClass} text-rose-300 hover:bg-rose-500/10`} onClick={() => run(onClearTree)}>
            <Trash2 className="h-3.5 w-3.5" />{t("folder.clearTree")}
          </button>
          </div>}
          {submenu.kind === "appearance" && <div className="p-2" onMouseEnter={cancelClose}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">图标颜色</span>
              <div className="flex gap-1">
                <button type="button" className="rounded px-2 py-1 text-xs hover:bg-zinc-200" style={{ backgroundColor: theme === "light" ? "#e4e4e7" : "#3f3f46", color: theme === "light" ? "#3f3f46" : "#e4e4e7" }} onClick={() => run(() => onAppearanceChange?.(undefined, color))}>恢复默认图标</button>
                <button type="button" className="rounded px-2 py-1 text-xs hover:bg-zinc-200" style={{ backgroundColor: theme === "light" ? "#e4e4e7" : "#3f3f46", color: theme === "light" ? "#3f3f46" : "#e4e4e7" }} onClick={() => run(() => onAppearanceChange?.(icon, undefined))}>恢复默认颜色</button>
              </div>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2.5 py-2" style={{ backgroundColor: theme === "light" ? "#f4f4f5" : "#27272a" }}>
              <span className="shrink-0 whitespace-nowrap text-xs" style={{ color: theme === "light" ? "#71717a" : "#a1a1aa" }}>文件夹颜色</span>
              <div className="flex shrink-0 gap-1">{["#71717a", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"].map(value => <button key={value} type="button" aria-label={value} aria-pressed={color === value} className="h-5 w-5 shrink-0 rounded-full border border-black/10 ring-offset-1 hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-zinc-500" style={{ backgroundColor: value }} onClick={() => run(() => onAppearanceChange?.(icon, value))} />)}
                <label title="自定义颜色" aria-label="自定义颜色" className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-zinc-400 text-sm leading-none text-zinc-500 hover:bg-zinc-200">+
                  <input type="color" aria-label="选择自定义颜色" value={/^#[0-9a-f]{6}$/i.test(color || "") ? color : "#71717a"} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={event => onAppearanceChange?.(icon, event.target.value)} />
                </label>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-200" onKeyDown={event => { if (event.key === "Escape") close(); }}>
              <EmojiPicker theme={theme === "light" ? Theme.LIGHT : Theme.DARK} emojiStyle={EmojiStyle.NATIVE} width="100%" height={300} lazyLoadEmojis searchPlaceHolder={t("emoji.search")} previewConfig={{ showPreview: false }} onEmojiClick={(data: EmojiClickData) => run(() => onAppearanceChange?.(data.emoji, color))} />
            </div>
          </div>}
        </div>, document.body
      )}
    </div>
  );
}
