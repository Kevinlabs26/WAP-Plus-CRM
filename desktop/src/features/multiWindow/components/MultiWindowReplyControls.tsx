import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { multiWindowReplyStatus } from "../lib/replyStatus";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { MultiWindowConnectionBadge } from "./MultiWindowConnectionBadge";
import { useAutoReplyRuntime } from "@/lib/autoReplyRuntime";

export function MultiWindowReplyControls({ chat, contact, messages, accountId, connected, accountOptions, onSelectAccount, accountCount, onOpenDevices, workStatus, children }: {
  chat: ChatPreview; contact?: Contact; messages: Message[]; accountId: string; connected: boolean;
  accountOptions?: { id: string; label: string }[]; onSelectAccount?: (chatId: string) => void;
  accountCount?: number; onOpenDevices?: () => void;
  workStatus?: "pending" | "waiting" | "done" | "idle";
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const runtime = useAutoReplyRuntime(state => state.byChat[chat.id]);
  const phones = useAppStore(state => state.phones);
  const bridgeConnected = useAppStore(state => state.bridge.connected);
  const [, refresh] = useState(0);
  useEffect(() => {
    // Refresh time-based status even when the conversation is idle.
    const timer = window.setInterval(() => refresh(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const android = settings.sendChannel === "android_bridge";
  const account = settings.waAccounts.find(item => item.id === accountId);
  const phoneId = chat.phoneId || contact?.boundPhoneId;
  const sender = android ? phones.find(item => item.id === phoneId)?.name || phoneId || t("multi.phoneBridge")
    : account?.label || account?.userName || account?.phoneE164 || accountId;
  const senderTitle = !android && account?.phoneE164 && account.phoneE164 !== sender ? `${sender} · ${account.phoneE164}` : sender;
  const channelConnected = android ? bridgeConnected : connected;
  const count = accountCount || accountOptions?.length || 1;
  const accountDetails = `${senderTitle}${count > 1 ? ` · ${t("multi.accountCount", { count })}` : ""} · ${t(channelConnected ? "multi.connected" : android ? "multi.bridgeOffline" : "multi.accountOffline")}`;
  const { status, scope } = multiWindowReplyStatus(settings, chat, contact, messages, accountId, channelConnected, Date.now(), runtime);
  const label = t(`multi.replyStatus.${status}`);
  const source = scope.source === "folder" ? t("autoReplyScope.folderSource", { name: scope.folderName || "" }) : t(`autoReplyScope.source.${scope.source}`);
  const description = t("multi.replyStateDetails", { mode: t(scope.mode === "auto" ? "autoReplyScope.auto" : "autoReplyScope.manual"), source, status: label });
  const restriction = chat.isGroup || contact?.isGroup ? t("autoReplyScope.privateOnly") : chat.localOnly ? t("multi.localManual") : "";
  const details = restriction ? `${description} · ${restriction}` : description;
  const mode = status === "manual" ? t("multi.replyMode.manual") : status === "auto" ? t("multi.replyMode.auto")
    : scope.mode === "auto" && ["offline", "ai", "hours", "unavailable"].includes(status) ? `${t("multi.replyMode.auto")} ${label}` : label;
  const stateText = workStatus ? `${mode} · ${t(`multi.workStatus.${workStatus}`)}` : mode;
  const progress = runtime?.inboundId === messages.filter(message => message.direction === "in").at(-1)?.id && (!runtime?.accountId || runtime.accountId === accountId) ? runtime : undefined;
  const stateDetails = [workStatus ? `${details} · ${t(`multi.workStatus.${workStatus}`)}` : details,
    progress?.reason, progress?.retryAt ? t("autoReplyRuntime.retryAt", { time: new Date(progress.retryAt).toLocaleTimeString() }) : ""].filter(Boolean).join(" · ");
  return <div className="flex w-full min-w-0 items-center gap-1.5">
    <div className="flex h-7 w-32 min-w-0 max-w-[40%] items-center rounded-md border border-zinc-800 bg-zinc-950/60" title={accountDetails}>
    <MultiWindowConnectionBadge channel={settings.sendChannel} connected={channelConnected} onOpenDevices={onOpenDevices} />
    {accountOptions && accountOptions.length > 1 && onSelectAccount ?
      <select value={chat.id} onChange={event => onSelectAccount(event.target.value)} title={accountDetails} className="h-6 min-w-0 flex-1 truncate rounded-md border-0 bg-transparent px-1.5 text-[11px] text-zinc-300" aria-label={t("multi.selectReplyAccount")}>
        {accountOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select> :
      <span className="min-w-0 truncate px-1.5 py-1 text-[11px] font-medium text-zinc-300" title={accountDetails} aria-label={`${t(android ? "multi.replyDevice" : "multi.selectReplyAccount")}：${sender}`}>{sender}</span>}
    </div>
    <span role="status" title={stateDetails} aria-label={stateDetails} className={cn("min-w-0 flex-1 truncate text-[11px]", ["auto", "waiting", "transcribing", "generating"].includes(status) ? "text-brand" : status === "manual" || status === "paused" ? "text-zinc-500" : "text-amber-600")}>{stateText}</span>
    {children}
  </div>;
}
