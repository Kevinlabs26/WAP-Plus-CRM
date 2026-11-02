import { Clock3, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import type { ScheduledMessage, ScheduledMessageStatus } from "@/types/crm";
import { useI18n, type TranslationKey } from "@/i18n";
import { ChatScheduledMessageDialog } from "@/components/chat/ChatScheduledMessageDialog";
import { ScheduledPlansPanel } from "./ScheduledPlansPanel";
import { ScheduledPlanDialog } from "@/components/chat/ScheduledPlanDialog";
import { scheduledPlanMatchesFilter, type ScheduledPlanFilter } from "@/lib/scheduledPlans";

const FILTERS = ["active", "failed", "history", "all"] as const;

const STATUS_LABEL: Record<ScheduledMessageStatus, TranslationKey> = {
  expired: "scheduled.needsConfirmation",
  pending: "settingsScheduled.status.pending",
  queued: "settingsScheduled.status.queued",
  sent: "settingsScheduled.status.sent",
  failed: "settingsScheduled.status.failed",
  cancelled: "settingsScheduled.status.cancelled",
};

function formatDueAt(value: string, locale: string, invalid: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return invalid;
  return new Date(time).toLocaleString(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status: ScheduledMessageStatus): string {
  if (status === "pending") return "border-brand/30 bg-brand/10 text-brand";
  if (status === "queued") return "border-sky-500/25 bg-sky-500/10 text-sky-300";
  if (status === "expired") return "border-amber-500/25 bg-amber-500/10 text-amber-500";
  if (status === "failed") return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  if (status === "sent") return "border-zinc-700 bg-zinc-800/70 text-zinc-400";
  return "border-zinc-800 bg-zinc-900 text-zinc-600";
}

function matchesFilter(task: ScheduledMessage, filter: ScheduledPlanFilter): boolean {
  if (filter === "active") return task.status === "pending" || task.status === "queued";
  if (filter === "failed") return task.status === "failed" || task.status === "expired";
  if (filter === "history") return task.status === "sent" || task.status === "cancelled";
  return true;
}

export function SettingsScheduledMessagesPanel() {
  const { t } = useI18n();
  const tasks = useAppStore(state => state.settings.scheduledMessages || []);
  const plans = useAppStore(state => state.settings.scheduledPlans || []);
  const [filter, setFilter] = useState<ScheduledPlanFilter>("active");
  const [creating, setCreating] = useState(false);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(value => [value,
    plans.filter(plan => scheduledPlanMatchesFilter(plan, value)).length + tasks.filter(task => matchesFilter(task, value)).length,
  ])), [plans, tasks]);

  return <div className="mx-auto max-w-5xl space-y-4">
    {creating && <ScheduledPlanDialog onClose={() => setCreating(false)} />}
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-zinc-100">{t("settingsScheduled.title")}</h3>
      <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={() => { setFilter("active"); setCreating(true); }}>{t("planQueue.create")}</Button>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map(value => <Button key={value} size="sm" variant={filter === value ? "primary" : "ghost"}
          aria-label={t(`settingsScheduled.filter.${value}`)} aria-pressed={filter === value} onClick={() => setFilter(value)}>
          {t(`settingsScheduled.filter.${value}`)} <span className="ml-1 tabular-nums">{counts[value]}</span>
        </Button>)}
      </div>
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer">{t("planQueue.notes")}</summary>
        <p className="mt-2 max-w-xl leading-relaxed">{t("planQueue.rules")}</p>
      </details>
    </div>
    <ScheduledPlansPanel filter={filter} onFilterChange={setFilter} />
    <LegacyScheduledMessagesPanel filter={filter} onFilterChange={setFilter} />
    {counts[filter] === 0 && <div className="rounded-xl border border-dashed border-zinc-700 px-5 py-10 text-center text-sm text-zinc-500">
      <p>{t(filter === "active" ? "settingsScheduled.emptyActive" : "settingsScheduled.empty")}</p>
      <p className="mt-2 text-xs">{t("planQueue.entryHint")}</p>
    </div>}
  </div>;
}

