import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Mic,
  Pin,
  RotateCcw,
  RefreshCw,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useAppStore } from "@/store/appStore";
import { resolveSendTarget } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  isWaAccountConnected,
  resolveWaAccountConnection,
  resolveWaSendAccountId,
} from "@/lib/accountConnection";
import { reloadMedia as reloadMediaAction } from "@/components/chat/reloadMediaAction";
import { resolveMessageKeyFrom } from "@/components/chat/resolveMessageKey";
import { findLatestEditableOutgoingMessage } from "@/components/chat/latestEditableMessage";
import { ForwardMessageModal } from "@/components/chat/ForwardMessageModal";
import { VoiceBubble } from "@/components/chat/VoiceBubble";
import { shouldAutoLoadMessageMedia } from "@/components/chat/messageMediaUtils";
import { useMediaSend } from "@/components/chat/useMediaSend";
import { openAndroidMediaShare as openAndroidMediaShareAction } from "@/components/chat/openAndroidMediaShare";
import { imageToStickerDataUrl, messagePlainText } from "@/components/chat/chatPanelHelpers";
import { createStickerFavoriteActions } from "@/components/chat/stickerFavoriteActions";
import { retryMessage } from "@/components/chat/retryMessageAction";
import { loadStickerFavorites } from "@/lib/stickerFavorites";
import { titleOf } from "@/features/multiWindow/identity";
import { MultiWindowComposer } from "@/features/multiWindow/components/MultiWindowComposer";
import { MultiWindowConnectionBadge } from "@/features/multiWindow/components/MultiWindowConnectionBadge";
import { MultiWindowMessageMenu } from "@/features/multiWindow/components/MultiWindowMessageMenu";
import { useMultiWindowMessageActions } from "@/features/multiWindow/hooks/useMultiWindowMessageActions";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { useI18n, type TranslationKey } from "@/i18n";

function messageLabel(message: Message, t: (key: TranslationKey) => string) {
  if (message.body?.trim()) return message.body;
  if (message.mediaType === "image") return t("multi.mediaImage");
  if (message.mediaType === "video") return t("multi.mediaVideo");
  if (message.mediaType === "audio") return t("multi.mediaAudioMessage");
  if (message.mediaType === "sticker") return t("multi.mediaSticker");
  if (message.mediaType === "document") return t("multi.mediaFile");
  return t("multi.message");
}

function deliveryLabel(message: Message, t: (key: TranslationKey) => string) {
  if (message.direction !== "out") return "";
  switch (message.deliveryStatus) {
    case "pending": return t("multi.sending");
    case "queued": return t("multi.queued");
    case "failed": return t("multi.sendFailed");
    case "local": return t("multi.saved");
    case "read": return t("multi.read");
    case "delivered": return t("multi.delivered");
    case "server":
    case "sent":
    case "played":
    default: return t("multi.sent");
  }
}

