import {
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  MoreHorizontal,
  RefreshCw,
  Search,
  UserPlus,
  UsersRound,
  CheckCheck,
  Settings2,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { isSyncDebugEnabled, syncLog } from "@/lib/syncDebug";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";
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
  onGroupFilterChange: (mode: GroupChatFilter) => void;
  getGroupFilterCounts: () => GroupChatCounts;
  /** 一键已读所有群聊 */
  onMarkAllGroupsRead: () => void;
  savedActive: boolean;
  onOpenSaved: () => void;
  leadCount: number;
  leadActive: boolean;
  leadEnabled: boolean;
  onOpenLeads: () => void;
  onOpenLeadSettings: () => void;
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
  onGroupFilterChange,
  getGroupFilterCounts,
  onMarkAllGroupsRead,
  savedActive,
  onOpenSaved,
  leadCount,
  leadActive,
  leadEnabled,
  onOpenLeads,
  onOpenLeadSettings,
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
  const { t, locale } = useI18n();
  const currentCount = (listTab === "chats" ? chatsCount : contactsCount).toLocaleString(locale);
  const localizedSortLabel = t(SORT_LABEL_KEYS[sortMode]);
  const [groupFilterOpen, setGroupFilterOpen] = useState(false);
  const [groupFilterCounts, setGroupFilterCounts] =
    useState<GroupChatCounts | null>(null);
  const groupFilterRef = useRef<HTMLDivElement | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const actions: {
    label: string;
    Icon: typeof UsersRound;
    run: () => void;
    disabled?: boolean;
    title?: string;
    active?: boolean;
    count?: number;
  }[] = [
    { label: t("sidebar.saved"), Icon: Bookmark, run: onOpenSaved, active: savedActive },
    ...(listTab === "chats" ? [{ label: t("leadInbox.title"), Icon: UserRoundPlus, run: onOpenLeads, active: leadActive, count: leadCount, title: !leadEnabled ? t("leadInbox.settings") : t("leadInbox.title") }] : []),
    { label: syncing ? t("sidebar.syncing") : t("sidebar.syncChats"), Icon: RefreshCw, run: onSync, disabled: syncDisabled, title: syncTitle },
    ...(isBaileys ? [{ label: t("sidebar.newGroup"), Icon: UsersRound, run: onCreateGroup }] : []),
    { label: t("sidebar.batchSaveContacts"), Icon: UserPlus, run: onBatchSaveContacts },
    ...(listTab === "chats" ? [{ label: t("leadInbox.settings"), Icon: Settings2, run: onOpenLeadSettings }] : []),
  ];

  useEffect(() => {
    if (!groupFilterOpen && !actionsOpen) return;
    const close = (event: Event) => {
      if (!groupFilterRef.current?.contains(event.target as Node)) setGroupFilterOpen(false);
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const ref = actionsOpen ? actionsRef : groupFilterRef;
      setGroupFilterOpen(false);
      setActionsOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [groupFilterOpen, actionsOpen]);

  return (
    <div className="shrink-0">
      <div className="mb-2 flex items-center gap-3 border-b border-zinc-800/70">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {(["chats", "contacts"] as const).map(tab => <button key={tab} type="button"
            aria-pressed={listTab === tab} onClick={() => onTabChange(tab)}
            title={t(tab === "chats" ? "sidebar.chats" : "sidebar.contacts")}
            className={cn("shrink-0 whitespace-nowrap border-b-2 px-0.5 py-2 text-[13px] transition-colors", listTab === tab ? "border-brand font-semibold text-brand" : "border-transparent text-zinc-500 hover:text-zinc-200")}>
            {t(tab === "chats" ? "sidebar.chats" : "sidebar.contacts")}
          </button>)}
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-zinc-500"
          title={t(listTab === "chats" ? "sidebar.chats" : "sidebar.contacts") + " · " + currentCount}>{currentCount}</span>
      </div>
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
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
            aria-label={t("sidebar.searchPlaceholder")}
            className="ui-control h-9 w-full pl-7 pr-2 text-[13px]"
          />
        </div>
        <div className="relative shrink-0" ref={actionsRef}>
          <button type="button" aria-label={t("sidebar.actions")} title={leadCount > 0 && listTab === "chats" ? t("leadInbox.filterActive", { count: leadCount }) : t("sidebar.actions")}
            aria-expanded={actionsOpen} aria-controls="sidebar-actions" aria-busy={syncing}
            onClick={() => { setGroupFilterOpen(false); if (sortOpen) onToggleSort(); setActionsOpen(open => !open); }}
            className={cn("relative flex h-9 w-8 items-center justify-center rounded-md hover:bg-zinc-900", savedActive || leadActive ? "text-brand" : "text-zinc-500")}>
            {syncing ? <RefreshCw className="h-4 w-4 animate-spin" aria-label={t("sidebar.syncing")} /> : <MoreHorizontal className="h-4 w-4" />}
            {listTab === "chats" && leadCount > 0 && <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-deeper px-1 text-[11px] font-bold leading-none tabular-nums text-white" aria-label={t("leadInbox.filterActive", { count: leadCount })}>{leadCount > 99 ? "99+" : leadCount}</span>}
          </button>
          {actionsOpen && <div id="sidebar-actions" role="group" aria-label={t("sidebar.actions")}
            className="absolute right-0 top-[calc(100%+6px)] z-50 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/30">
            {actions.map(({ label, Icon, run, disabled, title, active, count }) => (
              <button key={label} type="button" disabled={disabled} title={title} aria-label={label} aria-pressed={active}
                onClick={() => { setActionsOpen(false); run(); }}
                className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45", active ? "bg-brand/10 text-brand" : "text-zinc-200")}>
                <Icon className={cn("h-4 w-4 shrink-0", Icon === RefreshCw && syncing && "animate-spin")} />
                {label}
                {count != null && count > 0 && <span className="ml-auto text-2xs tabular-nums text-brand">{count.toLocaleString(locale)}</span>}
              </button>
            ))}
          </div>}
        </div>
      </div>
      <div className="mb-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {listTab === "chats" && listFilter !== "all" && <button type="button" onClick={onClearFilter} title={t("sidebar.showAllChats")} aria-label={t("sidebar.showAllChats")} className="flex max-w-full items-center gap-1 rounded-full bg-brand/10 px-2 py-1 text-2xs text-brand"><span className="truncate">{listFilter === "unread" ? t("sidebar.filterUnread", { count: filteredCount }) : listFilter === "today" ? t("sidebar.filterToday", { count: filteredCount }) : listFilter === "awaiting" ? t("today.awaitingReply") + " · " + filteredCount : t("leadInbox.filterActive", { count: filteredCount })}</span><span aria-hidden="true">×</span></button>}
          {listTab === "chats" && (
            <div className="relative min-w-0 flex-1" ref={groupFilterRef}>
              <button
                type="button"
                aria-pressed={groupFilter !== "all"}
                aria-haspopup="menu"
                aria-expanded={groupFilterOpen}
                aria-label={t("sidebar.groupFilterTitle")}
                title={`${t("sidebar.groupFilterTitle")} · ${t(GROUP_FILTER_LABELS[groupFilter])}`}
                onClick={() => {
                  if (!groupFilterOpen) setGroupFilterCounts(getGroupFilterCounts());
                  setActionsOpen(false);
                  if (sortOpen) onToggleSort();
                  setGroupFilterOpen(open => !open);
                }}
                className={cn("inline-flex min-h-7 max-w-full items-center gap-1 rounded-md px-1.5 text-2xs",
                  groupFilter !== "all" ? "bg-brand/10 text-brand" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100")}
              >
                <UsersRound className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t(GROUP_FILTER_LABELS[groupFilter])}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
              {groupFilterOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-[calc(100%+4px)] z-50 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
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
          {listTab === "chats" && (
            <div className="relative min-w-0 flex-1" ref={sortRef}>
              <button
                type="button"
                title={t("sidebar.sortPinnedHint", { label: localizedSortLabel })}
                aria-label={t("sidebar.sortTitle")}
                aria-expanded={sortOpen}
                onClick={() => { setGroupFilterOpen(false); setActionsOpen(false); onToggleSort(); }}
                className={cn(
                  "inline-flex min-h-7 max-w-full items-center gap-1 rounded-md px-1.5 text-2xs transition-colors",
                  sortOpen
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
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
        </div>
      </div>
    </div>
  );
}
