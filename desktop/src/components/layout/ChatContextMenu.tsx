import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Eraser,
  FolderInput,
  FolderPlus,
  FolderX,
  MailOpen,
  Pin,
  PinOff,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatPreview } from "@/types/crm";
import type { ChatFolder, ChatFolderClone } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export type ChatMenuAction =
  | "markRead"
  | "markUnread"
  | "archive"
  | "unarchive"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "clear"
  | "delete"
  | "block"
  | "moveToFolder"
  | "cloneToFolder"
  | "removeFromFolder"
  | "removeCloneFromFolder"
  | "createFolderAndMove"
  | "createFolderAndClone";

/** mute 附带时长：毫秒；永久用很大的数 */
export type ChatMenuActionExtra = {
  durationMs?: number | null;
};

type Props = {
  x: number;
  y: number;
  chat: ChatPreview;
  folders: ChatFolder[];
  clones?: ChatFolderClone[];
  chatIds?: string[];
  /** 当前会话主归属分组 id */
  primaryFolderId?: string | null;
  /** 1:1 私聊才显示拉黑 */
  showBlock?: boolean;
  blocked?: boolean;
  onAction: (
    chat: ChatPreview,
    action: ChatMenuAction,
    folderId?: string | null,
    extra?: ChatMenuActionExtra
  ) => void;
  onClose: () => void;
};

type SubKind = "move" | "clone" | "mute";

const MUTE_8H = 8 * 3600_000;
const MUTE_7D = 7 * 24 * 3600_000;
const MUTE_FOREVER = 100 * 365 * 24 * 3600_000;