export function MultiWindowCard({
  chat,
  contact,
  messages,
  summary,
  accountCount,
  unreadCount,
  accountOptions,
  onSelectAccount,
  onClose,
  onMarkRead,
  onLoadOlder,
  historyLoading,
  hasMoreHistory,
  onMaximize,
  reorderEnabled = false,
  dragging = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onReorderKeyDown,
  compact = false,
  collapsed = false,
  onToggleCollapsed,
  pinned = false,
  onTogglePinned,
  refreshing = false,
  onRefresh,
  onOpenDevices,
  onOpenQuickReplies,
  loadError,
  cardRef,
}: {
  chat: ChatPreview;
  contact?: Contact;
  messages: Message[];
  summary?: string;
  accountCount?: number;
  unreadCount?: number;
  accountOptions?: Array<{ id: string; label: string }>;
  onSelectAccount?: (chatId: string) => void;
  onClose: () => void;
  onMarkRead: () => void;
  onLoadOlder?: () => void;
  historyLoading?: boolean;
  hasMoreHistory?: boolean;
  onMaximize: () => void;
  reorderEnabled?: boolean;
  dragging?: boolean;
  onDragStart?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
  onReorderKeyDown?: (event: React.KeyboardEvent) => void;
  compact?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  pinned?: boolean;
  onTogglePinned?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  onOpenDevices?: () => void;
  onOpenQuickReplies?: () => void;
  loadError?: string;
  cardRef?: Ref<HTMLElement>;
}) {
  const { t } = useI18n();
  const enqueueOutgoingMessage = useAppStore((s) => s.enqueueOutgoingMessage);
  const pushToast = useAppStore((s) => s.pushToast);
  const updateMessageDelivery = useAppStore((s) => s.updateMessageDelivery);
  const patchMessage = useAppStore((s) => s.patchMessage);
  const setBaileysLoginOpen = useAppStore((s) => s.setBaileysLoginOpen);
  const allContacts = useAppStore((s) => s.contacts);
  const sendChannel = useAppStore((s) => s.settings.sendChannel);
  const waAccounts = useAppStore((s) => s.settings.waAccounts || []);
  const liveBaileysAccountId = useAppStore((s) => s.settings.liveBaileysAccountId);
  const activeAccountId = useAppStore((s) => s.settings.activeAccountId);
  const baileysConnection = useAppStore((s) => s.baileysUi.connection);
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const [mediaSending, setMediaSending] = useState(false);
  const [messageMenu, setMessageMenu] = useState<{
    x: number;
    y: number;
    messageId: string;
  } | null>(null);
  const [favoriteStickers, setFavoriteStickers] = useState<string[]>([]);
  const mediaResyncAtRef = useRef(new Map<string, number>());
  const mediaInFlightRef = useRef(new Set<string>());
  const autoLoadedMediaRef = useRef(new Set<string>());
  const title = titleOf(chat, contact);
  const recipient = resolveSendTarget({
    phone: contact?.phone,
    channelAddress: contact?.channelAddress,
    jid: contact?.channelAddress,
    entityId: contact?.id || chat.id,
  });
  const recentMessages = messages;

  useEffect(() => {
    let cancelled = false;
    void loadStickerFavorites()
      .then((items) => {
        if (!cancelled) setFavoriteStickers(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const stickerFavoriteActions = useMemo(
    () =>
      createStickerFavoriteActions({
        favoriteStickers,
        setFavoriteStickers,
        toStickerDataUrl: imageToStickerDataUrl,
        pushToast,
      }),
    [favoriteStickers, pushToast]
  );

  const unread = (unreadCount ?? chat.unread) > 0;
  const requestedChatAccountId =
    chat.accountId ||
    contact?.accountId ||
    liveBaileysAccountId ||
    activeAccountId;
  // 多窗口可能保留旧账号别名；与主聊天面板使用同一套账号解析，
  // 否则反应/删除会因路由到不存在的 session 而表现为“点击没反应”。
  const chatAccountId =
    resolveWaSendAccountId(
      waAccounts,
      requestedChatAccountId,
      liveBaileysAccountId,
      baileysConnection
    ) ||
    liveBaileysAccountId ||
    activeAccountId ||
    "wa-default";
  const chatConnection = resolveWaAccountConnection(waAccounts, chatAccountId, liveBaileysAccountId, baileysConnection);
  const chatConnected = isWaAccountConnected(waAccounts, chatAccountId, liveBaileysAccountId, baileysConnection);
  const {
    draft,
    setDraft: setDraftReply,
    getDraft,
    textSending,
    editingId,
    setEditingId,
    replyTo,
    setReplyTo,
    sendText,
    forwardMessage,
    setForwardMessage,
    forwardSending,
    forwardTargets,
    handleForwardMessage,
  } = useMultiWindowMessageActions({
    chat,
    contact,
    messages,
    channelId: sendChannel,
    accountId: chatAccountId,
    connection: chatConnection,
    connected: chatConnected,
    mediaSending,
  });
  const mediaSend = useMediaSend({
    sending: mediaSending,
    setSending: setMediaSending,
    guardBlockedSend: () => true,
    stickToBottom: () => undefined,
    resolveRecipient: () => ({ contact: contact || null, recipient }),
    pushToast,
    isBaileys: sendChannel !== "android_bridge",
    chatConnected,
    setBaileysLoginOpen,
    setDraftReply: () => undefined,
    enqueueOutgoingMessage,
    chatId: chat.id,
    patchMessage,
    updateMessageDelivery,
    channelId: sendChannel,
    selectedPhoneId: chat.phoneId || contact?.boundPhoneId || null,
    chatAccountId,
    openAndroidMediaShare: (file, dataUrl, caption, phoneE164) =>
      openAndroidMediaShareAction({
        file,
        dataUrl,
        caption,
        phoneE164,
        selectedPhoneId: chat.phoneId || contact?.boundPhoneId || null,
      }),
    toStickerDataUrl: imageToStickerDataUrl,
  });
  const attachFile = async (file: File) => {
    const caption = draft.trim();
    const result = file.type.toLowerCase().startsWith("image/")
      ? await mediaSend.sendImage(file, false, caption)
      : await mediaSend.sendFile(file, caption);
    if (result) setDraftReply("");
  };

  const retry = (id: string) => {
    void retryMessage({
      id,
      message: messages.find((item) => item.id === id),
      isBaileys: sendChannel !== "android_bridge",
      chatConnected,
      chatAccountId,
      setMediaBusyId,
      updateMessageDelivery,
      pushToast,
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(t("common.copied"), "success");
    } catch {
      pushToast(t("multi.copyFailed"), "error");
    }
  };
  const editLatestMessage = useCallback(() => {
    if (editingId || sendChannel === "android_bridge") return false;
    const message = findLatestEditableOutgoingMessage(messages);
    if (
      !message ||
      !resolveMessageKeyFrom(message, allContacts, contact?.id || null)
    ) {
      return false;
    }
    setReplyTo(null);
    setEditingId(message.id);
    setDraftReply(message.body);
    pushToast(t("messageMenu.editHint"), "info");
    return true;
  }, [allContacts, contact?.id, editingId, messages, pushToast, sendChannel, setDraftReply, setEditingId, setReplyTo, t]);
  const reloadMedia = useCallback((message: Message, quiet = false) => {
    const sourceMessage = useAppStore.getState().messages.find((item) => item.id === message.id) || message;
    return reloadMediaAction({
      message,
      sourceMessage,
      isBaileys: sendChannel !== "android_bridge",
      chatConnected,
      chatAccountId,
      activeContactName: title,
      mediaResyncAt: mediaResyncAtRef.current,
      mediaInFlight: mediaInFlightRef.current,
      setMediaBusyId,
      resolveMessageKey: (item) => resolveMessageKeyFrom(item, allContacts, contact?.id || null),
      updateMessageDelivery,
      pushToast,
      quiet,
    });
  }, [activeAccountId, allContacts, baileysConnection, chatAccountId, chatConnected, contact?.id, liveBaileysAccountId, pushToast, sendChannel, title, updateMessageDelivery]);

  const mediaKey = messages.map((message) => `${message.id}:${message.mediaUrl ? "ready" : message.mediaError ? "failed" : "pending"}`).join("|");
  useEffect(() => {
    const targets = messages.filter((message) => !message.mediaError && shouldAutoLoadMessageMedia(message)).slice(-4);
    for (const message of targets) {
      if (autoLoadedMediaRef.current.has(message.id)) continue;
      autoLoadedMediaRef.current.add(message.id);
      void reloadMedia(message, true);
    }
  }, [mediaKey, messages, reloadMedia]);

  return (
    <article ref={cardRef} tabIndex={-1} data-collapsed={collapsed ? "true" : "false"} className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-zinc-900/45 shadow-lg shadow-black/10 transition-opacity", collapsed && "self-start", unread ? "border-brand/55 shadow-brand/10" : "border-zinc-800/90", dragging && "opacity-50")} onDragOver={reorderEnabled ? onDragOver : undefined} onDrop={reorderEnabled ? onDrop : undefined} onDragEnd={reorderEnabled ? onDragEnd : undefined} aria-label={`${title}${unread ? `, ${t("multi.unreadCount", { count: unreadCount ?? chat.unread })}` : ""}`}>
      <header className={cn("flex shrink-0 items-center gap-2 border-b px-3", compact ? "h-10" : "h-12", unread ? "border-brand/25 bg-brand/5" : "border-zinc-800/80 bg-zinc-900/80")}>
        <Avatar name={title} seed={contact?.phone || contact?.id || chat.id} src={contact?.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {reorderEnabled && (
              <span
                draggable
                role="button"
                tabIndex={0}
                aria-label={t("multi.reorderAria")}
                title={t("multi.reorderTitle")}
                onDragStart={onDragStart}
                onKeyDown={onReorderKeyDown}
                className="inline-flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            )}
            <div className={cn("truncate text-[12px] font-semibold", unread ? "text-brand" : "text-zinc-100")}>{title}</div>
            {accountCount && accountCount > 1 && <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] text-sky-300">{t("multi.accountCount", { count: accountCount })}</span>}
            <MultiWindowConnectionBadge channel={sendChannel} connected={chatConnected} onOpenDevices={onOpenDevices} />
            {accountOptions && accountOptions.length > 1 && onSelectAccount && (
              <select value={chat.id} onChange={(event) => onSelectAccount(event.target.value)} className="ui-control h-6 max-w-36 shrink-0 px-1.5 text-[9px]" aria-label={t("multi.selectReplyAccount")}>
                {accountOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            )}
          </div>
          <div className="truncate text-2xs text-zinc-600">{contact?.phone || contact?.channelAddress || t("multi.whatsappChat")}</div>
        </div>
        {unread && <>
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-700 px-1.5 text-[10px] font-bold tabular-nums text-white shadow-2xs dark:bg-emerald-600">{t("multi.unread")} {(unreadCount ?? chat.unread) > 99 ? "99+" : (unreadCount ?? chat.unread)}</span>
          <button type="button" className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200" title={t("multi.markRead")} aria-label={t("multi.markContactRead", { title })} onClick={onMarkRead}><Check className="h-3.5 w-3.5" /></button>
        </>}
        <button type="button" className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200" title={t("multi.maximize")} onClick={onMaximize}><Maximize2 className="h-3.5 w-3.5" /></button>
        {onTogglePinned && <button type="button" className={cn("rounded p-1.5 transition-colors", pinned ? "text-brand hover:bg-brand/10" : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200")} title={pinned ? t("multi.unpin") : t("multi.pin")} aria-label={pinned ? t("multi.unpinContact", { title }) : t("multi.pinContact", { title })} onClick={onTogglePinned}><Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} /></button>}
        {onRefresh && <button type="button" disabled={refreshing} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-wait disabled:opacity-50" title={t("multi.refreshWindow")} aria-label={t("multi.refreshContact", { title })} onClick={onRefresh}><RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin text-brand")} /></button>}
        {onToggleCollapsed && <button type="button" className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200" title={collapsed ? t("multi.expandWindow") : t("multi.collapseWindow")} aria-label={collapsed ? t("multi.expandContact", { title }) : t("multi.collapseContact", { title })} onClick={onToggleCollapsed}>{collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</button>}
        <button type="button" className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200" title={t("multi.removeWindow")} onClick={onClose}><X className="h-3.5 w-3.5" /></button>
      </header>
      {!collapsed && <>
      {loadError && <div className="mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-lg border border-rose-400/20 bg-rose-500/5 px-2.5 py-1.5 text-[10px] text-rose-200/80"><span className="min-w-0 truncate" title={loadError}>{t("multi.loadFailed")}</span>{onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing} className="shrink-0 text-rose-300 underline underline-offset-2 hover:text-rose-100 disabled:opacity-50">{t("common.retry")}</button>}</div>}
      <div className={cn("chat-canvas min-h-0 flex-1 overflow-y-auto", compact ? "space-y-1 px-2 py-1.5" : "space-y-1.5 px-2.5 py-2.5")}>
        {(hasMoreHistory || historyLoading) && onLoadOlder && (
          <button
            type="button"
            disabled={historyLoading}
            onClick={onLoadOlder}
            className="mx-auto mb-1 block rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-[10px] text-zinc-500 transition-colors hover:border-brand/40 hover:text-brand disabled:cursor-wait disabled:opacity-60"
          >
            {historyLoading ? t("multi.loadingEarlier") : t("multi.loadEarlier")}
          </button>
        )}
        {recentMessages.length === 0 ? <div className="flex h-full items-center justify-center text-center text-[11px] text-zinc-600">{summary ? t("multi.latestMessage", { summary }) : t("multi.noMessages")}</div> : recentMessages.map((message) => {
          const mediaUrl = message.mediaUrl;
          const mediaType = message.mediaType || "";
          const mediaLabel = mediaType === "audio" ? t("multi.mediaAudio") : mediaType === "image" || mediaType === "sticker" ? t("multi.mediaImage") : mediaType === "video" || mediaType === "gif" ? t("multi.mediaVideo") : t("multi.mediaFile");
          const media = mediaUrl && (mediaType === "image" || mediaType === "sticker") ? <img src={mediaUrl} alt={message.mediaCaption || t("multi.mediaImage")} className="mb-1 max-h-24 max-w-full rounded object-contain" loading="lazy" decoding="async" /> : mediaUrl && mediaType === "audio" ? <VoiceBubble src={mediaUrl} seconds={message.mediaSeconds} ptt={Boolean(message.mediaPtt)} outbound={message.direction === "out"} /> : mediaUrl && (mediaType === "video" || mediaType === "gif") ? <video controls preload="metadata" src={mediaUrl} className="mb-1 max-h-24 max-w-full rounded" /> : mediaType ? message.mediaError ? <button type="button" disabled={mediaBusyId === message.id} onClick={() => void reloadMedia(message)} className="mb-1 flex items-center gap-1.5 rounded-lg border border-rose-400/20 bg-black/15 px-2.5 py-1.5 text-left text-[10px] text-rose-200/80 hover:bg-black/25 disabled:opacity-60"><RotateCcw className="h-3 w-3 shrink-0" />{mediaBusyId === message.id ? t("multi.retrying") : t("multi.mediaUnavailable", { media: mediaLabel })}</button> : <div className="mb-1 flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-black/15 px-2.5 py-1.5 text-[10px] text-zinc-400">{mediaType === "audio" ? <Mic className="h-3 w-3 shrink-0" /> : mediaType === "image" || mediaType === "sticker" ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}<Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand/80" />{t("multi.preparingMedia", { media: mediaLabel })}</div> : null;
          const status = deliveryLabel(message, t);
          return <div
            key={message.id}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMessageMenu({ x: event.clientX, y: event.clientY, messageId: message.id });
            }}
            className={cn("w-fit min-w-0 max-w-[88%] rounded-lg leading-[1.35]", compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]", message.direction === "out" ? "ml-auto bg-brand/20 text-zinc-100" : "mr-auto bg-zinc-800/90 text-zinc-300")}
          >
            {media}
            {message.body?.trim() && mediaType !== "audio" ? <div className="min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]" title={message.body}>{message.body}</div> : !media ? <div className="whitespace-pre-wrap break-words">{messageLabel(message, t)}</div> : null}
            <div className="mt-0.5 flex justify-end gap-1.5 text-[9px] text-zinc-600"><span>{(message.sentAt || "").slice(11, 16)}</span>{status && <span className={message.deliveryStatus === "failed" ? "text-rose-400" : ""}>{status}</span>}</div>
          </div>;
        })}
      </div>
      <MultiWindowComposer
        value={draft}
        onChange={setDraftReply}
        onSend={() => void sendText()}
        onEditLatest={editLatestMessage}
        onAttach={!editingId && !replyTo ? (file) => void attachFile(file) : undefined}
        ariaLabel={t("multi.messageFor", { title })}
        disabled={mediaSending || textSending}
        compact={compact}
        onOpenQuickReplies={onOpenQuickReplies}
        context={editingId ? {
          kind: "edit",
          preview: messages.find((message) => message.id === editingId)?.body || t("multi.sentMessage"),
          onCancel: () => {
            setEditingId(null);
            setDraftReply("");
          },
        } : replyTo ? {
          kind: "reply",
          preview: replyTo.body,
          onCancel: () => setReplyTo(null),
        } : undefined}
      />
      </>}
      <MultiWindowMessageMenu
        menu={messageMenu}
        messages={messages}
        contactId={contact?.id}
        favoriteStickers={favoriteStickers}
        mediaBusyId={mediaBusyId}
        isBaileys={sendChannel !== "android_bridge"}
        chatAccountId={chatAccountId}
        chatConnected={chatConnected}
        replyTo={replyTo}
        onClose={() => setMessageMenu(null)}
        onCopy={(text) => void copyText(text)}
        onReload={(message) => void reloadMedia(message)}
        onToggleSticker={stickerFavoriteActions.toggle}
        onRetry={retry}
        setEditingId={setEditingId}
        setReplyTo={setReplyTo}
        setDraftReply={setDraftReply}
        getDraft={getDraft}
        onForward={setForwardMessage}
      />
      {forwardMessage && (
        <ForwardMessageModal
          preview={messagePlainText(forwardMessage)}
          targets={forwardTargets}
          sending={forwardSending}
          onClose={() => setForwardMessage(null)}
          onSend={handleForwardMessage}
        />
      )}
    </article>
  );
}
