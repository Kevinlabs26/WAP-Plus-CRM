import {
  ArrowUpDown,
  Check,
  ChevronDown,
  MessageCircle,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  UsersRound,
  CheckCheck,
} from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { isSyncDebugEnabled, syncLog } from "@/lib/syncDebug";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";
import { Avatar } from "@/components/ui/Avatar";
import { SectionLabel } from "@/components/ui/primitives";
import type { ChatListFilter } from "@/store/appStore";
import {
  CHAT_SORT_OPTIONS,
  type ChatSortMode,
  type GroupChatCounts,
  type GroupChatFilter,
} from "./chatSidebarUtils";

const GROUP_FILTER_OPTIONS: { id: GroupChatFilter; labelKey: TranslationKey }[] = [
  { id: "all", labelKey: "sidebar.showGroups" },
  { id: "hidden", labelKey: "sidebar.groupFilterHidden" },
  { id: "only", labelKey: "sidebar.groupFilterOnly" },
  { id: "unread", labelKey: "sidebar.groupFilterUnread" },
  { id: "pinned", labelKey: "sidebar.groupFilterPinned" },
  { id: "mentions", labelKey: "sidebar.groupFilterMentions" },
];

const GROUP_FILTER_LABELS: Record<GroupChatFilter, TranslationKey> = {
  all: "sidebar.groupFilterAll",
  hidden: "sidebar.groupFilterHidden",
  only: "sidebar.groupFilterOnly",
  unread: "sidebar.groupFilterUnread",
  pinned: "sidebar.groupFilterPinned",
  mentions: "sidebar.groupFilterMentions",
};

const SORT_LABEL_KEYS: Record<ChatSortMode, TranslationKey> = {
  recent: "sidebar.sortRecent",
  unread: "sidebar.sortUnread",
  awaiting_reply: "sidebar.sortAwaitingReply",
  name_asc: "sidebar.sortNameAsc",
  name_desc: "sidebar.sortNameDesc",
};

type Props = {
  listTab: "chats" | "contacts";
  onTabChange: (tab: "chats" | "contacts") => void;
  chatsCount: number;
  contactsCount: number;
  filteredCount: number;
  groupFilter: GroupChatFilter;
  onToggleHideGroups: () => void;
  onGroupFilterChange: (mode: GroupChatFilter) => void;
  getGroupFilterCounts: () => GroupChatCounts;
  /** 一键已读所有群聊 */
  onMarkAllGroupsRead: () => void;
  savedActive: boolean;
  onOpenSaved: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  isBaileys: boolean;
  onCreateGroup: () => void;
  onBatchSaveContacts: () => void;
  listFilter: ChatListFilter;
  onClearFilter: () => void;
  sortOpen: boolean;
  onToggleSort: () => void;
  sortRef: MutableRefObject<HTMLDivElement | null>;
  sortLabel: string;
  sortMode: ChatSortMode;
  onSortChange: (mode: ChatSortMode) => void;
  syncing: boolean;
  syncDisabled: boolean;
  syncTitle: string;
  onSync: () => void;
};

