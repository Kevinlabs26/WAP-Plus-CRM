import { useAppStore, type NavId } from "@/store/appStore";
import {
  MessageSquare,
  Clock,
  Trophy,
  CalendarCheck,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/i18n";

export function StatsBar() {
  const { t } = useI18n();
  const stats = useAppStore((s) => s.stats);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const goToChats = useAppStore((s) => s.goToChats);
  const activeNav = useAppStore((s) => s.activeNav);
  const chatListFilter = useAppStore((s) => s.chatListFilter);
  const crmPanelCollapsed = useAppStore((s) => s.crmPanelCollapsed);
  const hasSelection = useAppStore(
    (s) => Boolean(s.selectedChatId || s.selectedContactId)
  );
  const setCrmPanelCollapsed = useAppStore((s) => s.setCrmPanelCollapsed);

  const items: {
    id: string;
    labelKey: TranslationKey;
    value: number;
    icon: typeof MessageSquare;
    active: boolean;
    alert?: boolean;
    /** 为 0 时弱化，避免空指标抢视线 */
    muteWhenZero?: boolean;
    titleKey: TranslationKey;
    onClick: () => void;
  }[] = [
    {
      id: "today",
      labelKey: "stats.todayActive",
      value: stats.chatsToday,
      icon: MessageSquare,
      active: activeNav === "chats" && chatListFilter === "today",
      titleKey: "stats.todayActiveTitle",
      onClick: () =>
        goToChats(
          activeNav === "chats" && chatListFilter === "today" ? "all" : "today"
        ),
    },
    {
      id: "unread",
      labelKey: "stats.pendingReply",
      value: stats.pendingReplies,
      icon: Clock,
      active: activeNav === "chats" && chatListFilter === "unread",
      alert: stats.pendingReplies > 0,
      titleKey: "stats.pendingReplyTitle",
      onClick: () =>
        goToChats(
          activeNav === "chats" && chatListFilter === "unread"
            ? "all"
            : "unread"
        ),
    },
    {
      id: "fu",
      labelKey: "stats.followUp",
      value: stats.followUpsToday,
      icon: CalendarCheck,
      active: activeNav === "today",
      alert: stats.followUpsToday > 0,
      titleKey: "stats.followUpTitle",
      onClick: () => setActiveNav("today" as NavId),
    },
    {
      id: "won",
      labelKey: "stats.won",
      value: stats.dealsWon,
      icon: Trophy,
      active: activeNav === "stats",
      muteWhenZero: true,
      titleKey: "stats.wonTitle",
      onClick: () => setActiveNav("stats"),
    },
  ];

  return (
    <div className="stats-chips-bar flex h-8 shrink-0 items-center gap-1.5 border-b border-zinc-800/80 bg-zinc-950/70 px-3 backdrop-blur-sm">
      {items.map(
        ({
          id,
          labelKey,
          value,
          icon: Icon,
          active,
          alert,
          muteWhenZero,
          titleKey,
          onClick,
        }) => {
          const muted = muteWhenZero && value === 0 && !active;
          return (
            <button
              key={id}
              type="button"
              title={t(titleKey)}
              onClick={onClick}
              aria-pressed={active}
              className={cn(
                "stats-pill-btn relative inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-all shadow-2xs",
                active
                  ? "stats-pill-active bg-brand/15 text-brand ring-1 ring-brand/35 font-semibold"
                  : muted
                    ? "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
                    : "text-zinc-200 dark:text-zinc-200 hover:bg-zinc-800 hover:text-white"
              )}
            >
              <Icon
                className={cn(
                  "h-3 w-3",
                  active || alert
                    ? "text-brand"
                    : muted
                      ? "opacity-40"
                      : "text-zinc-400"
                )}
              />
              <span>{t(labelKey)}</span>
              <span
                className={cn(
                  "inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-bold",
                  active
                    ? "bg-brand/20 text-brand"
                    : alert
                      ? "bg-amber-500/20 text-amber-500 dark:text-amber-400"
                      : muted
                        ? "text-zinc-500"
                        : "bg-black/10 dark:bg-zinc-800 text-zinc-300 dark:text-zinc-200"
                )}
              >
                {value}
              </span>
            </button>
          );
        }
      )}
      {activeNav === "chats" && crmPanelCollapsed && hasSelection && (
        <button
          type="button"
          title={t("stats.openCrmPanel")}
          aria-label={t("stats.openCrmPanel")}
          onClick={() => setCrmPanelCollapsed(false)}
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
