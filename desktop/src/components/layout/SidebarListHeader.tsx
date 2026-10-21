import {
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  UsersRound,
  CheckCheck,
  Settings2,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { isSyncDebugEnabled, syncLog } from "@/lib/syncDebug";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";
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
  const { t } = useI18n();
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
  }[] = [
    ...(isBaileys ? [{ label: t("sidebar.newGroup"), Icon: UsersRound, run: onCreateGroup }] : []),
    { label: t("sidebar.batchSaveContacts"), Icon: UserPlus, run: onBatchSaveContacts },
    ...(listTab === "chats" ? [{ label: t("leadInbox.settings"), Icon: Settings2, run: onOpenLeadSettings }] : []),
    { label: syncing ? t("sidebar.syncing") : t("sidebar.syncChats"), Icon: RefreshCw, run: onSync, disabled: syncDisabled, title: syncTitle },
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
      <div className="mb-3 grid grid-cols-2 rounded-lg bg-zinc-900 p-1 text-[13px]">
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
          <button type="button" aria-label={t("sidebar.actions")} title={t("sidebar.actions")}
            aria-expanded={actionsOpen} aria-controls="sidebar-actions"
            onClick={() => { setGroupFilterOpen(false); setActionsOpen(open => !open); }}
            className="ui-btn-secondary h-9 w-9 !px-0">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {actionsOpen && <div id="sidebar-actions" role="group" aria-label={t("sidebar.actions")}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/30">
            {actions.map(({ label, Icon, run, disabled, title }) => (
              <button key={label} type="button" disabled={disabled} title={title}
                onClick={() => { setActionsOpen(false); run(); }}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45">
                <Icon className={cn("h-4 w-4 shrink-0", Icon === RefreshCw && syncing && "animate-spin")} />
                {label}
              </button>
            ))}
          </div>}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <button type="button" onClick={onOpenSaved} title={`${t("sidebar.saved")} · ${t("sidebar.savedLocal")}`} aria-pressed={savedActive}
          className={cn("flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-5",
            savedActive ? "bg-brand/10 font-medium text-brand" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100")}>
          <Bookmark className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{t("sidebar.saved")}</span>
        </button>
        {listTab === "chats" && (
          <button type="button" onClick={onOpenLeads} aria-pressed={leadActive}
            title={!leadEnabled ? t("leadInbox.settings") : t("leadInbox.title")}
            className={cn("flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-5",
              leadActive ? "bg-brand/10 font-medium text-brand" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100")}>
            <UserRoundPlus className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{t("leadInbox.title")}</span>
            {leadCount > 0 && <span className="text-2xs font-semibold tabular-nums text-brand">{leadCount}</span>}
          </button>
        )}
      </div>
      {listTab === "chats" && listFilter !== "all" && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-brand/25 bg-brand/10 px-2 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-medium text-brand">
            {listFilter === "unread"
              ? t("sidebar.filterUnread", { count: filteredCount })
              : listFilter === "today"
                ? t("sidebar.filterToday", { count: filteredCount })
                : t("leadInbox.filterActive", { count: filteredCount })}
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
      <div className="mb-2 space-y-2">
        {!(listTab === "chats" && !filter && groupFilter === "hidden") && (
          <SectionLabel className="!mb-0 block">
            {listTab === "chats"
              ? listFilter === "unread"
                ? t("sidebar.unreadChats")
                : listFilter === "awaiting"
                  ? t("today.awaitingReply")
                : listFilter === "today"
                  ? t("sidebar.todayChats")
                  : listFilter === "leads"
                    ? t("leadInbox.title")
                    : filter
                      ? t("sidebar.searchResults")
                      : t(GROUP_FILTER_LABELS[groupFilter])
              : t("sidebar.contacts")}
          </SectionLabel>
        )}
        <div className="flex items-center justify-between gap-1.5">
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
                  setGroupFilterOpen(open => !open);
                }}
                className={cn("inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border px-2 text-[12px]",
                  groupFilter !== "all" ? "border-brand/40 bg-brand/10 text-brand" : "border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100")}
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
                onClick={onToggleSort}
                className={cn(
                  "inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border px-2 text-[12px] transition-colors",
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
        </div>
      </div>
    </div>
  );
}
