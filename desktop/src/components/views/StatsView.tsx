import { useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { SectionLabel } from "@/components/ui/primitives";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import type { AccountDashStats } from "@/types/crm";
import { cn } from "@/lib/utils";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { salesStagesWithLabels } from "@/lib/contactWorkflow";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";

function accountLabel(
  accountId: string,
  accounts: { id: string; label: string; userName?: string; phoneE164?: string }[],
  index1?: number
): string {
  const a = accounts.find((x) => x.id === accountId);
  if (!a) {
    if (accountId === DEFAULT_ACCOUNT_ID) return "未归属 / 默认";
    return accountId.slice(0, 12);
  }
  return formatAccountDisplay({
    label: a.label,
    userName: a.userName,
    index1,
  });
}

function mergeAccountRows(
  rows: AccountDashStats[] | undefined,
  accountIds: string[]
): AccountDashStats[] {
  const map = new Map<string, AccountDashStats>();
  for (const r of rows || []) {
    map.set(r.accountId, {
      ...r,
      pendingReplyChats: r.pendingReplyChats || 0,
      trend7d: r.trend7d || [],
    });
  }
  for (const id of accountIds) {
    if (!map.has(id)) {
      map.set(id, {
        accountId: id,
        chatsToday: 0,
        pendingReplyChats: 0,
        pendingReplies: 0,
        dealsWon: 0,
        followUpsToday: 0,
        contacts: 0,
        trend7d: [],
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    const score = (x: AccountDashStats) =>
      x.pendingReplyChats * 1000 + x.chatsToday * 10 + x.contacts;
    return score(b) - score(a) || a.accountId.localeCompare(b.accountId);
  });
}

function emptyRow(accountId: string): AccountDashStats {
  return {
    accountId,
    chatsToday: 0,
    pendingReplyChats: 0,
    pendingReplies: 0,
    dealsWon: 0,
    followUpsToday: 0,
    contacts: 0,
    trend7d: [],
  };
}

function sumRows(rows: AccountDashStats[]): AccountDashStats {
  const out = emptyRow("all");
  for (const r of rows) {
    out.chatsToday += r.chatsToday;
    out.pendingReplyChats += r.pendingReplyChats;
    out.pendingReplies += r.pendingReplies;
    out.dealsWon += r.dealsWon;
    out.followUpsToday += r.followUpsToday;
    out.contacts += r.contacts;
  }
  return out;
}

export function StatsView() {
  const { t } = useI18n();
  const stats = useAppStore((s) => s.stats);
  const contacts = useAppStore((s) => s.contacts);
  const messages = useAppStore((s) => s.messages);
  const waAccounts = useAppStore((s) => s.settings.waAccounts || []);
  const activeAccountId = useAppStore((s) => s.settings.activeAccountId);
  const salesStageLabels = useAppStore(
    (s) => s.settings.salesStageLabels || {}
  );
  const salesStageOrder = useAppStore(
    (s) => s.settings.salesStageOrder || []
  );
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const goToChats = useAppStore((s) => s.goToChats);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [scope, setScope] = useState<string>("all");
  const [trendTableOpen, setTrendTableOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  const accountRows = useMemo(
    () =>
      mergeAccountRows(
        stats.byAccount,
        waAccounts.map((a) => a.id)
      ),
    [stats.byAccount, waAccounts]
  );

  const scoped = useMemo(() => {
    if (scope === "all") return sumRows(accountRows);
    return (
      accountRows.find((r) => r.accountId === scope) || emptyRow(scope)
    );
  }, [accountRows, scope]);

  const scopedContacts = useMemo(() => {
    if (scope === "all") return contacts;
    return contacts.filter(
      (c) => (c.accountId || DEFAULT_ACCOUNT_ID) === scope
    );
  }, [contacts, scope]);

  const stages = useMemo(
    () => salesStagesWithLabels(salesStageLabels, salesStageOrder),
    [salesStageLabels, salesStageOrder]
  );
  const stageDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const contact of scopedContacts) {
      counts.set(contact.stage, (counts.get(contact.stage) || 0) + 1);
    }
    return stages.map((stage) => ({
      ...stage,
      count: counts.get(stage.id) || 0,
    }));
  }, [scopedContacts, stages]);
  const funnelTotal = Math.max(scopedContacts.length, 1);

  const trend7d = useMemo(() => {
    if (scope === "all") return stats.trend7d || [];
    if (scoped.trend7d.length) return scoped.trend7d;
    return (stats.trend7d || []).map((day) => ({
      ...day,
      activeChats: 0,
      inbound: 0,
      outbound: 0,
    }));
  }, [scope, scoped.trend7d, stats.trend7d]);
  const trendMax = useMemo(() => {
    let active = 1;
    let messages = 1;
    for (const d of trend7d) {
      active = Math.max(active, d.activeChats);
      messages = Math.max(messages, d.inbound + d.outbound);
    }
    return { active, messages };
  }, [trend7d]);
  const trendHasActivity = useMemo(
    () =>
      trend7d.some(
        (d) => d.activeChats > 0 || d.inbound > 0 || d.outbound > 0
      ),
    [trend7d]
  );

  const openCrmStage = (stageId: string) => {
    try {
      localStorage.setItem("wap.crmMode", "board");
      localStorage.setItem("wap.crmQuickFilter", "all");
      localStorage.setItem("wap.crmStageFocus", stageId);
    } catch {
      /* ignore */
    }
    setActiveNav("crm");
  };

  const openScopedChats = (filter: "today" | "unread") => {
    updateSettings({
      accountViewMode:
        scope === "all"
          ? { type: "all" }
          : { type: "account", accountId: scope },
    });
    goToChats(filter);
  };

  const kpis = [
    {
      label: t("stats.todayActive"),
      value: scoped.chatsToday,
      hint: t("stats.todayActiveTitle"),
      onClick: () => openScopedChats("today"),
    },
    {
      label: t("stats.pendingReply"),
      value: scoped.pendingReplyChats,
      hint: `${scoped.pendingReplies} · ${t("stats.pendingReplyTitle")}`,
      alert: scoped.pendingReplyChats > 0,
      onClick: () => openScopedChats("unread"),
    },
    {
      label: t("stats.followUp"),
      value: scoped.followUpsToday,
      hint: t("stats.followUpTitle"),
      alert: scoped.followUpsToday > 0,
      onClick: () => setActiveNav("today"),
    },
    {
      label: t("stats.won"),
      value: scoped.dealsWon,
      hint: t("stats.wonTitle"),
      onClick: () => openCrmStage("won"),
    },
  ];

  const scopeHint =
    scope === "all"
      ? t("today.allAccounts")
      : accountLabel(
          scope,
          waAccounts,
          waAccounts.findIndex((a) => a.id === scope) + 1 || undefined
        );

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-950">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/90 px-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("stats.pageTitle")}</div>
          <div className="truncate text-2xs text-zinc-500">
            {t("stats.scopeNote")}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500">
          {t("stats.range")}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="ui-control h-8 max-w-[11rem] px-2 text-[12px] text-zinc-200"
          >
            <option value="all">{t("today.allAccounts")}</option>
            {waAccounts.map((a, i) => (
              <option key={a.id} value={a.id}>
                {formatAccountDisplay({
                  label: a.label,
                  userName: a.userName,
                  index1: i + 1,
                })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="p-4">
        <div className="mx-auto w-full max-w-7xl">
        {scope === "all" && activeAccountId && waAccounts.length > 1 && (
          <p className="mb-3 text-2xs text-zinc-600">
            {t("stats.subtitle", { scope: scopeHint })}
            <button
              type="button"
              className="ml-1 text-brand hover:underline"
              onClick={() => setScope(activeAccountId)}
            >
              {t("stats.switchCurrent")}
            </button>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {kpis.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div className="break-words text-2xs text-zinc-500">{c.label}</div>
              <div
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                  c.alert ? "text-brand" : "text-zinc-50"
                )}
              >
                {c.value}
              </div>
              <div className="mt-1 break-words text-2xs text-zinc-600">{c.hint}</div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setInventoryOpen((v) => !v)}
          className="mt-3 flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400"
        >
          {inventoryOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {t("stats.inventory")}
        </button>
        {inventoryOpen && (
          <div className="mt-2 flex flex-wrap gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 text-[11px] text-zinc-500">
            <span>
              {t("stats.contacts")}{" "}
              <strong className="tabular-nums font-medium text-zinc-300">
                {scopedContacts.length}
              </strong>
            </span>
            <span>
              {t("stats.accountSlots")}{" "}
              <strong className="tabular-nums font-medium text-zinc-300">
                {waAccounts.length}
              </strong>
            </span>
            <span>
              {t("stats.localMessages")}{" "}
              <strong className="tabular-nums font-medium text-zinc-300">
                {messages.length}
              </strong>
              <span className="text-zinc-600">{t("stats.fullLibrary")}</span>
            </span>
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => setActiveNav("crm")}
            >
              {t("stats.openCrm")}
            </button>
          </div>
        )}

        <div className="mt-8">
          <SectionLabel>{t("stats.trend")}</SectionLabel>
          <p className="mb-2 text-2xs text-zinc-600">
            {scopeHint} · {t("stats.trendHint")}
          </p>
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/30 p-4">
            {trend7d.length === 0 ? (
              <p className="text-[12px] text-zinc-500">
                {t("stats.loading")}
              </p>
            ) : !trendHasActivity ? (
              <div className="space-y-1 py-2 text-center">
                <p className="text-[12px] text-zinc-400">
                  {t("stats.noActivity")}
                </p>
                <p className="text-2xs text-zinc-600">
                  {t("stats.noActivityHint")}
                </p>
              </div>
            ) : (
              <>
                <div className="flex h-28 items-end gap-1.5 sm:gap-2">
                  {trend7d.map((d) => {
                    const total = d.inbound + d.outbound;
                    const hActive =
                      d.activeChats <= 0
                        ? 2
                        : Math.max(
                            4,
                            Math.round((d.activeChats / trendMax.active) * 100)
                          );
                    const hMsg =
                      total <= 0
                        ? 2
                        : Math.max(
                            6,
                            Math.round((total / trendMax.messages) * 100)
                          );
                    return (
                      <div
                        key={d.day}
                        className="flex min-w-0 flex-1 flex-col items-center gap-1"
                        title={`${d.day}\n${t("tooltip.activeStats", { active: d.activeChats, inbound: d.inbound, outbound: d.outbound })}`}
                      >
                        <div className="flex h-24 w-full items-end justify-center gap-0.5">
                          <div
                            className="w-[38%] max-w-[14px] rounded-t-sm bg-brand/80"
                            style={{ height: `${hActive}%` }}
                          />
                          <div
                            className="w-[38%] max-w-[14px] rounded-t-sm bg-zinc-500/70"
                            style={{ height: `${hMsg}%` }}
                          />
                        </div>
                        <span className="text-2xs tabular-nums text-zinc-500">
                          {d.day.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-2xs text-zinc-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-brand/80" />
                    {t("stats.activeChats")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-zinc-500/70" />
                    {t("stats.messagesInOut")}
                  </span>
                  <span className="text-zinc-600">{t("stats.independentScale")}</span>
                  <button
                    type="button"
                    className="ml-auto inline-flex items-center gap-0.5 text-zinc-500 hover:text-zinc-300"
                    onClick={() => setTrendTableOpen((v) => !v)}
                  >
                    {trendTableOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {t("stats.detailTable")}
                  </button>
                </div>
                {trendTableOpen && (
                  <div className="mt-3 overflow-x-auto border-t border-zinc-800/60 pt-2">
                    <table className="w-full min-w-[18rem] text-left text-[11px]">
                      <thead>
                        <tr className="text-zinc-500">
                          <th className="py-1 pr-2 font-medium">{t("stats.date")}</th>
                          <th className="py-1 pr-2 font-medium">{t("stats.active")}</th>
                          <th className="py-1 pr-2 font-medium">{t("stats.inbound")}</th>
                          <th className="py-1 font-medium">{t("stats.outbound")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...trend7d].reverse().map((d) => (
                          <tr
                            key={d.day}
                            className="border-t border-zinc-800/50"
                          >
                            <td className="py-1.5 pr-2 text-zinc-300">
                              {d.day}
                            </td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              {d.activeChats}
                            </td>
                            <td className="py-1.5 pr-2 tabular-nums text-zinc-400">
                              {d.inbound}
                            </td>
                            <td className="py-1.5 tabular-nums text-zinc-400">
                              {d.outbound}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {scope === "all" && (
          <div className="mt-8">
            <SectionLabel>{t("stats.byAccount")}</SectionLabel>
            <div className="overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-900/30">
              {accountRows.length === 0 ? (
                <p className="p-4 text-[12px] text-zinc-500">
                  {t("stats.noAccounts")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-zinc-800/80 bg-zinc-950/50 text-2xs text-zinc-500">
                        <th className="px-3 py-2 font-medium">{t("stats.account")}</th>
                        <th className="px-2 py-2 font-medium">{t("stats.active")}</th>
                        <th className="px-2 py-2 font-medium">{t("stats.awaitingReply")}</th>
                        <th className="px-2 py-2 font-medium">{t("stats.followUpToday")}</th>
                        <th className="px-2 py-2 font-medium">{t("stats.deals")}</th>
                        <th className="px-3 py-2 font-medium">{t("stats.contacts")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountRows.map((row, i) => {
                        const hot = row.pendingReplyChats > 0;
                        return (
                          <tr
                            key={row.accountId}
                            className="cursor-pointer border-t border-zinc-800/50 hover:bg-zinc-900/60"
                            onClick={() => setScope(row.accountId)}
                            title={t("stats.switchCurrent")}
                          >
                            <td className="max-w-[10rem] truncate px-3 py-2.5 font-medium text-zinc-100">
                              {accountLabel(row.accountId, waAccounts, i + 1)}
                            </td>
                            <td className="px-2 py-2.5 tabular-nums text-zinc-300">
                              {row.chatsToday}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-2.5 tabular-nums",
                                hot
                                  ? "font-semibold text-brand"
                                  : "text-zinc-300"
                              )}
                            >
                              <div>{t("stats.chatCount", { count: row.pendingReplyChats })}</div>
                              <div className="text-2xs font-normal text-zinc-600">
                                {t("stats.unreadCount", { count: row.pendingReplies })}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 tabular-nums text-zinc-300">
                              {row.followUpsToday}
                            </td>
                            <td className="px-2 py-2.5 tabular-nums text-zinc-300">
                              {row.dealsWon}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-zinc-400">
                              {row.contacts}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-zinc-800/60 px-3 py-2 text-2xs text-zinc-600">
                {t("stats.rowHint")}
              </p>
            </div>
          </div>
        )}

        <div className="mt-8">
          <SectionLabel>
            {t("stats.stageDistribution")}
            {scope !== "all" ? t("stats.stageScope") : ""}
          </SectionLabel>
          <div className="space-y-2.5 rounded-xl border border-zinc-800/90 bg-zinc-900/30 p-4">
            {stageDistribution.map(({ id, label, count: n }) => {
              const pct = Math.round((n / funnelTotal) * 100);
              return (
                <button
                  key={id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md py-0.5 text-left text-[12px] hover:bg-zinc-900/70"
                  onClick={() => openCrmStage(id)}
                  title={`${t("stats.openCrm")} · ${label}`}
                >
                  <span className="w-14 shrink-0 text-zinc-400">{label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-brand/85 transition-all"
                      style={{ width: `${n > 0 ? Math.max(pct, 1) : 0}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums text-zinc-300">
                    {n}
                  </span>
                  <span className="w-12 text-right text-2xs tabular-nums text-zinc-600">
                    {pct}%
                  </span>
                </button>
              );
            })}
            <p className="pt-1 text-2xs text-zinc-600">
              {t("stats.stageNote")}
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