export function ChatContextMenu({
  x,
  y,
  chat,
  folders,
  clones = [],
  chatIds,
  primaryFolderId,
  showBlock,
  blocked,
  onAction,
  onClose,
}: Props) {
  const { t } = useI18n();
  const muted =
    typeof chat.mutedUntil === "number" && chat.mutedUntil > Date.now();
  const [sub, setSub] = useState<SubKind | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const moveItemRef = useRef<HTMLButtonElement>(null);
  const cloneItemRef = useRef<HTMLButtonElement>(null);
  const muteItemRef = useRef<HTMLButtonElement>(null);
  const closeSubTimer = useRef<number | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(
    null
  );

  const itemCls =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

  const clonedFolderIds = useMemo(() => {
    const set = new Set<string>();
    const sourceIds = new Set(chatIds?.length ? chatIds : [chat.id]);
    for (const c of clones) {
      if (sourceIds.has(c.sourceChatId)) set.add(c.folderId);
    }
    return set;
  }, [chat.id, chatIds, clones]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  const primaryName = folders.find((f) => f.id === primaryFolderId)?.name;

  const clearCloseTimer = () => {
    if (closeSubTimer.current != null) {
      window.clearTimeout(closeSubTimer.current);
      closeSubTimer.current = null;
    }
  };

  const openSub = (kind: SubKind) => {
    clearCloseTimer();
    setQuery("");
    setSub(kind);
  };

  const scheduleCloseSub = () => {
    clearCloseTimer();
    closeSubTimer.current = window.setTimeout(() => {
      setSub(null);
      setQuery("");
      closeSubTimer.current = null;
    }, 180);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useLayoutEffect(() => {
    if (!sub) {
      setSubPos(null);
      return;
    }
    const anchor =
      sub === "move"
        ? moveItemRef.current
        : sub === "clone"
          ? cloneItemRef.current
          : muteItemRef.current;
    if (!anchor) return;

    const ar = anchor.getBoundingClientRect();
    const subW = 200;
    const rows =
      sub === "mute"
        ? 3
        : (sub === "move" ? 1 : 0) + // 未分组
          Math.max(filteredFolders.length, folders.length ? 0 : 1) +
          1 + // 新建
          (query || folders.length > 5 ? 1 : 0); // 搜索
    const subH = Math.min(320, 36 + rows * 34 + 28);
    let left = ar.right + 4;
    let top = ar.top - 4;
    if (left + subW > window.innerWidth - 8) {
      left = ar.left - subW - 4;
    }
    if (left < 8) left = 8;
    if (top + subH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - subH - 8);
    }
    if (top < 8) top = 8;
    setSubPos({ left, top });
  }, [sub, filteredFolders.length, folders.length, query, x, y]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (r.right > window.innerWidth - 8) {
      nx = Math.max(8, window.innerWidth - r.width - 8);
    }
    if (r.bottom > window.innerHeight - 8) {
      ny = Math.max(8, window.innerHeight - r.height - 8);
    }
    if (nx !== x || ny !== y) {
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
    }
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (sub) {
          setSub(null);
          setQuery("");
        } else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sub]);

  const fire = (
    action: ChatMenuAction,
    folderId?: string | null,
    extra?: ChatMenuActionExtra
  ) => {
    onAction(chat, action, folderId, extra);
  };

  return (
    <>
      <div
        ref={rootRef}
        data-chat-context-menu
        className="fixed z-[9999] min-w-[12.75rem] overflow-visible rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          className={itemCls}
          onMouseEnter={scheduleCloseSub}
          onClick={() => fire("markRead")}
        >
          <CheckCheck className="h-3.5 w-3.5 text-zinc-400" />
          {t("chatContext.markRead")}
        </button>
        <button
          type="button"
          className={itemCls}
          onMouseEnter={scheduleCloseSub}
          onClick={() => fire("markUnread")}
        >
          <MailOpen className="h-3.5 w-3.5 text-zinc-400" />
          {t("chatContext.markUnread")}
        </button>
        <button
          type="button"
          className={itemCls}
          onMouseEnter={scheduleCloseSub}
          onClick={() => fire(chat.pinned ? "unpin" : "pin")}
        >
          {chat.pinned ? (
            <PinOff className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <Pin className="h-3.5 w-3.5 text-zinc-400" />
          )}
          {chat.pinned ? t("chatContext.unpin") : t("chatContext.pin")}
        </button>
        {muted ? (
          <button
            type="button"
            className={itemCls}
            onMouseEnter={scheduleCloseSub}
            onClick={() => fire("unmute")}
          >
            <Bell className="h-3.5 w-3.5 text-zinc-400" />
            {t("chatContext.unmute")}
          </button>
        ) : (
          <button
            ref={muteItemRef}
            type="button"
            className={cn(itemCls, sub === "mute" && "bg-zinc-800")}
            onMouseEnter={() => openSub("mute")}
            onClick={() => {
              if (sub === "mute") {
                setSub(null);
              } else openSub("mute");
            }}
          >
            <BellOff className="h-3.5 w-3.5 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate text-left">{t("chatContext.mute")}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          </button>
        )}
        <button
          type="button"
          className={itemCls}
          onMouseEnter={scheduleCloseSub}
          onClick={() => fire(chat.archived ? "unarchive" : "archive")}
        >
          {chat.archived ? (
            <ArchiveRestore className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <Archive className="h-3.5 w-3.5 text-zinc-400" />
          )}
          {chat.archived ? t("chatContext.unarchive") : t("chatContext.archive")}
        </button>

        <div className="my-1 border-t border-zinc-800" />

        {primaryFolderId && (
          <button
            type="button"
            className={itemCls}
            onMouseEnter={scheduleCloseSub}
            onClick={() => fire("removeFromFolder")}
          >
            <FolderX className="h-3.5 w-3.5 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate">
              {t("chatContext.removeFromGroup", { name: primaryName || t("chatContext.group") })}
            </span>
          </button>
        )}

        <button
          ref={moveItemRef}
          type="button"
          className={cn(itemCls, sub === "move" && "bg-zinc-800")}
          onMouseEnter={() => openSub("move")}
          onClick={() => {
            if (sub === "move") {
              setSub(null);
              setQuery("");
            } else openSub("move");
          }}
        >
          <FolderInput className="h-3.5 w-3.5 text-zinc-400" />
          <span className="min-w-0 flex-1 truncate text-left">{t("chatContext.moveToGroup")}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </button>

        <button
          ref={cloneItemRef}
          type="button"
          className={cn(itemCls, sub === "clone" && "bg-zinc-800")}
          onMouseEnter={() => openSub("clone")}
          onClick={() => {
            if (sub === "clone") {
              setSub(null);
              setQuery("");
            } else openSub("clone");
          }}
        >
          <Copy className="h-3.5 w-3.5 text-zinc-400" />
          <span className="min-w-0 flex-1 truncate text-left">{t("chatContext.cloneTo")}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </button>

        <div className="my-1 border-t border-zinc-800" />
        <button
          type="button"
          className={itemCls}
          onMouseEnter={scheduleCloseSub}
          onClick={() => fire("clear")}
        >
          <Eraser className="h-3.5 w-3.5 text-zinc-400" />
          {t("chatContext.clear")}
        </button>
        {showBlock && (
          <button
            type="button"
            className={cn(itemCls, "text-rose-300 hover:bg-rose-500/10")}
            onMouseEnter={scheduleCloseSub}
            onClick={() => fire("block")}
          >
            <Ban className="h-3.5 w-3.5" />
            {blocked ? t("chatContext.unblock") : t("chatContext.block")}
          </button>
        )}
        <button
          type="button"
          className={cn(itemCls, "text-rose-300 hover:bg-rose-500/10")}
          onMouseEnter={scheduleCloseSub}
          onClick={() => fire("delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("chatContext.delete")}
        </button>
      </div>

      {sub && subPos && (
        <div
          data-chat-context-menu
          className="fixed z-[10000] flex max-h-[min(55vh,20rem)] w-[12.5rem] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50"
          style={{ left: subPos.left, top: subPos.top }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleCloseSub}
        >
          {sub === "mute" ? (
            <div className="py-1">
              <button
                type="button"
                className={itemCls}
                onClick={() => fire("mute", null, { durationMs: MUTE_8H })}
              >
                {t("chat.hours8")}
              </button>
              <button
                type="button"
                className={itemCls}
                onClick={() => fire("mute", null, { durationMs: MUTE_7D })}
              >
                {t("chat.days7")}
              </button>
              <button
                type="button"
                className={itemCls}
                onClick={() =>
                  fire("mute", null, { durationMs: MUTE_FOREVER })
                }
              >
                {t("chat.forever")}
              </button>
            </div>
          ) : (
            <>
          {folders.length > 5 && (
            <div className="relative shrink-0 border-b border-zinc-800 px-2 py-1.5">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("chatContext.searchGroups")}
                className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-7 pr-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {sub === "move" && (
              <button
                type="button"
                disabled={!primaryFolderId}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]",
                  !primaryFolderId
                    ? "cursor-default text-zinc-600"
                    : "text-zinc-200 hover:bg-zinc-800"
                )}
                onClick={() => {
                  if (!primaryFolderId) return;
                  fire("removeFromFolder");
                }}
              >
                <FolderX className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="min-w-0 flex-1 truncate">{t("chatContext.ungrouped")}</span>
                {!primaryFolderId && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                )}
              </button>
            )}

            {filteredFolders.map((f) => {
              const isPrimary = f.id === primaryFolderId;
              const isCloned = clonedFolderIds.has(f.id);

              if (sub === "move") {
                return (
                  <button
                    key={`move-${f.id}`}
                    type="button"
                    disabled={isPrimary}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]",
                      isPrimary
                        ? "cursor-default text-zinc-600"
                        : "text-zinc-200 hover:bg-zinc-800"
                    )}
                    onClick={() => {
                      if (isPrimary) return;
                      fire("moveToFolder", f.id);
                    }}
                  >
                    <FolderInput className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {isPrimary && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                    )}
                    {!isPrimary && isCloned && (
                      <span className="shrink-0 text-2xs text-zinc-600">
                        {t("chatContext.hasClone")}
                      </span>
                    )}
                  </button>
                );
              }

              // clone submenu
              return (
                <button
                  key={`clone-${f.id}`}
                  type="button"
                  disabled={isPrimary}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]",
                    isPrimary
                      ? "cursor-default text-zinc-600"
                      : "text-zinc-200 hover:bg-zinc-800"
                  )}
                  onClick={() => {
                    if (isPrimary) return;
                    if (isCloned) fire("removeCloneFromFolder", f.id);
                    else fire("cloneToFolder", f.id);
                  }}
                >
                  <Copy className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {isPrimary && (
                    <span className="shrink-0 text-2xs text-zinc-600">{t("chatContext.primary")}</span>
                  )}
                  {!isPrimary && isCloned && (
                    <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-2xs text-brand">
                      {t("chatContext.cancel")}
                    </span>
                  )}
                </button>
              );
            })}

            {folders.length > 0 && filteredFolders.length === 0 && (
              <div className="px-3 py-3 text-center text-[11px] text-zinc-600">
                {t("chatContext.noMatch")}
              </div>
            )}

            {folders.length === 0 && (
              <div className="px-3 py-2 text-[11px] leading-4 text-zinc-600">
                {t("chatContext.noGroups")}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-zinc-800 py-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-brand hover:bg-zinc-800"
              onClick={() =>
                fire(
                  sub === "move" ? "createFolderAndMove" : "createFolderAndClone"
                )
              }
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {t("chatContext.newGroup")} {sub === "move" ? t("chatContext.andMove") : t("chatContext.andClone")}
            </button>
          </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
