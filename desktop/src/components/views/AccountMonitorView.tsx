import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Flame,
  Gauge,
  Megaphone,
  PauseCircle,
  ShieldAlert,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import {
  computeAllAccountsHealth,
  localizeAccountHealth,
} from "@/lib/accountHealth";
import { formatAccountDisplay } from "@/lib/accountLabels";
import {
  isWaAccountConnected,
  resolveWaAccountConnection,
} from "@/lib/accountConnection";
import { applyAccountWarmup } from "@/lib/accountWarmup";
import { cn } from "@/lib/utils";
import { Button, Switch } from "@/components/ui/primitives";
import type { HealthLevel } from "@/lib/accountHealth";
import { DEFAULT_RATE_LIMITS } from "@/channels";
import { useI18n, type TranslationKey } from "@/i18n";

const LEVEL_UI: Record<
  HealthLevel,
  {
    bar: string;
    label: TranslationKey;
    Icon: typeof CheckCircle2;
  }
> = {
  green: {
    bar: "bg-emerald-500",
    label: "monitor.good",
    Icon: CheckCircle2,
  },
  yellow: {
    bar: "bg-amber-500",
    label: "monitor.attention",
    Icon: AlertTriangle,
  },
  red: {
    bar: "bg-rose-500",
    label: "monitor.overheated",
    Icon: Flame,
  },
};

