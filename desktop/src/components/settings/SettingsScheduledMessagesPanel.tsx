import { Clock3, ExternalLink, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, EmptyState, SectionLabel } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import type { ScheduledMessage, ScheduledMessageStatus } from "@/types/crm";
import { useI18n, type TranslationKey } from "@/i18n";

type Filter = "all" | "active" | "failed" | "history";

const STATUS_LABEL: Record<ScheduledMessageStatus, TranslationKey> = {
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
  if (status === "failed") return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  if (status === "sent") return "border-zinc-700 bg-zinc-800/70 text-zinc-400";
  return "border-zinc-800 bg-zinc-900 text-zinc-600";
}

function matchesFilter(task: ScheduledMessage, filter: Filter): boolean {
  if (filter === "active") return task.status === "pending" || task.status === "queued";
  if (filter === "failed") return task.status === "failed";
  if (filter === "history") return task.status === "sent" || task.status === "cancelled";
  return true;
}

export function SettingsScheduledMessagesPanel() {
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
  const [filter, setFilter] = useState<Filter>("active");

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

  const counts = useMemo(
    () => ({
      active: tasks.filter((task) => task.status === "pending" || task.status === "queued").length,
      failed: tasks.filter((task) => task.status === "failed").length,
    }),
    [tasks]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsScheduled.title")}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {t("settingsScheduled.description")}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel
          action={
            <span className="text-2xs text-zinc-600">
              {t("settingsScheduled.counts", { active: counts.active, failed: counts.failed })}
            </span>
          }
        >
          {t("settingsScheduled.plan")}
        </SectionLabel>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {([
            ["active", t("settingsScheduled.filter.active")],
            ["failed", t("settingsScheduled.filter.failed")],
            ["history", t("settingsScheduled.filter.history")],
            ["all", t("settingsScheduled.filter.all")],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={
                filter === id
                  ? "rounded-md bg-zinc-700 px-2.5 py-1 text-2xs text-zinc-100"
                  : "rounded-md px-2.5 py-1 text-2xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {visibleTasks.length === 0 ? (
          <EmptyState
            title={filter === "active" ? t("settingsScheduled.emptyActive") : t("settingsScheduled.empty")}
            description={t("settingsScheduled.emptyHint")}
          />
        ) : (
          <div className="space-y-2">
            {visibleTasks.map((task) => (
              <article
                key={task.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3"
              >
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[12px] font-medium text-zinc-200">
                        {task.contactName || task.recipient}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass(task.status)}`}>
                        {t(STATUS_LABEL[task.status])}
                      </span>
                    </div>
                    <div className="mt-1 text-2xs text-zinc-500">
                      {task.status === "pending" ? t("settingsScheduled.scheduled") : t("settingsScheduled.originallyScheduled")}: {formatDueAt(task.dueAt, locale, t("settingsScheduled.invalidTime"))}
                    </div>
                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-zinc-300">
                      {task.text}
                    </p>
                    {task.error && (
                      <p className="mt-1 line-clamp-2 text-2xs text-rose-300">{task.error}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button type="button" size="xs" variant="ghost" onClick={() => openChat(task)}>
                    <ExternalLink className="mr-1 h-3 w-3" />{t("settingsScheduled.openChat")}
                  </Button>
                  {(task.status === "pending" || task.status === "queued") && (
                    <Button type="button" size="xs" variant="ghost" onClick={() => void cancelTask(task)}>
                      <XCircle className="mr-1 h-3 w-3" />{t("common.cancel")}
                    </Button>
                  )}
                  {task.status !== "pending" && task.status !== "queued" && (
                    <Button type="button" size="xs" variant="ghost" className="text-rose-300 hover:text-rose-200" onClick={() => void deleteTask(task)}>
                      <Trash2 className="mr-1 h-3 w-3" />{t("settingsScheduled.deleteRecord")}
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
