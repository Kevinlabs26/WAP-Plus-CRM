import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { resolveAutoReplyScope } from "@/lib/autoReplyScope";
import { multiWindowReplyStatus } from "../lib/replyStatus";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { MultiWindowConnectionBadge } from "./MultiWindowConnectionBadge";
import { useAutoReplyRuntime } from "@/lib/autoReplyRuntime";

export function MultiWindowReplyControls({ chat, contact, messages, accountId, connected, onOpenDevices, workStatus, children }: {
  chat: ChatPreview; contact?: Contact; messages: Message[]; accountId: string; connected: boolean;
  onOpenDevices?: () => void;
  workStatus?: "pending" | "waiting" | "done" | "idle";
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const runtime = useAutoReplyRuntime(state => state.byChat[chat.id]);
  const bridgeConnected = useAppStore(state => state.bridge.connected);
  const [, refresh] = useState(0);
  useEffect(() => {
    // Refresh time-based status even when the conversation is idle.
    const timer = window.setInterval(() => refresh(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const android = settings.sendChannel === "android_bridge";
  const channelConnected = android ? bridgeConnected : connected;
  const { status, scope } = multiWindowReplyStatus(settings, chat, contact, messages, accountId, channelConnected, Date.now(), runtime);
  const label = t(`multi.replyStatus.${status}`);
  const source = scope.source === "folder" ? t("autoReplyScope.folderSource", { name: scope.folderName || "" }) : t(`autoReplyScope.source.${scope.source}`);
  const isGroup = !!(chat.isGroup || contact?.isGroup);
  const forcedManual = !!(chat.localOnly || isGroup && settings.sendChannel !== "baileys");
  const mode = scope.source === "paused" || forcedManual ? "manual" : scope.mode;
  const canSwitchMode = scope.source !== "paused" && !forcedManual;
  const description = t("multi.replyStateDetails", { mode: t(mode === "auto" ? "autoReplyScope.auto" : "autoReplyScope.manual"), source, status: label });
  const restriction = isGroup ? t(settings.sendChannel === "baileys" ? "autoReplyScope.groupJudges" : "autoReplyScope.groupNeedsBaileys") : chat.localOnly ? t("multi.localManual") : "";
  const details = restriction ? `${description} · ${restriction}` : description;
  const progress = runtime?.inboundId === messages.filter(message => message.direction === "in").at(-1)?.id && (!runtime?.accountId || runtime.accountId === accountId) ? runtime : undefined;
  const stateDetails = [workStatus ? `${details} · ${t(`multi.workStatus.${workStatus}`)}` : details,
    progress?.reason, progress?.retryAt ? t("autoReplyRuntime.retryAt", { time: new Date(progress.retryAt).toLocaleTimeString() }) : ""].filter(Boolean).join(" · ");
  const stateText = (status === "auto" || status === "manual") && workStatus ? t(`multi.workStatus.${workStatus}`) : label;
  const setMode = (nextMode: "auto" | "manual") => {
    const state = useAppStore.getState();
    if (resolveAutoReplyScope(state.settings, chat.id, isGroup).source === "paused") return;
    const modes = { ...state.settings.aiAutoReplyModeByChatId, [chat.id]: nextMode };
    state.updateSettings({
      aiAutoReplyModeByChatId: modes,
      aiAutoReplyManualChatIds: (state.settings.aiAutoReplyManualChatIds || []).filter(id => id !== chat.id),
    });
  };
  return <div className="flex shrink-0 items-center gap-1.5">
    <MultiWindowConnectionBadge channel={settings.sendChannel} connected={channelConnected} onOpenDevices={onOpenDevices} />
    <div role="group" aria-label={t("aiFolder.reply")} title={stateDetails} className="flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-800 p-0.5">
      {(["manual", "auto"] as const).map(value => <button key={value} type="button" disabled={!canSwitchMode} aria-pressed={mode === value}
        aria-label={t(value === "auto" ? "multi.replyMode.auto" : "multi.replyMode.manual")}
        onClick={() => setMode(value)}
        className={cn("rounded-full px-1.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40", mode === value ? "bg-brand/15 font-medium text-brand" : "text-zinc-500 hover:text-zinc-200")}>
        {t(value === "auto" ? "multi.replyMode.auto" : "multi.replyMode.manual")}
      </button>)}
    </div>
    <span role="status" title={stateDetails} aria-label={stateDetails}
      className={cn("max-w-24 truncate text-[10px]", ["auto", "waiting", "transcribing", "generating"].includes(status) ? "text-brand" : status === "manual" || status === "paused" ? "text-zinc-500" : "text-amber-600")}>
      {stateText}
    </span>
    {children}
  </div>;
}