export function AccountMonitorView() {
  const { t } = useI18n();
  const {
    accounts,
    sendPausedAccountIds,
    rateLimitEnabled,
    ratePerMinute,
    ratePerHour,
    rateMinIntervalSec,
    blockSendWhenOverheated,
    rateJitterSec,
    globalMinGapSec,
    liveBaileysAccountId,
  } = useAppStore(
    useShallow((s) => ({
      accounts: s.settings.waAccounts ?? [],
      sendPausedAccountIds: s.settings.sendPausedAccountIds ?? [],
      rateLimitEnabled: s.settings.rateLimitEnabled,
      ratePerMinute: s.settings.ratePerMinute,
      ratePerHour: s.settings.ratePerHour,
      rateMinIntervalSec: s.settings.rateMinIntervalSec,
      blockSendWhenOverheated: s.settings.blockSendWhenOverheated,
      rateJitterSec: s.settings.rateJitterSec,
      globalMinGapSec: s.settings.globalMinGapSec,
      liveBaileysAccountId: s.settings.liveBaileysAccountId,
    }))
  );
  const updateSettings = useAppStore((s) => s.updateSettings);
  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const pushToast = useAppStore((s) => s.pushToast);
  const baileysUi = useAppStore((s) => s.baileysUi);
  const campaigns = useAppStore((s) => s.broadcastCampaigns || []);
  const [rulesOpen, setRulesOpen] = useState(false);

  const baseLimits = useMemo(
    () => ({
      ...DEFAULT_RATE_LIMITS,
      perPhonePerMinute:
        ratePerMinute ?? DEFAULT_RATE_LIMITS.perPhonePerMinute,
      perPhonePerHour:
        ratePerHour ?? DEFAULT_RATE_LIMITS.perPhonePerHour,
      minIntervalSec:
        rateMinIntervalSec ?? DEFAULT_RATE_LIMITS.minIntervalSec,
    }),
    [ratePerMinute, ratePerHour, rateMinIntervalSec]
  );

  const healthItems = useMemo(() => {
    const pausedSet = new Set(sendPausedAccountIds);
    const rows = accounts.map((a, index1) => {
      const w = applyAccountWarmup(
        baseLimits,
        a.warmupExempt ? undefined : a.createdAt
      );
      // 滚动窗口由发送/hydrate 维护，这里 O(1) 读取，不再全量扫 messages
      const health = computeAllAccountsHealth({
        accounts: [a],
        caps: {
          perPhonePerHour: w.limits.perPhonePerHour,
          perPhonePerMinute: w.limits.perPhonePerMinute,
          minIntervalSec: w.limits.minIntervalSec,
        },
      })[0];
      return { acc: a, warmup: w, health, index1: index1 + 1 };
    });
    // 红 / 暂停优先，其次黄，再 warmup，最后绿
    const rank = (row: (typeof rows)[0]) => {
      const id = row.health?.accountId || row.acc.id;
      if (pausedSet.has(id) || row.health?.level === "red") return 0;
      if (row.health?.level === "yellow") return 1;
      if (row.warmup.active) return 2;
      return 3;
    };
    return rows.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      const sa = a.health?.score ?? 100;
      const sb = b.health?.score ?? 100;
      return sa - sb;
    });
  }, [accounts, baseLimits, sendPausedAccountIds]);

  const activeCampaign = useMemo(
    () => campaigns.find((c) => c.status === "running" || c.status === "paused"),
    [campaigns]
  );

  const totals = useMemo(() => {
    let green = 0;
    let yellow = 0;
    let red = 0;
    let sentDay = 0;
    let warmupN = 0;
    for (const row of healthItems) {
      const h = row.health;
      if (!h) continue;
      if (h.level === "green") green++;
      else if (h.level === "yellow") yellow++;
      else red++;
      sentDay += h.sentLastDay;
      if (row.warmup.active) warmupN++;
    }
    const connectedCount = accounts.filter((account) =>
      isWaAccountConnected(
        accounts,
        account.id,
        liveBaileysAccountId,
        baileysUi.connection
      )
    ).length;
    return {
      green,
      yellow,
      red,
      sentDay,
      warmupN,
      paused: sendPausedAccountIds.length,
      connectedCount,
    };
  }, [
    accounts,
    healthItems,
    sendPausedAccountIds.length,
    liveBaileysAccountId,
    baileysUi.connection,
  ]);

  const togglePause = (accountId: string) => {
    const set = new Set(sendPausedAccountIds);
    if (set.has(accountId)) {
      set.delete(accountId);
      pushToast(t("monitor.sendResumedToast"), "success");
    } else {
      set.add(accountId);
      pushToast(t("monitor.sendPausedToast"), "info");
    }
    updateSettings({ sendPausedAccountIds: [...set] });
  };

  const toggleRateLimit = async () => {
    const enabled = rateLimitEnabled !== false;
    if (enabled) {
      const ok = await requestConfirm({
        title: t("monitor.disableRateTitle"),
        description: t("monitor.disableRateDescription"),
        confirmLabel: t("monitor.disableRateConfirm"),
        cancelLabel: t("common.cancel"),
        tone: "danger",
      });
      if (!ok) return;
    }
    updateSettings({ rateLimitEnabled: !enabled });
    pushToast(
      t("monitor.rateLimitChanged", {
        state: enabled ? t("monitor.off") : t("monitor.on"),
      }),
      enabled ? "info" : "success"
    );
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-950">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/90 px-5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-brand/10 p-2 text-brand">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">{t("monitor.title")}</div>
            <div className="text-2xs text-zinc-500">
              {t("monitor.subtitle")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            className="!min-h-7 !px-2 text-2xs"
            onClick={() => void toggleRateLimit()}
          >
            {t("monitor.rateLimit", { state: rateLimitEnabled !== false ? t("monitor.on") : t("monitor.off") })}
          </Button>
          <Button
            variant="ghost"
            className="!min-h-7 !px-2 text-2xs"
            onClick={() => setSettingsOpen(true)}
          >
            {t("monitor.settings")}
          </Button>
          <Button
            variant="ghost"
            className="!min-h-7 !px-2 text-2xs"
            onClick={() => setActiveNav("phones")}
          >
            {t("monitor.devices")}
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4 lg:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <StatChip Icon={Gauge} label={t("monitor.accounts")} value={accounts.length} />
          <StatChip Icon={CheckCircle2} label={t("monitor.good")} value={totals.green} tone="ok" />
          <StatChip Icon={AlertTriangle} label={t("monitor.attention")} value={totals.yellow} tone="warn" />
          <StatChip Icon={Flame} label={t("monitor.overheated")} value={totals.red} tone="bad" />
          <StatChip Icon={PauseCircle} label={t("monitor.paused")} value={totals.paused} />
          <StatChip Icon={ShieldAlert} label={t("monitor.warmup")} value={totals.warmupN} />
          <StatChip Icon={Megaphone} label={t("monitor.outbound24")} value={totals.sentDay} />
        </div>
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/35 px-3 py-2 text-2xs text-zinc-500">
          {t("monitor.connectedAccounts", {
            connected: totals.connectedCount,
            total: accounts.length,
          })}
          {" · "}
          {t("monitor.rateLimit", { state: rateLimitEnabled !== false ? t("monitor.on") : t("monitor.off") })}
          {rateLimitEnabled !== false && (
            <>
              {" · "}
              {t("monitor.perMinute", { count: ratePerMinute ?? 8 })}
              {" · "}
              {t("monitor.perHour", { count: ratePerHour ?? 80 })}
            </>
          )}
          {" · "}
          {t("monitor.overheated")} {blockSendWhenOverheated !== false ? t("monitor.on") : t("monitor.off")}
          {rateLimitEnabled !== false && (
            <>
              {" · "}
              {t("monitor.jitter", { seconds: rateJitterSec ?? 2 })}
              {" · "}
              {t("monitor.accountGap", { seconds: globalMinGapSec ?? 2 })}
            </>
          )}
        </div>

        {(totals.red > 0 || totals.paused > 0) && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-100/90">
            {t("monitor.recommendation")}
          </div>
        )}

        {activeCampaign && (
          <button
            type="button"
            onClick={() => setActiveNav("broadcast")}
            className="flex w-full items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-3 py-2.5 text-left text-[11px] text-brand transition-colors hover:bg-brand/15"
          >
            <Megaphone className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t("monitor.activeCampaign", { status: activeCampaign.status === "running" ? t("monitor.running") : t("monitor.paused") })}
              {" · "}
              {(activeCampaign.title || activeCampaign.template || "").slice(0, 36)}
            </span>
            <span className="shrink-0 text-brand/80">{t("stats.openCrm")}</span>
          </button>
        )}

        {!accounts.length ? (
          <div className="mt-8 rounded-lg border border-dashed border-zinc-800 px-6 py-12 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-[13px] text-zinc-300">{t("monitor.noAccounts")}</p>
            <p className="mt-1 text-[11px] text-zinc-600">
              {t("monitor.noAccountsHint")}
            </p>
            <Button
              variant="secondary"
              className="mt-4 !min-h-8"
              onClick={() => setActiveNav("phones")}
            >
              {t("monitor.goDevices")}
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-900/30 shadow-sm shadow-black/10">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800/90 px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold text-zinc-100">
                  {t("monitor.accounts")}
                </h2>
                <p className="mt-0.5 text-2xs text-zinc-500">
                  {t("monitor.connectedAccounts", {
                    connected: totals.connectedCount,
                    total: accounts.length,
                  })}
                </p>
              </div>
              <span className="rounded-md bg-zinc-800/80 px-2 py-1 text-2xs font-medium tabular-nums text-zinc-300">
                {accounts.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[minmax(9rem,1.25fr)_minmax(6rem,0.7fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,0.9fr)] gap-4 border-b border-zinc-800/80 bg-zinc-900/55 px-4 py-2.5 text-2xs font-medium text-zinc-500">
                  <span>{t("monitor.accountColumn")}</span>
                  <span>{t("monitor.statusColumn")}</span>
                  <span>{t("monitor.hourColumn")}</span>
                  <span>{t("monitor.dayColumn")}</span>
                  <span className="text-right">{t("monitor.actionsColumn")}</span>
                </div>
                {healthItems.map((row) => {
                  const h = row.health;
                  if (!h) return null;
                  const acc = row.acc;
                  const ui = LEVEL_UI[h.level];
                  const Icon = ui.Icon;
                  const healthText = localizeAccountHealth(h, t);
                  const title = formatAccountDisplay({
                    label: acc?.label,
                    userName: acc?.userName,
                    index1: row.index1,
                  });
                  const isPaused = sendPausedAccountIds.includes(h.accountId);
                  const hourPct = Math.min(
                    100,
                    Math.round((h.sentLastHour / Math.max(1, h.caps.perHour)) * 100)
                  );
                  const dayPct = Math.min(
                    100,
                    Math.round((h.sentLastDay / Math.max(1, h.caps.perDaySoft)) * 100)
                  );
                  const live = resolveWaAccountConnection(
                    accounts,
                    h.accountId,
                    liveBaileysAccountId,
                    baileysUi.connection
                  );

                  return (
                    <div key={h.accountId} className="border-b border-zinc-800/70 last:border-b-0">
                      <div className="grid grid-cols-[minmax(9rem,1.25fr)_minmax(6rem,0.7fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,0.9fr)] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-800/20">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-zinc-100">
                            {title}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs text-zinc-500">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                live === "connected"
                                  ? "bg-emerald-500"
                                  : live === "connecting"
                                    ? "animate-pulse bg-amber-400"
                                    : "bg-zinc-600"
                              )}
                            />
                            <span className="shrink-0">
                              {t(
                                live === "connected"
                                  ? "monitor.connected"
                                  : live === "connecting"
                                    ? "monitor.connecting"
                                    : "monitor.disconnected"
                              )}
                            </span>
                            <span className="truncate">· {acc?.phoneE164 || h.accountId}</span>
                          </div>
                        </div>

                        <div>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-2xs font-semibold",
                              isPaused
                                ? "bg-zinc-800 text-zinc-300"
                                : h.level === "green"
                                  ? "bg-emerald-500/10 text-emerald-300"
                                  : h.level === "yellow"
                                    ? "bg-amber-500/10 text-amber-300"
                                    : "bg-rose-500/10 text-rose-300"
                            )}
                          >
                            {isPaused ? <PauseCircle className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                            {isPaused ? t("monitor.paused") : t(ui.label)}
                          </span>
                          <div className="mt-1 text-2xs text-zinc-500">
                            {t("monitor.score", { score: h.score })}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <Meter
                            label={t("monitor.lastHour", {
                              sent: h.sentLastHour,
                              cap: h.caps.perHour,
                            })}
                            pct={hourPct}
                            barClass={ui.bar}
                          />
                        </div>

                        <div className="min-w-0">
                          <Meter
                            label={t("monitor.lastDay", {
                              sent: h.sentLastDay,
                              cap: h.caps.perDaySoft,
                            })}
                            pct={dayPct}
                            barClass="bg-zinc-400"
                          />
                          <div className="mt-1 text-2xs text-zinc-500">
                            {t("monitor.chatsToday", { count: h.newChatsLastDay })}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <label className="flex cursor-pointer items-center gap-2 text-2xs text-zinc-400">
                            <span>
                              {isPaused
                                ? t("monitor.resumeSending")
                                : t("monitor.pauseSending")}
                            </span>
                            <Switch
                              checked={!isPaused}
                              aria-label={
                                isPaused
                                  ? t("monitor.resumeSending")
                                  : t("monitor.pauseSending")
                              }
                              onChange={() => togglePause(h.accountId)}
                            />
                          </label>
                          <Button
                            variant="ghost"
                            className="!min-h-7 !px-2 text-2xs"
                            onClick={() => {
                              updateSettings({
                                activeAccountId: h.accountId,
                                accountViewMode: {
                                  type: "account",
                                  accountId: h.accountId,
                                },
                              });
                              setActiveNav("chats");
                            }}
                          >
                            {t("monitor.openChats")}
                          </Button>
                        </div>
                      </div>

                      {(row.warmup.active || !acc?.createdAt || healthText.hints.length > 0 || isPaused) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-800/50 bg-zinc-950/20 px-4 py-2 text-2xs text-zinc-500">
                          {row.warmup.active && (
                            <span className="text-sky-300/90">
                              {t("monitor.warmupActive", { hours: row.warmup.hoursLeft })}
                              {" · "}
                              {t("monitor.limits", {
                                minute: row.warmup.limits.perPhonePerMinute,
                                hour: row.warmup.limits.perPhonePerHour,
                              })}
                            </span>
                          )}
                          {!acc?.createdAt && <span>{t("monitor.noCreatedAt")}</span>}
                          {healthText.hints.slice(0, 2).map((hint) => (
                            <span key={hint} className="inline-flex items-start gap-1">
                              <Activity className="mt-px h-3 w-3 shrink-0 opacity-50" />
                              {hint}
                            </span>
                          ))}
                          {isPaused && <span>{t("monitor.sendingPaused")}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-zinc-800/90 bg-zinc-900/30">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
            onClick={() => setRulesOpen((v) => !v)}
          >
            {rulesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
            )}
            <span className="text-[12px] font-medium text-zinc-300">
              {t("monitor.rulesTitle")}
            </span>
          </button>
          {rulesOpen && (
            <ul className="space-y-1.5 border-t border-zinc-800/80 px-4 py-3 text-[11px] leading-4 text-zinc-500">
              <li>{t("monitor.ruleScore")}</li>
              <li>{t("monitor.ruleGates")}</li>
              <li>{t("monitor.ruleAdvice")}</li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({
  Icon,
  label,
  value,
  tone,
}: {
  Icon: typeof CheckCircle2;
  label: string;
  value: number;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className="stat-chip-card flex items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/60 px-3.5 py-3 shadow-sm shadow-black/10">
      <div className="min-w-0">
        <div className="truncate text-2xs font-medium text-zinc-400">
          {label}
        </div>
        <div
          className={cn(
            "mt-1 text-xl font-bold tabular-nums tracking-tight",
            tone === "ok" && "text-emerald-400",
            tone === "warn" && "text-amber-400",
            tone === "bad" && "text-rose-400",
            !tone && "text-zinc-100"
          )}
        >
          {value}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 rounded-lg p-2",
          tone === "ok" && "bg-emerald-500/10 text-emerald-300",
          tone === "warn" && "bg-amber-500/10 text-amber-300",
          tone === "bad" && "bg-rose-500/10 text-rose-300",
          !tone && "bg-brand/10 text-brand"
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
      </div>
    </div>
  );
}

function Meter({
  label,
  pct,
  barClass,
}: {
  label: string;
  pct: number;
  barClass: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-2xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums font-bold text-zinc-700 dark:text-zinc-200">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-black/50 ring-1 ring-white/5">
        <div
          className={cn("h-full rounded-full transition-all", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
