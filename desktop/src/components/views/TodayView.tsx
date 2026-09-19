import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  Radio,
  Send,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Button, SectionLabel } from "@/components/ui/primitives";
import {
  FollowUpWorkRow,
  buildContactWorkCard,
} from "@/components/crm/FollowUpWorkRow";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { computeAllAccountsHealth, localizeAccountHealth } from "@/lib/accountHealth";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { resolveSalesStageLabel } from "@/lib/contactWorkflow";
import {
  bucketFollowUpsForToday,
  listAttentionAccounts,
  listRecentFailedOutbound,
  listUnreadChats,
  localDayKey,
  summarizeToday,
  scopeTodayBoard,
} from "@/lib/todayBoard";
import {
  cn,
  displayContactLabel,
  displayPhone,
} from "@/lib/utils";
import type { Contact, FollowUp } from "@/types/crm";
import { FollowUpsView } from "./FollowUpsView";
import { MultiWindowWorkspace } from "./MultiWindowWorkspace";
import { useI18n } from "@/i18n";

type WorkQueue = "all" | "overdue" | "today" | "unread" | "failed" | "plan";
type WorkViewMode = "list" | "grid";
const WORK_VIEW_MODE_KEY = "wap.workbenchViewMode";

export function TodayView() {
  const { t } = useI18n();
  const [workspaceMode, setWorkspaceMode] = useState<"queue" | "multi">("queue");
  const [multiFolderRequest, setMultiFolderRequest] = useState<string | null>(null);
  const [activeQueue, setActiveQueue] = useState<WorkQueue>("all");
  const [viewMode, setViewMode] = useState<WorkViewMode>(() => {
    try {
      return localStorage.getItem(WORK_VIEW_MODE_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  const allFollowUps = useAppStore((s) => s.followUps);
  const allChats = useAppStore((s) => s.chats);
  const allContacts = useAppStore((s) => s.contacts);
  const allMessages = useAppStore((s) => s.messages);
  const accountView = useAppStore((s) => s.settings.accountViewMode);
  const scopeId = accountView?.type === "account" ? accountView.accountId : undefined;
  const { contacts, chats, messages, followUps } = useMemo(
    () => scopeTodayBoard({ contacts: allContacts, chats: allChats, messages: allMessages, followUps: allFollowUps }, scopeId),
    [allContacts, allChats, allMessages, allFollowUps, scopeId]
  );
  const waAccounts = useAppStore((s) => s.settings.waAccounts || []);
  const pausedIds = useAppStore((s) => s.settings.sendPausedAccountIds || []);
  const ratePerHour = useAppStore((s) => s.settings.ratePerHour);
  const ratePerMinute = useAppStore((s) => s.settings.ratePerMinute);
  const rateMinIntervalSec = useAppStore((s) => s.settings.rateMinIntervalSec);
  const salesStageLabels = useAppStore((s) => s.settings.salesStageLabels);
  const toggleFollowUp = useAppStore((s) => s.toggleFollowUp);
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const goToChats = useAppStore((s) => s.goToChats);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setSelectedChat = useAppStore((s) => s.setSelectedChat);
  const pushToast = useAppStore((s) => s.pushToast);

  useEffect(() => {
    const openFolder = (folderId: string) => {
      try {
        localStorage.removeItem("wap.pendingMultiWindowFolder");
      } catch {
        /* localStorage is optional */
      }
      setMultiFolderRequest(folderId);
      setWorkspaceMode("multi");
    };
    const onFolderEvent = (event: Event) => {
      const folderId = (event as CustomEvent<{ folderId?: string }>).detail?.folderId;
      if (folderId) openFolder(folderId);
    };
    window.addEventListener("wap:open-multi-folder", onFolderEvent);
    try {
      const pending = localStorage.getItem("wap.pendingMultiWindowFolder");
      if (pending) {
        openFolder(pending);
      }
    } catch {
      /* localStorage is optional */
    }
    return () => window.removeEventListener("wap:open-multi-folder", onFolderEvent);
  }, []);

  const [today, setToday] = useState(localDayKey);
  const [visibleCount, setVisibleCount] = useState(30);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDayKey()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setVisibleCount(30), [activeQueue, scopeId]);
  const liveAccountId = useAppStore((s) => s.settings.liveBaileysAccountId);
  const liveConnection = useAppStore((s) => s.baileysUi.connection);
  const scopedAccounts = waAccounts.filter((a) => !scopeId || a.id === scopeId);
  const connectedCount = scopedAccounts.filter((a) => isWaAccountConnected(waAccounts, a.id, liveAccountId, liveConnection)).length;

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const lastMsgByContact = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of chats) {
      if (c.contactId && c.lastMessage) m.set(c.contactId, c.lastMessage);
    }
    return m;
  }, [chats]);

  const fu = useMemo(
    () => bucketFollowUpsForToday(followUps, today),
    [followUps, today]
  );
  const unread = useMemo(() => listUnreadChats(chats, Infinity), [chats]);
  const failed = useMemo(
    () => listRecentFailedOutbound(messages, contacts, { limit: Infinity }),
    [messages, contacts]
  );

  const attention = useMemo(() => {
    const health = computeAllAccountsHealth({
      accounts: waAccounts,
      messages,
      caps: {
        perPhonePerHour: ratePerHour,
        perPhonePerMinute: ratePerMinute,
        minIntervalSec: rateMinIntervalSec,
      },
    });
    const paused = new Set(pausedIds);
    const labelOf = (accountId: string) => {
      const a = waAccounts.find((x) => x.id === accountId);
      const idx = Math.max(
        0,
        [...waAccounts]
          .sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0))
          .findIndex((x) => x.id === accountId)
      );
      return formatAccountDisplay({
        label: a?.label,
        userName: a?.userName,
        index1: idx + 1,
      });
    };
    return listAttentionAccounts(health, { pausedIds: paused, labelOf }).filter((row) => !scopeId || row.health.accountId === scopeId);
  }, [
    waAccounts,
    scopeId,
    messages,
    pausedIds,
    ratePerHour,
    ratePerMinute,
    rateMinIntervalSec,
  ]);

  const summary = useMemo(
    () =>
      summarizeToday({
        followUps,
        chats,
        failedCount: failed.length,
        attentionAccountCount: attention.length,
        today,
      }),
    [followUps, chats, failed.length, attention.length, today]
  );

  const openFu = (f: FollowUp, opts?: { withDraft?: boolean }) => {
    const contact = contactById.get(f.contactId);
    const label = displayContactLabel(
      contact?.name || f.contactName,
      contact?.phone,
      contact?.channelAddress,
      lastMsgByContact.get(f.contactId),
      { isGroup: !!contact?.isGroup }
    );
    const latest = messages
      .filter((m) => m.contactId === f.contactId)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    openContactWorkspace(f.contactId, {
      focusMessageId: latest?.id,
      prefillDraft:
        opts?.withDraft && f.note ? `【跟进】${f.note}` : undefined,
    });
    pushToast(
      t(opts?.withDraft ? "today.openedWithNote" : "today.opened", { label }),
      "info"
    );
  };

  const renderFu = (f: FollowUp, tone: "overdue" | "today") => {
    const contact = contactById.get(f.contactId);
    const card = buildContactWorkCard(
      f,
      contact,
      lastMsgByContact.get(f.contactId),
      salesStageLabels
    );
    return (
      <FollowUpWorkRow
        key={f.id}
        followUp={f}
        card={card}
        tone={tone}
        onToggleDone={() => {
          toggleFollowUp(f.id);
          pushToast(t("today.completed", { title: card.title }), "success");
        }}
        onOpen={() => openFu(f)}
        onFollowDraft={() => openFu(f, { withDraft: true })}
      />
    );
  };

  const emptyAll =
    fu.actionable.length === 0 &&
    unread.length === 0 &&
    failed.length === 0 &&
    attention.length === 0;
  const queueCards: Array<{
    id: WorkQueue;
    label: string;
    value: number;
    tone: "bad" | "warn" | "ok";
  }> = [
    {
      id: "all",
      label: t("today.viewAll"),
      value:
        summary.overdueCount +
        summary.dueTodayCount +
        summary.unreadChatCount +
        summary.failedCount +
        summary.attentionAccountCount,
      tone: "ok",
    },
    {
      id: "overdue",
      label: t("today.overdue"),
      value: summary.overdueCount,
      tone: summary.overdueCount ? "bad" : "ok",
    },
    {
      id: "today",
      label: t("today.followUp"),
      value: summary.dueTodayCount,
      tone: summary.dueTodayCount ? "warn" : "ok",
    },
    {
      id: "unread",
      label: t("today.pendingChats"),
      value: summary.unreadChatCount,
      tone: summary.unreadChatCount ? "warn" : "ok",
    },
    {
      id: "failed",
      label: t("today.sendError"),
      value: summary.failedCount,
      tone: summary.failedCount ? "bad" : "ok",
    },
    {
      id: "plan",
      label: t("today.queue"),
      value: followUps.filter((item) => !item.done).length,
      tone: "ok",
    },
  ];
  const activeQueueCount =
    queueCards.find((item) => item.id === activeQueue)?.value || 0;
  const changeViewMode = (mode: WorkViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(WORK_VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  if (workspaceMode === "multi") {
    return (
      <MultiWindowWorkspace
        key={scopeId || "all"}
        accountScopeId={scopeId}
        folderRequestId={multiFolderRequest}
        onOpenDevices={() => setActiveNav("phones")}
        onBack={() => {
          setMultiFolderRequest(null);
          setWorkspaceMode("queue");
        }}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/90 px-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("today.title")}</div>
          <div className="text-2xs text-zinc-500">
            {today} · {scopeId ? waAccounts.find((a) => a.id === scopeId)?.label || t("today.currentAccount") : t("today.allAccounts")} · {t("today.connected")} {connectedCount}/{scopedAccounts.length}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" className="shrink-0" onClick={() => setWorkspaceMode("multi")}>
            {t("today.multiWindow")}
          </Button>
          <Button variant="ghost" className="shrink-0" onClick={() => setActiveNav("stats")}>{t("today.viewStats")}</Button>
          <div className="flex rounded-md border border-zinc-800 bg-zinc-900/50 p-0.5" aria-label={t("today.displayMode")}>
            <button
              type="button"
              onClick={() => changeViewMode("list")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2 text-2xs",
                viewMode === "list" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <List className="h-3.5 w-3.5" />
              {t("today.list")}
            </button>
            <button
              type="button"
              onClick={() => changeViewMode("grid")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2 text-2xs",
                viewMode === "grid" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("today.grid")}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <div className="grid gap-3 md:grid-cols-3" aria-label={t("today.priority")}>
            {([
              { id: "unread", label: t("today.awaitingReply"), value: unread.length, hint: t("sidebar.unreadChats"), Icon: Clock, barColor: "border-l-amber-500" },
              { id: "today", label: t("today.followUp"), value: fu.dueToday.length, hint: `${fu.overdue.length} · ${t("today.overdue")}`, Icon: CalendarCheck, barColor: "border-l-brand" },
              { id: "failed", label: t("today.sendError"), value: failed.length, hint: t("today.failedRecent"), Icon: AlertTriangle, barColor: "border-l-rose-500" },
            ] as const).map(({ id, label, value, hint, Icon, barColor }) => (
              <button key={id} type="button" onClick={() => setActiveQueue(id)}
                aria-pressed={activeQueue === id}
                className={cn("today-kpi-card relative rounded-xl border border-l-4 p-4 text-left transition-all shadow-2xs hover:shadow-xs",
                  barColor,
                  activeQueue === id ? "border-brand/60 bg-brand/10" : "border-zinc-800 bg-zinc-900/30")}>
                <div className="flex min-w-0 items-start justify-between gap-2 text-[13px] font-medium text-zinc-200">
                  {label}<Icon className={cn("h-4 w-4", id === "failed" && value ? "text-rose-400" : "text-brand")} />
                </div>
                <div className="my-2 text-3xl font-semibold tabular-nums text-zinc-100">{value}</div>
                <div className="break-words text-[11px] text-zinc-500">{hint}</div>
              </button>
            ))}
          </div>
          <div
            className="sticky top-0 z-20 -mx-1 grid grid-cols-2 gap-1.5 bg-zinc-950/95 px-1 py-2 backdrop-blur sm:grid-cols-3 xl:grid-cols-6"
            role="tablist"
            aria-label={t("today.queue")}
          >
            {queueCards.map((c) => (
              <button
                key={c.label}
                type="button"
                role="tab"
                aria-selected={activeQueue === c.id}
                onClick={() => setActiveQueue(c.id)}
                className={cn(
                  "flex min-h-10 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors enabled:hover:border-zinc-600 enabled:hover:bg-zinc-900/70 disabled:cursor-default",
                  activeQueue === c.id && "ring-1 ring-brand/70",
                  c.tone === "bad"
                    ? "border-rose-500/30 bg-rose-500/5"
                    : c.tone === "warn"
                      ? "border-amber-500/25 bg-amber-500/5"
                      : "border-zinc-800 bg-zinc-900/40"
                )}
              >
                <div className="truncate text-[11px] text-zinc-400">{c.label}</div>
                <div className="shrink-0 text-[13px] font-semibold tabular-nums text-zinc-100">
                  {c.value}
                </div>
              </button>
            ))}
          </div>

          {emptyAll && activeQueue !== "plan" ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-6 py-16 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500/80" />
              <div className="text-[14px] font-medium text-zinc-200">
                {t("today.emptyTitle")}
              </div>
              <div className="max-w-sm text-[12px] text-zinc-500">
                {t("today.emptyDescription")}
              </div>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => goToChats("all")}
              >
                {t("today.openChats")}
              </Button>
            </div>
          ) : null}

          {!emptyAll && activeQueue !== "all" && activeQueue !== "plan" && activeQueueCount === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
              <div className="text-[13px] font-medium text-zinc-300">{t("today.queueEmpty")}</div>
              <Button
                variant="ghost"
                className="mt-2 !min-h-8 text-2xs"
                onClick={() => setActiveQueue("all")}
              >
                {t("today.viewAll")}
              </Button>
            </div>
          ) : null}

          {(activeQueue === "all" || activeQueue === "overdue") && fu.overdue.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5 text-rose-300/90">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("today.overdue")} · {fu.overdue.length}
                </span>
              </SectionLabel>
              <div className={viewMode === "grid" ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
                {fu.overdue.slice(0, visibleCount).map((f) => renderFu(f, "overdue"))}
              </div>
            </section>
          ) : null}

          {(activeQueue === "all" || activeQueue === "today") && fu.dueToday.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarCheck className="h-3.5 w-3.5" />
                  {t("today.followUp")} · {fu.dueToday.length}
                </span>
              </SectionLabel>
              <div className={viewMode === "grid" ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
                {fu.dueToday.slice(0, visibleCount).map((f) => renderFu(f, "today"))}
              </div>
            </section>
          ) : null}

          {(activeQueue === "all" || activeQueue === "unread") && unread.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {t("today.pendingChats")} · {summary.unreadChatCount}
                </span>
              </SectionLabel>
              <div className={cn(
                viewMode === "grid"
                  ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3"
                  : "overflow-hidden rounded-lg border border-zinc-800/90"
              )}>
                {unread.slice(0, visibleCount).map((c) => {
                  const contact = contactById.get(c.contactId);
                  const title = displayContactLabel(
                    contact?.name || c.contactName,
                    contact?.phone,
                    contact?.channelAddress,
                    c.lastMessage,
                    { isGroup: !!(contact?.isGroup || c.isGroup) }
                  );
                  const phone = displayPhone(contact?.phone);
                  const meta = [
                    phone && phone !== title ? phone : "",
                    contact?.company?.trim() || "",
                    contact?.stage
                      ? resolveSalesStageLabel(contact.stage, salesStageLabels)
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-900/80",
                        viewMode === "grid"
                          ? "rounded-lg border border-zinc-800/90 bg-zinc-900/30"
                          : "border-b border-zinc-800/80 last:border-0"
                      )}
                      onClick={() => {
                        setSelectedChat(c.id);
                        goToChats("all");
                      }}
                    >
                      <Avatar
                        name={title}
                        seed={contact?.phone || c.contactId || title}
                        src={contact?.avatarUrl}
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium">
                            {title}
                          </span>
                          {contact?.stage ? (
                            <Badge className="!text-2xs">
                              {resolveSalesStageLabel(contact.stage, salesStageLabels)}
                            </Badge>
                          ) : null}
                        </div>
                        {meta ? (
                          <div className="truncate text-[11px] text-zinc-600">
                            {meta}
                          </div>
                        ) : null}
                        <div className="truncate text-[12px] text-zinc-500">
                          {c.lastMessage || t("today.unreadFallback")}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-brand/20 px-2 py-0.5 text-2xs font-semibold tabular-nums text-brand">
                        {c.unread}
                      </span>
                    </button>
                  );
                })}
              </div>
              {summary.unreadChatCount > unread.length ? (
                <button
                  type="button"
                  className="text-left text-[12px] text-zinc-500 hover:text-brand"
                  onClick={() => goToChats("unread")}
                >
                  {t("today.viewAllUnread")}
                </button>
              ) : null}
            </section>
          ) : null}

          {(activeQueue === "all" || activeQueue === "failed") && failed.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5 text-rose-300/90">
                  <Send className="h-3.5 w-3.5" />
                  {t("today.failedHeading")} · {failed.length}
                </span>
              </SectionLabel>
              <div className={cn(
                viewMode === "grid"
                  ? "grid gap-2 md:grid-cols-2 xl:grid-cols-3"
                  : "overflow-hidden rounded-lg border border-rose-500/20"
              )}>
                {failed.slice(0, visibleCount).map(({ message: m, contactName: fallbackName }) => {
                  const contact = m.contactId
                    ? contactById.get(m.contactId)
                    : undefined;
                  const title = displayContactLabel(
                    contact?.name || fallbackName,
                    contact?.phone,
                    contact?.channelAddress,
                    m.body,
                    { isGroup: !!contact?.isGroup }
                  );
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-900/80",
                        viewMode === "grid"
                          ? "rounded-lg border border-rose-500/20 bg-rose-500/5"
                          : "border-b border-zinc-800/80 last:border-0"
                      )}
                      onClick={() => {
                        if (!m.contactId) return;
                        openContactWorkspace(m.contactId, {
                          focusMessageId: m.id,
                        });
                      }}
                    >
                      <Avatar
                        name={title}
                        seed={contact?.phone || m.contactId || title}
                        src={contact?.avatarUrl}
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium">
                            {title}
                          </span>
                          <span className="shrink-0 text-2xs tabular-nums text-zinc-600">
                            {(m.sentAt || "").slice(0, 16).replace("T", " ")}
                          </span>
                        </div>
                        <div className="truncate text-[12px] text-zinc-500">
                          {m.lastError ||
                            m.body ||
                            m.mediaType ||
                            t("today.retrySend")}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeQueue === "all" && attention.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  <Radio className="h-3.5 w-3.5" />
                  {t("today.attentionHeading")} · {attention.length}
                </span>
              </SectionLabel>
              <div className="flex flex-col gap-2">
                {attention.map((row) => (
                  <button
                    key={row.health.accountId}
                    type="button"
                    onClick={() => setActiveNav("monitor")}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left",
                      row.health.level === "red" || row.paused
                        ? "border-rose-500/25 bg-rose-500/5"
                        : "border-amber-500/25 bg-amber-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{row.label}</span>
                      <span className="text-2xs text-zinc-500">
                        {row.paused
                          ? t("today.pausedSending")
                          : row.health.level === "red"
                            ? t("today.overheated")
                            : t("today.slowDown")}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-zinc-500">
                      {localizeAccountHealth(row.health, t).summary}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {((activeQueue === "all" && Math.max(fu.overdue.length, fu.dueToday.length, unread.length, failed.length) > visibleCount) ||
            (activeQueue !== "all" && activeQueue !== "plan" && activeQueueCount > visibleCount)) ? (
            <Button variant="secondary" onClick={() => setVisibleCount((count) => count + 30)}>
              {t("today.showMore")}
            </Button>
          ) : null}

          {activeQueue === "plan" ? (
            <FollowUpsView viewMode={viewMode} scopedFollowUps={followUps} />
          ) : null}

        </div>
      </div>
    </div>
  );
}
