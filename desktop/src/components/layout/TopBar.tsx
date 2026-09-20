import { useEffect, useMemo, useRef, useState } from "react";
import { Coffee, Settings, Search } from "lucide-react";
import { useAppStore, type NavId } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { DonateModal } from "@/components/DonateModal";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { AccountSwitcherMenu } from "./AccountSwitcherMenu";
import { computeAllAccountsHealth } from "@/lib/accountHealth";
import { syncLog } from "@/lib/syncDebug";
import { useI18n, type TranslationKey } from "@/i18n";

/**
 * 主导航（一级）：工作台处理任务，客户库管理完整资料。
 * 完整跟进计划表：工作台「计划表」· ⌘K · 侧栏摘要，不占顶栏。
 */
const NAV: { id: NavId; labelKey: TranslationKey }[] = [
  { id: "today", labelKey: "nav.today" },
  { id: "chats", labelKey: "nav.chats" },
  { id: "crm", labelKey: "nav.crm" },
  { id: "broadcast", labelKey: "nav.broadcast" },
  { id: "starred", labelKey: "nav.starred" },
  { id: "stats", labelKey: "nav.stats" },
  { id: "monitor", labelKey: "nav.monitor" },
  { id: "phones", labelKey: "nav.phones" },
];

export function TopBar() {
  const [donateOpen, setDonateOpen] = useState(false);
  const { t } = useI18n();
  const activeNav = useAppStore((s) => s.activeNav);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const goToChats = useAppStore((s) => s.goToChats);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const updateAvailableVersion = useAppStore((s) => s.updateAvailableVersion);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const sendChannel = useAppStore((s) => s.settings.sendChannel);
  const followUps = useAppStore((s) => s.followUps);
  const stats = useAppStore((s) => s.stats);
  const waAccounts = useAppStore((s) => s.settings.waAccounts || []);
  const pausedIds = useAppStore((s) => s.settings.sendPausedAccountIds || []);
  const ratePerHour = useAppStore((s) => s.settings.ratePerHour);
  const ratePerMinute = useAppStore((s) => s.settings.ratePerMinute);
  const rateMinIntervalSec = useAppStore((s) => s.settings.rateMinIntervalSec);
  const isBaileys = sendChannel !== "android_bridge";
  const navTraceRef = useRef<{
    from: NavId;
    to: NavId;
    startedAt: number;
  } | null>(null);

  useEffect(() => {
    const trace = navTraceRef.current;
    if (!trace || trace.to !== activeNav) return;
    const durationMs = Math.round(performance.now() - trace.startedAt);
    syncLog(
      "ui.nav",
      "state updated",
      { from: trace.from, to: trace.to, durationMs },
      durationMs >= 50 ? "warn" : "debug"
    );
    navTraceRef.current = null;
  }, [activeNav]);

  const todayBadge = useMemo(() => {
    const today = (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    })();
    let overdue = 0;
    for (const f of followUps) {
      if (f.done) continue;
      const d = (f.dueAt || "").slice(0, 10);
      if (d && d < today) overdue += 1;
    }
    if (overdue > 0) {
      return { n: Math.min(9, overdue), tone: "bad" as const };
    }
    const fu = stats.followUpsToday || 0;
    const unread = stats.pendingReplies || 0;
    if (fu > 0 || unread > 0) {
      return { n: Math.min(9, Math.max(fu, unread, 1)), tone: "warn" as const };
    }
    return null;
  }, [followUps, stats.followUpsToday, stats.pendingReplies]);

  const monitorBadge = useMemo(() => {
    if (!waAccounts.length) return null as null | { n: number; tone: "bad" | "warn" };
    const paused = new Set(pausedIds);
    // 滚动窗口由 noteOutboundSend / hydrate seed 维护，这里 O(1) 读取，不再全量扫 messages
    const health = computeAllAccountsHealth({
      accounts: waAccounts,
      caps: {
        perPhonePerHour: ratePerHour,
        perPhonePerMinute: ratePerMinute,
        minIntervalSec: rateMinIntervalSec,
      },
    });
    let red = 0;
    let yellow = 0;
    for (const h of health) {
      if (h.level === "red") red++;
      else if (h.level === "yellow") yellow++;
    }
    const pauseN = paused.size;
    if (red > 0 || pauseN > 0) {
      return { n: red + pauseN, tone: "bad" as const };
    }
    if (yellow > 0) return { n: yellow, tone: "warn" as const };
    return null;
  }, [
    waAccounts,
    stats,
    pausedIds,
    ratePerHour,
    ratePerMinute,
    rateMinIntervalSec,
  ]);

  return (
    <header className="crm-topbar flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800/90 bg-zinc-900 px-3 sm:gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <WapPlusMark />
        <div className="whitespace-nowrap text-[13px] font-semibold tracking-tight">
          WAP Plus<span className="text-brand"> CRM</span>
        </div>

        {isBaileys && (
          <div className="ml-1 hidden min-w-0 sm:block">
            <AccountSwitcherMenu variant="compact" />
          </div>
        )}
      </div>

      <nav className="mx-auto hidden min-w-0 max-w-[58vw] items-center gap-1 overflow-x-auto md:flex">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              navTraceRef.current = {
                from: activeNav,
                to: item.id,
                startedAt: performance.now(),
              };
              syncLog(
                "ui.nav",
                "click",
                { from: activeNav, to: item.id },
                "debug"
              );
              // 「会话」始终进全部会话，避免停在今日活跃/待回复筛选里找不到完整列表
              if (item.id === "chats") goToChats("all");
              else setActiveNav(item.id);
            }}
            className={cn(
              "relative shrink-0 whitespace-nowrap rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors",
              activeNav === item.id
                ? "crm-nav-active bg-zinc-800/75 text-zinc-50"
                : "text-zinc-500 hover:text-zinc-200"
            )}
            title={item.id === "chats" ? t("nav.allChats") : t(item.labelKey)}
          >
            {t(item.labelKey)}
            {item.id === "monitor" && monitorBadge && (
              <span
                className={cn(
                  "absolute -right-0.5 top-0 z-10 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-2xs font-semibold leading-none tabular-nums text-white",
                  monitorBadge.tone === "bad" ? "bg-rose-500" : "bg-amber-500"
                )}
                title={
                  monitorBadge.tone === "bad"
                    ? t("nav.monitorWarning")
                    : t("nav.monitorNotice")
                }
              >
                {monitorBadge.n > 9 ? "9+" : monitorBadge.n}
              </span>
            )}
            {item.id === "today" && todayBadge && (
              <span
                className={cn(
                  "absolute -right-0.5 top-0 z-10 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-2xs font-semibold leading-none tabular-nums text-white",
                  todayBadge.tone === "bad" ? "bg-rose-500" : "bg-amber-500"
                )}
                title={
                  todayBadge.tone === "bad"
                    ? t("nav.overdueFollowUps")
                    : t("nav.todayWork")
                }
              >
                {todayBadge.n > 9 ? "9+" : todayBadge.n}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {isBaileys && (
          <div className="min-w-0 sm:hidden">
            <AccountSwitcherMenu variant="compact" />
          </div>
        )}
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="ui-btn-secondary gap-2 !min-h-8 px-2.5 text-zinc-400"
          title={t("nav.searchTitle")}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden text-[12px] md:inline">{t("nav.search")}</span>
          <kbd className="hidden rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-2xs text-zinc-600 lg:inline">
            ⌘K
          </kbd>
        </button>
        <Button
          variant="ghost"
          className="!min-h-8 gap-1 !px-2 text-zinc-400 hover:text-rose-300"
          title={t("nav.supportTitle")}
          onClick={() => setDonateOpen(true)}
        >
          <Coffee className="h-4 w-4" />
          <span className="hidden text-[12px] md:inline">{t("nav.support")}</span>
        </Button>
        <Button
          variant="ghost"
          className="!min-h-8 w-8 !px-0"
          title={
            updateAvailableVersion
              ? t("updates.found", { version: updateAvailableVersion })
              : t("nav.settings")
          }
          onClick={() =>
            setSettingsOpen(true, updateAvailableVersion ? "updates" : undefined)
          }
        >
          <span className="relative inline-flex">
            <Settings className="h-4 w-4" />
            {updateAvailableVersion && (
              <span
                aria-label={t("updates.found", { version: updateAvailableVersion })}
                title={t("updates.found", { version: updateAvailableVersion })}
                className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-brand ring-2 ring-zinc-900"
              />
            )}
          </span>
        </Button>
      </div>
      {donateOpen && <DonateModal onClose={() => setDonateOpen(false)} />}
    </header>
  );
}