function LegacyScheduledMessagesPanel({ filter, onFilterChange: setFilter }: { filter: ScheduledPlanFilter; onFilterChange: (filter: ScheduledPlanFilter) => void }) {
  const { locale, t } = useI18n();
  const tasks = useAppStore((state) => state.settings.scheduledMessages || []);
  const chats = useAppStore((state) => state.chats);
  const setOpen = useAppStore((state) => state.setSettingsOpen);
  const setActiveNav = useAppStore((state) => state.setActiveNav);
  const setSelectedChat = useAppStore((state) => state.setSelectedChat);
  const cancel = useAppStore((state) => state.cancelScheduledMessage);
  const remove = useAppStore((state) => state.removeScheduledMessage);
  const requestConfirm = useAppStore((state) => state.requestConfirm);
  const pushToast = useAppStore((state) => state.pushToast);
  const [rescheduling, setRescheduling] = useState<ScheduledMessage | null>(null);

  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => matchesFilter(task, filter))
        .sort((a, b) => {
          const aTime = Date.parse(a.dueAt);
          const bTime = Date.parse(b.dueAt);
          return filter === "active" ? aTime - bTime : bTime - aTime;
        }),
    [filter, tasks]
  );

  const openChat = (task: ScheduledMessage) => {
    if (!chats.some((chat) => chat.id === task.chatId)) {
      pushToast(t("settingsScheduled.chatMissing"), "error");
      return;
    }
    setOpen(false);
    setSelectedChat(task.chatId, task.accountId);
    setActiveNav("chats");
  };

  const cancelTask = async (task: ScheduledMessage) => {
    const ok = await requestConfirm({
      title: t("settingsScheduled.cancelTitle"),
      description: t("settingsScheduled.cancelDescription", { name: task.contactName }),
      confirmLabel: t("settingsScheduled.cancelSend"),
      cancelLabel: t("common.keep"),
      tone: "danger",
    });
    if (ok && cancel(task.id)) pushToast(t("settingsScheduled.cancelled"), "success");
  };

  const deleteTask = async (task: ScheduledMessage) => {
    const ok = await requestConfirm({
      title: t("settingsScheduled.deleteTitle"),
      description: t("settingsScheduled.deleteDescription"),
      confirmLabel: t("settingsScheduled.deleteRecord"),
      cancelLabel: t("common.keep"),
      tone: "danger",
    });
    if (ok && remove(task.id)) pushToast(t("settingsScheduled.deleted"), "success");
  };

  if (!visibleTasks.length && !rescheduling) return null;
  return (
    <div className="space-y-2">
      {rescheduling && <ChatScheduledMessageDialog contactName={rescheduling.contactName} initialText={rescheduling.text}
        onClose={() => setRescheduling(null)} onSubmit={(dueAt, text) => {
          if (useAppStore.getState().updateScheduledMessage(rescheduling.id, { dueAt, text })) {
            setRescheduling(null); setFilter("active"); pushToast(t("scheduled.replanned"), "success");
          } else pushToast(t("scheduled.replanFailed"), "error");
        }} />}
      {visibleTasks.map((task) => (
        <article
          key={task.id}
          className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3"
        >
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="truncate text-left text-[12px] font-medium text-zinc-200 hover:text-brand" aria-label={t("settingsScheduled.openChat")} title={t("settingsScheduled.openChat")} onClick={() => openChat(task)}>
                  {task.contactName || task.recipient}
                </button>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass(task.status)}`}>
                  {t(STATUS_LABEL[task.status])}
                </span>
              </div>
              <div className="mt-1 text-2xs text-zinc-500">
                {task.status === "pending" ? t("settingsScheduled.scheduled") : t("settingsScheduled.originallyScheduled")}: {formatDueAt(task.dueAt, locale, t("settingsScheduled.invalidTime"))}
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-zinc-300">
                {task.text}
              </p>
              {task.error && (
                <p className="mt-1 line-clamp-2 text-2xs text-rose-300" title={task.error}>{task.error}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(task.status === "pending" || task.status === "queued") && <Button type="button" size="xs" variant="ghost" onClick={() => void cancelTask(task)}><XCircle className="mr-1 h-3 w-3" />{t("common.cancel")}</Button>}
              {task.status === "expired" && <Button size="xs" onClick={() => setRescheduling(task)}>{t("scheduled.replan")}</Button>}
              {task.status !== "pending" && task.status !== "queued" && <details className="relative text-xs text-zinc-500" onClick={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false; }}>
                <summary className="cursor-pointer list-none rounded p-1.5 hover:bg-zinc-800" aria-label={t("nav.more")}>•••</summary>
                <div className="absolute right-0 top-full z-10 mt-1 min-w-max rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"><Button type="button" size="xs" variant="ghost" className="text-rose-300 hover:text-rose-200" onClick={() => void deleteTask(task)}><Trash2 className="mr-1 h-3 w-3" />{t("settingsScheduled.deleteRecord")}</Button></div>
              </details>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
