import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Coffee, Settings, Search } from "lucide-react";
import { useAppStore, type NavId } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { DonateModal } from "@/components/DonateModal";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { AccountSwitcherMenu } from "./AccountSwitcherMenu";
import { computeAllAccountsHealth } from "@/lib/accountHealth";
import { syncLog } from "@/lib/syncDebug";
import { useI18n, type TranslationKey } from "@/i18n";

/** 日常沟通入口常驻，辅助页面收进「更多」。 */
const NAV: { id: NavId; labelKey: TranslationKey }[] = [
  { id: "today", labelKey: "nav.today" },
  { id: "chats", labelKey: "nav.chats" },
  { id: "crm", labelKey: "nav.crm" },
];
const MORE_NAV: { id: NavId; labelKey: TranslationKey }[] = [
  { id: "broadcast", labelKey: "nav.broadcast" },
  { id: "starred", labelKey: "nav.starred" },
  { id: "stats", labelKey: "nav.stats" },
  { id: "monitor", labelKey: "nav.monitor" },
  { id: "phones", labelKey: "nav.phones" },
];

export function TopBar() {
  const [donateOpen, setDonateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
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
  const activeMore = MORE_NAV.find((item) => item.id === activeNav);
  const navTraceRef = useRef<{
    from: NavId;
    to: NavId;
    startedAt: number;
  } | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const navigate = (id: NavId) => {
    navTraceRef.current = { from: activeNav, to: id, startedAt: performance.now() };
    syncLog("ui.nav", "click", { from: activeNav, to: id }, "debug");
    setMoreOpen(false);
    // 会话入口始终回到完整列表。
    if (id === "chats") goToChats("all");
    else setActiveNav(id);
  };

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
    const awaiting = stats.awaitingReplyChats || 0;
    if (fu > 0 || awaiting > 0) {
      return { n: Math.min(9, Math.max(fu, awaiting, 1)), tone: "warn" as const };
    }
    return null;
  }, [followUps, stats.followUpsToday, stats.awaitingReplyChats]);

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
    <header className="crm-topbar flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/90 bg-zinc-900 px-3 py-1 md:h-11 md:flex-nowrap md:py-0 sm:gap-3">
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

      <nav className="order-last mx-auto flex w-full min-w-0 items-center justify-center gap-1 md:order-none md:w-auto">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.id)}
            aria-current={activeNav === item.id ? "page" : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors",
              activeNav === item.id
                ? "crm-nav-active bg-zinc-800/75 text-zinc-50"
                : "text-zinc-500 hover:text-zinc-200"
            )}
            title={item.id === "chats" ? t("nav.allChats") : t(item.labelKey)}
          >
            {t(item.labelKey)}
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
        <div ref={moreRef} className="relative shrink-0">
          <button
            ref={moreButtonRef}
            type="button"
            aria-expanded={moreOpen}
            aria-controls="topbar-more-nav"
            onClick={() => setMoreOpen((open) => !open)}
            className={cn(
              "relative flex items-center gap-1 whitespace-nowrap rounded-[6px] px-3 py-1.5 text-[12px] font-medium",
              activeMore || moreOpen ? "crm-nav-active bg-zinc-800/75 text-zinc-50" : "text-zinc-500 hover:text-zinc-200"
            )}
          >
            {activeMore ? `${t("nav.more")} · ${t(activeMore.labelKey)}` : t("nav.more")}
            <ChevronDown className="h-3 w-3" />
            {monitorBadge && <span
              className={cn("absolute -right-0.5 top-0 rounded-full px-1 text-2xs text-white", monitorBadge.tone === "bad" ? "bg-rose-500" : "bg-amber-500")}
              aria-label={t(monitorBadge.tone === "bad" ? "nav.monitorWarning" : "nav.monitorNotice")}
              title={t(monitorBadge.tone === "bad" ? "nav.monitorWarning" : "nav.monitorNotice")}
            >{monitorBadge.n > 9 ? "9+" : monitorBadge.n}</span>}
          </button>
          {moreOpen && <div id="topbar-more-nav" className="absolute right-0 top-full z-50 mt-2 min-w-36 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
            {MORE_NAV.map((item) => <button
              key={item.id}
              type="button"
              aria-current={activeNav === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
              className={cn("flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-xs hover:bg-zinc-800", activeNav === item.id ? "text-brand" : "text-zinc-300")}
            >
              {t(item.labelKey)}
              {item.id === "monitor" && monitorBadge && <span className={monitorBadge.tone === "bad" ? "text-rose-400" : "text-amber-400"}>{monitorBadge.n > 9 ? "9+" : monitorBadge.n}</span>}
            </button>)}
          </div>}
        </div>
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
