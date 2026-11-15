import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { addLibraryImage } from "@/lib/imageLibrary";
import { dismissImageGenerationTask, imageGenerationTasksSnapshot, subscribeImageGenerationTasks, updateImageGenerationTask, type ImageGenerationTask } from "@/lib/imageGenerationTasks";
import { emitQuickReplyMedia, quickReplyMediaToFile } from "@/lib/quickReplyMedia";
import { useAppStore } from "@/store/appStore";

function taskTitle(prompt: string) {
  return `AI · ${prompt.trim().slice(0, 54)}`;
}

function taskMedia(task: ImageGenerationTask) {
  const result = task.result;
  if (!result) return null;
  const extension = result.mimeType.split("/")[1] === "jpeg" ? "jpg" : result.mimeType.split("/")[1];
  return {
    dataUrl: `data:${result.mimeType};base64,${result.data}`,
    fileName: `${taskTitle(task.prompt)}.${extension}`,
    mimeType: result.mimeType,
    kind: result.mimeType.startsWith("video/") ? "video" as const : "image" as const,
  };
}

export function ImageGenerationTaskHost() {
  const { t } = useI18n();
  const tasks = useSyncExternalStore(subscribeImageGenerationTasks, imageGenerationTasksSnapshot, imageGenerationTasksSnapshot);
  const selectedChatId = useAppStore(state => state.selectedChatId);
  const chats = useAppStore(state => state.chats);
  const pushToast = useAppStore(state => state.pushToast);
  const [expanded, setExpanded] = useState(false);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    for (const task of tasks) {
      if ((task.status !== "complete" && task.status !== "failed") || notified.current.has(task.id)) continue;
      notified.current.add(task.id);
      const failed = task.status === "failed";
      pushToast(
        failed ? task.error || t("gallery.taskFailed") : t("gallery.taskReadyMessage"),
        failed ? "error" : "success",
        { title: t(failed ? "gallery.taskFailedTitle" : "gallery.taskReadyTitle"), onClick: () => setExpanded(true), dedupeKey: `image-generation-${task.id}` },
      );
    }
  }, [pushToast, t, tasks]);

  if (!tasks.length) return null;
  const activeCount = tasks.filter(task => task.status === "queued" || task.status === "running").length;
  const readyCount = tasks.filter(task => task.status === "complete" || task.status === "failed").length;

  const save = async (taskId: string) => {
    const task = tasks.find(item => item.id === taskId);
    const media = task && taskMedia(task);
    if (!task?.result || !media || media.kind !== "image") return;
    const file = quickReplyMediaToFile({ ...media, token: task.id });
    if (!file) {
      pushToast(t("gallery.invalidGenerated"), "error");
      return;
    }
    try {
      await addLibraryImage(file, task.category, taskTitle(task.prompt));
      window.dispatchEvent(new Event("wap:image-library"));
      updateImageGenerationTask(task.id, { saved: true });
      pushToast(t("gallery.taskSaved"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const insert = (taskId: string) => {
    const task = tasks.find(item => item.id === taskId);
    const media = task && taskMedia(task);
    if (!task?.targetChatId || !media || selectedChatId !== task.targetChatId) return;
    if (!emitQuickReplyMedia({ ...media, token: task.id, target: "main", chatId: task.targetChatId })) {
      pushToast(t("quickShelf.insertUnavailable"), "info");
      return;
    }
    updateImageGenerationTask(task.id, { inserted: true });
    pushToast(t("gallery.taskInserted"), "success");
  };

  const returnToChat = (chatId: string, accountId: string | null) => {
    const state = useAppStore.getState();
    state.setSelectedChat(chatId, accountId || undefined);
    state.goToChats("all");
  };

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[180] flex flex-col items-end gap-2">
      {expanded && <section aria-label={t("gallery.taskTray")} className="pointer-events-auto flex max-h-[75vh] w-[min(30rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/98 text-zinc-100 shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
          <span className="min-w-0 flex-1 text-sm font-semibold">{t("gallery.taskTray")}</span>
          <span className="text-xs text-zinc-500">{t("gallery.taskCounts", { active: activeCount, ready: readyCount })}</span>
          <button type="button" className="rounded p-1 text-zinc-400 hover:bg-zinc-800" aria-label={t("common.close")} onClick={() => setExpanded(false)}><ChevronDown className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 space-y-2 overflow-y-auto p-2">
          {tasks.map(task => {
            const media = taskMedia(task);
            const targetExists = Boolean(task.targetChatId && chats.some(chat => chat.id === task.targetChatId));
            const onTargetChat = Boolean(task.targetChatId && selectedChatId === task.targetChatId);
            const status = task.status === "queued" ? t("gallery.taskQueued")
              : task.status === "failed" ? t("gallery.taskFailed")
                : task.status === "complete" ? t("gallery.taskCompleted")
                  : t(task.phase === "waiting" ? "gallery.taskWaiting" : "gallery.taskRunning");
            return <article key={task.id} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <div className="flex items-start gap-2">
                {task.status === "running" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" /> : task.status === "complete" ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${task.status === "failed" ? "bg-rose-400" : "bg-amber-400"}`} />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-200">{status}</p>
                  <p className="mt-1 line-clamp-2 break-words text-xs text-zinc-400">{task.prompt || t("gallery.museMediaTitle")}</p>
                </div>
                {(task.status === "complete" || task.status === "failed") && <button type="button" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label={t("gallery.taskDismiss")} title={t("gallery.taskDismiss")} onClick={() => dismissImageGenerationTask(task.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
              {task.error && <p role="alert" className="break-words text-xs text-rose-300">{task.error}</p>}
              {media && (media.kind === "video"
                ? <video className="max-h-[32vh] w-full rounded-lg bg-black object-contain" src={media.dataUrl} controls playsInline />
                : <img className="max-h-[32vh] w-full rounded-lg bg-black object-contain" src={media.dataUrl} alt={t("gallery.generatedPreview")} />)}
              {media && <>
                {task.targetChatName && <p className="truncate text-2xs text-zinc-500">{t("gallery.taskTarget", { name: task.targetChatName })}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {media.kind === "image" && <button type="button" className="ui-btn-secondary text-xs" disabled={task.saved} onClick={() => void save(task.id)}>{task.saved ? t("gallery.taskSaved") : t("gallery.saveGenerated")}</button>}
                  {task.targetChatId && <button type="button" className="ui-btn-secondary text-xs" disabled={!targetExists || onTargetChat || task.inserted} onClick={() => returnToChat(task.targetChatId!, task.targetAccountId)}>{onTargetChat ? t("gallery.taskTargetReady") : t("gallery.taskOpenChat")}</button>}
                  {task.targetChatId && <button type="button" className="ui-btn-primary text-xs" disabled={!onTargetChat || task.inserted} onClick={() => insert(task.id)}>{task.inserted ? t("gallery.taskInserted") : t("gallery.insertGenerated")}</button>}
                </div>
              </>}
            </article>;
          })}
        </div>
      </section>}
      <button type="button" className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs text-zinc-100 shadow-xl hover:border-brand/50" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {activeCount > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> : <Check className="h-3.5 w-3.5 text-emerald-400" />}
        {t("gallery.taskCounts", { active: activeCount, ready: readyCount })}
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