export function SidebarListHeader({
  listTab,
  onTabChange,
  chatsCount,
  contactsCount,
  filteredCount,
  groupFilter,
  onToggleHideGroups,
  onGroupFilterChange,
  getGroupFilterCounts,
  onMarkAllGroupsRead,
  savedActive,
  onOpenSaved,
  filter,
  onFilterChange,
  isBaileys,
  onCreateGroup,
  onBatchSaveContacts,
  listFilter,
  onClearFilter,
  sortOpen,
  onToggleSort,
  sortRef,
  sortMode,
  onSortChange,
  syncing,
  syncDisabled,
  syncTitle,
  onSync,
}: Props) {
  const { t } = useI18n();
  const localizedSortLabel = t(SORT_LABEL_KEYS[sortMode]);
  const [groupFilterOpen, setGroupFilterOpen] = useState(false);
  const [groupFilterCounts, setGroupFilterCounts] =
    useState<GroupChatCounts | null>(null);
  const groupFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!groupFilterOpen) return;
    const close = (event: Event) => {
      if (groupFilterRef.current?.contains(event.target as Node)) return;
      setGroupFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGroupFilterOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [groupFilterOpen]);

  return (
    <>
      <div className="mb-2 grid grid-cols-2 rounded-lg bg-zinc-900 p-0.5 text-2xs">
        <button
          type="button"
          onClick={() => onTabChange("chats")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md px-2 py-1.5",
            listTab === "chats"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500"
          )}
        >
          <MessageCircle className="h-3 w-3" />
          {t("sidebar.chats")} · {chatsCount}
        </button>
        <button
          type="button"
          onClick={() => onTabChange("contacts")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md px-2 py-1.5",
            listTab === "contacts"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500"
          )}
        >
          <Users className="h-3 w-3" />
          {t("sidebar.contacts")} · {contactsCount}
        </button>
      </div>
      <button
        type="button"
        onClick={onOpenSaved}
        className={cn(
          "sidebar-saved-card mb-2 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-[13px] font-semibold transition-all shadow-2xs",
          savedActive && "sidebar-saved-card-active"
        )}
      >
        <Avatar
          name={t("sidebar.saved")}
          seed="saved-messages"
          size="sm"
          variant="saved"
        />
        <span className="min-w-0 flex-1 truncate font-semibold text-zinc-900 dark:text-zinc-100">{t("sidebar.saved")}</span>
        <span className="shrink-0 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t("sidebar.savedLocal")}</span>
      </button>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
        <input
          value={filter}
          onChange={(event) => {
            const value = event.target.value;
            const startedAt = isSyncDebugEnabled() ? performance.now() : 0;
            onFilterChange(value);
            if (startedAt) {
              requestAnimationFrame(() => {
                const durationMs = Math.round(performance.now() - startedAt);
                syncLog(
                  "ui.sidebar",
                  "search rendered",
                  { queryLength: value.length, durationMs },
                  durationMs >= 50 ? "warn" : "debug"
                );
              });
            }
          }}
          placeholder={t("sidebar.searchPlaceholder")}
          className={cn(
            "ui-control h-8 w-full pl-7 text-xs",
            isBaileys ? "pr-9" : "pr-2"
          )}
        />
        {isBaileys && (
          <button
            type="button"
            onClick={onCreateGroup}
            className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title={t("sidebar.newGroup")}
            aria-label={t("sidebar.newGroup")}
          >
            <UsersRound className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {listTab === "chats" && listFilter !== "all" && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-brand/25 bg-brand/10 px-2 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-medium text-brand">
            {listFilter === "unread"
              ? t("sidebar.filterUnread", { count: filteredCount })
              : t("sidebar.filterToday", { count: filteredCount })}
          </span>
          <button
            type="button"
            onClick={onClearFilter}
            className="shrink-0 rounded-md bg-zinc-900/80 px-2 py-0.5 text-2xs font-medium text-zinc-100 hover:bg-zinc-800"
            title={t("sidebar.showAllChats")}
          >
            {t("sidebar.showAllChats")}
          </button>
        </div>
      )}
      <div className="mb-2 space-y-1.5">
        {!(listTab === "chats" && !filter && groupFilter === "hidden") && (
          <SectionLabel className="!mb-0 block">
            {listTab === "chats"
              ? listFilter === "unread"
                ? t("sidebar.unreadChats")
                : listFilter === "today"
                  ? t("sidebar.todayChats")
                    : filter
                      ? t("sidebar.searchResults")
                      : t(GROUP_FILTER_LABELS[groupFilter])
              : t("sidebar.contacts")}
          </SectionLabel>
        )}
        <div className="flex items-center justify-end gap-0.5">
          {listTab === "chats" && (
            <div className="relative" ref={groupFilterRef}>
              <button
                type="button"
                aria-pressed={groupFilter !== "all"}
                aria-haspopup="menu"
                aria-expanded={groupFilterOpen}
                aria-label={groupFilter === "all" ? t("sidebar.hideGroups") : t("sidebar.showGroups")}
                title={t("sidebar.groupFilterTitle")}
                onClick={() => {
                  setGroupFilterOpen(false);
                  onToggleHideGroups();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!groupFilterOpen) {
                    setGroupFilterCounts(getGroupFilterCounts());
                  }
                  setGroupFilterOpen((open) => !open);
                }}
                className={cn(
                  "relative inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                  groupFilter !== "all"
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-zinc-800/80 bg-zinc-900/70 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                )}
              >
                <UsersRound className="h-3.5 w-3.5" />
                {groupFilter === "hidden" && (
                  <span className="absolute h-px w-4 -rotate-45 bg-current" />
                )}
                {groupFilter !== "all" && groupFilter !== "hidden" && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-brand" />
                )}
              </button>
              {groupFilterOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-[calc(100%+4px)] z-50 w-44 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
                >
                  <p className="px-2.5 pb-1 pt-1.5 text-2xs text-zinc-500">
                    {t("sidebar.groupFilterTitle")}
                  </p>
                  {GROUP_FILTER_OPTIONS.map((option) => {
                    const active = option.id === groupFilter;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
                          active
                            ? "bg-zinc-800 text-zinc-50"
                            : "text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-50"
                        )}
                        onClick={() => {
                          onGroupFilterChange(option.id);
                          setGroupFilterOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {t(option.labelKey)}
                        </span>
                        <span className="text-2xs tabular-nums text-zinc-500">
                          {groupFilterCounts?.[option.id] ?? 0}
                        </span>
                        {active && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                        )}
                      </button>
                    );
                  })}
                  {(groupFilterCounts?.unread ?? 0) > 0 && (
                    <>
                      <div className="my-1 border-t border-zinc-800" />
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800/80 hover:text-zinc-50"
                        onClick={() => {
                          setGroupFilterOpen(false);
                          onMarkAllGroupsRead();
                        }}
                      >
                        <CheckCheck className="h-3.5 w-3.5 shrink-0 text-brand" />
                        <span className="min-w-0 flex-1 truncate">
                          {t("sidebar.markAllGroupsRead")}
                        </span>
                        <span className="text-2xs tabular-nums text-zinc-500">
                          {groupFilterCounts?.unread ?? 0}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onBatchSaveContacts}
            className="relative inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-800/80 bg-zinc-900/70 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
            title={t("sidebar.batchSaveTitle")}
            aria-label={t("sidebar.batchSaveContacts")}
          >
            <UserPlus className="h-3.5 w-3.5" />
          </button>
          {listTab === "chats" && (
            <div className="relative" ref={sortRef}>
              <button
                type="button"
                title={t("sidebar.sortTitle")}
                onClick={onToggleSort}
                className={cn(
                  "inline-flex max-w-[8.5rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs transition-colors",
                  sortOpen
                    ? "border-brand/40 bg-zinc-900 text-zinc-100"
                    : "border-zinc-800/80 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                )}
              >
                <ArrowUpDown className="h-3 w-3 shrink-0 text-zinc-500" />
                <span className="truncate">{localizedSortLabel}</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 shrink-0 text-zinc-500 transition-transform",
                    sortOpen && "rotate-180"
                  )}
                />
              </button>
              {sortOpen && (
                <div className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[9.5rem] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50">
                  {CHAT_SORT_OPTIONS.map((opt) => {
                    const active = opt.id === sortMode;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
                          active
                            ? "bg-zinc-800 text-zinc-50"
                            : "text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-50"
                        )}
                        onClick={() => onSortChange(opt.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {t(SORT_LABEL_KEYS[opt.id])}
                        </span>
                        {active && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={syncDisabled}
            onClick={onSync}
            aria-label={syncing ? t("sidebar.syncing") : t("sidebar.syncChats")}
            title={syncTitle}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-900 hover:text-brand disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
          </button>
        </div>
      </div>
      {listTab === "chats" && sortMode !== "recent" && (
        <p className="mb-1.5 px-0.5 text-2xs leading-3 text-zinc-600">
          {t("sidebar.sortPinnedHint", { label: localizedSortLabel })}
        </p>
      )}
    </>
  );
}
