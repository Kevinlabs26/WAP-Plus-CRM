import { Ban, Loader2, Send } from "lucide-react";
import { useAppStore, type AppState } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { getAccountBlocklist, isJidBlocked } from "@/lib/accountWaMeta";
import {
  displayContactLabel,
  resolveSendTarget,
} from "@/lib/utils";
import { cn } from "@/lib/utils";
import { resolveChatBackground } from "@/lib/chatBackground";
import {
  buildSenderContactLookup,
  buildSenderMemberLookup,
  openOrBuildDmContact,
  presentGroupSender,
} from "@/lib/groupSenderDisplay";
import {
  SAVED_MESSAGES_CHAT_ID,
  type Contact,
} from "@/types/crm";
import { formatAccountDisplay } from "@/lib/accountLabels";
import {
  isWaAccountConnected,
  resolveWaAccountConnection,
  resolveWaSendAccountId,
} from "@/lib/accountConnection";
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

const GroupInfoPanel = lazy(() =>
  import("@/components/chat/GroupInfoPanel").then((m) => ({ default: m.GroupInfoPanel }))
);
const PersonMultiAccountPanel = lazy(() =>
  import("@/components/crm/PersonMultiAccountPanel").then((m) => ({ default: m.PersonMultiAccountPanel }))
);
const ChatFollowUpDialog = lazy(() =>
  import("./ChatFollowUpDialog").then((m) => ({ default: m.ChatFollowUpDialog }))
);
const ChatScheduledMessageDialog = lazy(() =>
  import("./ChatScheduledMessageDialog").then((m) => ({ default: m.ChatScheduledMessageDialog }))
);
const ChatMediaPanel = lazy(() =>
  import("./ChatMediaPanel").then((m) => ({ default: m.ChatMediaPanel }))
);
import { ChatInternalNoteBar } from "@/components/chat/ChatInternalNoteBar";
import {
  filterMessagesForAccount,
  type PersonThreadRow,
} from "@/lib/personThreads";
import type {
  Message,
} from "@/types/crm";
import {
  baileysChatModify,
  baileysFetchMessageHistory,
  baileysSync,
  baileysPresence,
  baileysSendContact,
} from "@/lib/baileys";
import { applyChatPreference } from "@/lib/chatPreferences";
import { Button } from "@/components/ui/primitives";
import { type ChannelId } from "@/channels";
import { gatedMediaSend } from "@/channels/mediaGate";

import { loadMessagesPage } from "@/lib/storage";
import { syncLog } from "@/lib/syncDebug";
import { Composer } from "./Composer";
import { ChatSearchBar } from "./ChatSearchBar";
import { ForwardMessageModal } from "./ForwardMessageModal";
import {
  MESSAGE_INITIAL_RENDER_COUNT,
  MessageList,
  type MessageListHandle,
} from "./MessageList";
import { ChatWelcome } from "./ChatWelcome";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { useVoiceRecording } from "./useVoiceRecording";
import { useSavedMessages } from "./useSavedMessages";
import { useChatSearch } from "./useChatSearch";
import { useCatalog } from "./useCatalog";
import { useGroupMembers } from "./useGroupMembers";
import { useMediaSend } from "./useMediaSend";
import { useTextSend } from "./useTextSend";
import { useChatExport } from "./useChatExport";
import { useSaveContact } from "./useSaveContact";
import { useForwardMessage } from "./useForwardMessage";
import { useMessageActions } from "./useMessageActions";
const ProductPicker = lazy(() =>
  import("./ProductPicker").then((m) => ({ default: m.ProductPicker }))
);
const ProductManager = lazy(() =>
  import("./ProductManager").then((m) => ({ default: m.ProductManager }))
);
import { usePeerPresence } from "./usePeerPresence";
import { retryMessage as retryMessageAction } from "./retryMessageAction";
import { reloadMedia as reloadMediaAction } from "./reloadMediaAction";
import { searchContact } from "./searchContactAction";
import { openAndroidMediaShare as openAndroidMediaShareAction } from "./openAndroidMediaShare";
import { toggleBlock } from "./toggleBlockAction";
import { createStickerFavoriteActions } from "./stickerFavoriteActions";
import { loadStickerFavorites } from "@/lib/stickerFavorites";
import { workflowForStage } from "@/lib/contactWorkflow";
import {
  imageToStickerDataUrl,
  messagePlainText,
  useEventCallback,
} from "./chatPanelHelpers";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import { resolveMessageKeyFrom } from "./resolveMessageKey";
import { findLatestEditableOutgoingMessage } from "./latestEditableMessage";
import { ChatPanelHeader } from "./ChatPanelHeader";import { ChatPanelMessageMenu } from "./ChatPanelMessageMenu";
import { SavedMessageToolbar } from "./SavedMessageToolbar";
import { usePhoneScreenPolling } from "./usePhoneScreenPolling";
import { useOverlayContactCard } from "./useOverlayContactCard";
import { SaveContactDialog } from "./SaveContactDialog";
import { ContactCardPicker } from "./ContactCardPicker";
import { useI18n } from "@/i18n";

const EMPTY_MESSAGES: Message[] = [];
/** 非群聊时的发送者映射（稳定引用） */
const EMPTY_SENDER_MAP = {} as Record<string, undefined>;
/** 非群聊时传给 Composer 的空成员列表（稳定引用，避免击穿 memo） */
const EMPTY_GROUP_MEMBERS: { jid: string; label: string; phoneE164?: string }[] = [];
const EMPTY_WA_ACCOUNTS: NonNullable<
  AppState["settings"]["waAccounts"]
> = [];

/** 展示级浅比较：内容不变则不更新引用，稳定 memo 子组件 */
function shallowContactSame(a: Contact, b: Contact): boolean {
  const { lastMessageAt: _a, ...left } = a;
  const { lastMessageAt: _b, ...right } = b;
  const keys = Object.keys(left) as (keyof typeof left)[];
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

/** 群聊发送者展示对象浅比较：内容未变则复用旧引用（避免击穿气泡 memo） */
function shallowSenderSame(
  a: ReturnType<typeof presentGroupSender>,
  b: ReturnType<typeof presentGroupSender>
): boolean {
  return (
    a.label === b.label &&
    a.avatarUrl === b.avatarUrl &&
    a.avatarFullUrl === b.avatarFullUrl &&
    a.subtitle === b.subtitle &&
    a.dmTarget === b.dmTarget
  );
}

export function ChatPanel() {
  const { t } = useI18n();
  const phones = useAppStore((s) => s.phones);
  const followUps = useAppStore((s) => s.followUps);
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const selectedPhoneId = useAppStore((s) => s.selectedPhoneId);
  const bridgeConnected = useAppStore((s) => s.bridge.connected);
  const selectedContactId = useAppStore((s) => s.selectedContactId);
  const selectedThreadAccount = useAppStore((s) => s.selectedThreadAccount);
  const activeChat = useAppStore((s) => {
    const id = s.selectedChatId;
    return id ? s.chats.find((chat) => chat.id === id) : undefined;
  });
  const activeContactRef = useRef<Contact | null>(null);
  const activeContactIndexRef = useRef(-1);
  const selectActiveContact = useCallback((s: AppState) => {
    const id = s.selectedContactId;
    if (!id) {
      activeContactRef.current = null;
      activeContactIndexRef.current = -1;
      return undefined;
    }
    let index = activeContactIndexRef.current;
    if (s.contacts[index]?.id !== id) {
      index = s.contacts.findIndex((contact) => contact.id === id);
      activeContactIndexRef.current = index;
    }
    const next = index >= 0 ? s.contacts[index] : undefined;
    const previous = activeContactRef.current;
    if (previous && next && shallowContactSame(previous, next)) {
      return previous;
    }
    activeContactRef.current = next ?? null;
    return next;
  }, []);
  const activeContact = useAppStore(selectActiveContact);
  // Full collections are action-time snapshots, not subscriptions. Current
  // chat/contact selectors above decide when this panel actually re-renders.
  const chats = useAppStore.getState().chats;
  const contacts = useAppStore.getState().contacts;
  const setDraftReply = useAppStore((s) => s.setDraftReply);
  const enqueueOutgoingMessage = useAppStore((s) => s.enqueueOutgoingMessage);
  const updateMessageDelivery = useAppStore((s) => s.updateMessageDelivery);
  const patchMessage = useAppStore((s) => s.patchMessage);
  const updateContact = useAppStore((s) => s.updateContact);
  const deleteContactLocal = useAppStore((s) => s.deleteContactLocal);
  const pushToast = useAppStore((s) => s.pushToast);
  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const setSavedMessagesPinned = useAppStore((s) => s.setSavedMessagesPinned);
  const deleteSavedMessages = useAppStore((s) => s.deleteSavedMessages);
  const settings = useAppStore(
    useShallow((s) => ({
      sendChannel: s.settings.sendChannel,
      liveBaileysAccountId: s.settings.liveBaileysAccountId,
      activeAccountId: s.settings.activeAccountId,
      waAccounts: s.settings.waAccounts ?? EMPTY_WA_ACCOUNTS,
      salesStageLabels: s.settings.salesStageLabels,
      blocklistByAccountId: s.settings.blocklistByAccountId,
      blocklistJids: s.settings.blocklistJids,
    }))
  );
  const baileysUi = useAppStore(
    useShallow((s) => ({
      connection: s.baileysUi.connection,
      hasQr: s.baileysUi.hasQr,
      userName: s.baileysUi.userName,
    }))
  );
  const focusMessageId = useAppStore((s) => s.focusMessageId);
  const setFocusMessageId = useAppStore((s) => s.setFocusMessageId);
  const setSelectedChat = useAppStore((s) => s.setSelectedChat);
  const setSelectedContact = useAppStore((s) => s.setSelectedContact);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const markChatUnreadLocal = useAppStore((s) => s.markChatUnreadLocal);
  const patchChat = useAppStore((s) => s.patchChat);
  const deleteChatLocal = useAppStore((s) => s.deleteChatLocal);
  const scheduleFollowUp = useAppStore((s) => s.scheduleFollowUp);
  const scheduleMessage = useAppStore((s) => s.scheduleMessage);
  const chatBackground = useAppStore(
    useShallow((s) => s.settings.chatBackground)
  );
  const chatBgStyle = useMemo(
    () => resolveChatBackground({ chatBackground }),
    [chatBackground]
  );
  const selectedThreadAccountId =
    selectedThreadAccount?.chatId === selectedChatId
      ? selectedThreadAccount.accountId
      : null;
  const requestedChatAccountId =
    selectedThreadAccountId ||
    activeChat?.accountId ||
    activeContact?.accountId ||
    settings.liveBaileysAccountId ||
    settings.activeAccountId;
  const chatAccountId = resolveWaSendAccountId(
    settings.waAccounts,
    requestedChatAccountId,
    settings.liveBaileysAccountId,
    baileysUi.connection
  ) || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default";

  /**
   * 当前会话消息：selector 返回稳定数组引用。
   * 其它会话 patch 消息时，当前列表元素引用未变 → Object.is 相同 → 不重渲染。
   */
  const chatMessagesFallbackRef = useRef<{
    chatId: string;
    messages: unknown;
    value: Message[];
  } | null>(null);
  const selectChatMessages = useCallback((s: AppState) => {
    const chatId = s.selectedChatId;
    if (!chatId) return EMPTY_MESSAGES;
    const indexed = s.messagesByChatId[chatId];
    // The index is maintained by a subscription and can briefly lag behind
    // messages when a bridge event arrives while switching chats. Never show
    // an empty transcript if the source collection already has this chat.
    if (indexed?.length) return indexed;

    const previous = chatMessagesFallbackRef.current;
    if (previous?.chatId === chatId && previous.messages === s.messages) {
      return previous.value;
    }
    const matched = s.messages.filter((message) => message.chatId === chatId);
    matched.sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
    chatMessagesFallbackRef.current = {
      chatId,
      messages: s.messages,
      value: matched,
    };
    return matched;
  }, []);
  const allChatMessages = useAppStore(selectChatMessages);
  const chatMessages = useMemo(
    () =>
      activeChat?.localOnly
        ? allChatMessages
        : filterMessagesForAccount(
            allChatMessages,
            chatAccountId,
            settings.liveBaileysAccountId
          ),
    [
      activeChat?.localOnly,
      allChatMessages,
      chatAccountId,
      settings.liveBaileysAccountId,
    ]
  );

  const {
    chatSearchOpen,
    setChatSearchOpen,
    chatSearchQuery,
    setChatSearchQuery,
    chatSearchIndex,
    chatSearchMatches,
    showSearchMatch,
    resetSearch,
  } = useChatSearch({
    chatMessages,
    setFocusMessageId,
  });

  /** 客户最近一条入站消息正文（供自动检测译出语；只取真人对白，跳过系统/转写占位） */
  const lastInboundBody = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const m = chatMessages[i];
      if (m.direction !== "in") continue;
      if (m.mediaType === "system" || m.systemKind) continue;
      const body = (m.body || "").trim();
      if (!body) continue;
      return body;
    }
    return "";
  }, [chatMessages]);

  // 把 SQLite 加载的消息按 id 去重、按 sentAt 合并进 store（保持全局顺序）
  const mergeMessagesFromDisk = useCallback((incoming: Message[]) => {
    useAppStore.setState((state) => {
      const messages = mergeMessagesByTime(state.messages, incoming);
      if (messages === state.messages) return state;

      const messagesByChatId = { ...state.messagesByChatId };
      const incomingByChat = new Map<string, Message[]>();
      for (const message of incoming) {
        if (!message.chatId) continue;
        const bucket = incomingByChat.get(message.chatId) || [];
        bucket.push(message);
        incomingByChat.set(message.chatId, bucket);
      }
      for (const [chatId, additions] of incomingByChat) {
        const bucket =
          messagesByChatId[chatId] ||
          state.messages.filter((message) => message.chatId === chatId);
        messagesByChatId[chatId] = mergeMessagesByTime(bucket, additions);
      }
      return { messages, messagesByChatId };
    });
  }, []);
  const historyRequestedRef = useRef(new Set<string>());

  // 打开会话：若内存不足 200 条，从 SQLite 补最近一批（合并排序）
  useEffect(() => {
    if (!selectedChatId) return;
    if (chatMessages.length >= 200) return;
    let cancelled = false;
    void loadMessagesPage({ chatId: selectedChatId, limit: 200 }).then((page) => {
      if (cancelled || !page) return;
      syncLog("ui.chat", "disk page loaded", {
        chatId: selectedChatId,
        pageItems: page.items?.length || 0,
        pageTotal: page.total,
        memoryBefore: useAppStore
          .getState()
          .messages.filter((message) => message.chatId === selectedChatId).length,
      });
      if (page.items?.length) mergeMessagesFromDisk(page.items as Message[]);
      syncLog("ui.chat", "disk page merged", {
        chatId: selectedChatId,
        memoryAfter: useAppStore
          .getState()
          .messages.filter((message) => message.chatId === selectedChatId).length,
        indexedAfter:
          useAppStore.getState().messagesByChatId[selectedChatId]?.length || 0,
      });
      const state = useAppStore.getState();
      const chat = state.chats.find((item) => item.id === selectedChatId);
      const accountId = chatAccountId || chat?.accountId || chat?.phoneId || "";
      const bucket = filterMessagesForAccount(
        state.messagesByChatId[selectedChatId] || [],
        accountId,
        settings.liveBaileysAccountId
      );
      const oldest = bucket.find(
        (message) => message.waKey?.remoteJid && message.waKey?.id
      );
      const requestKey = `${accountId}:${selectedChatId}`;
      if (
        bucket.length < 200 &&
        oldest?.waKey &&
        accountId &&
        !historyRequestedRef.current.has(requestKey)
      ) {
        historyRequestedRef.current.add(requestKey);
        void baileysFetchMessageHistory(
          {
            key: oldest.waKey,
            oldestMsgTimestampMs: Date.parse(oldest.sentAt),
            count: 50,
          },
          accountId
        )
          .then(() => {
            syncLog("ui.chat", "protocol history requested", {
              chatId: selectedChatId,
              accountId,
              localCount: bucket.length,
            });
          })
          .catch((error) => {
            historyRequestedRef.current.delete(requestKey);
            syncLog("ui.chat", "protocol history request failed", {
              chatId: selectedChatId,
              error: String(error),
            });
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, chatAccountId, settings.liveBaileysAccountId]);

  // 上滑加载更早：以当前最旧消息为游标，分页拉 SQLite 冷历史并合并
  const loadOlderFromDisk = useCallback(
    async (
      chatId: string,
      cursor: { beforeSentAt: string; beforeId: string } | null
    ) => {
      const page = await loadMessagesPage({
        chatId,
        beforeSentAt: cursor?.beforeSentAt ?? null,
        beforeId: cursor?.beforeId ?? null,
        limit: 80,
      });
      const items = (page?.items || []) as Message[];
      if (!items.length) return 0;
      const before = useAppStore.getState().messages.length;
      mergeMessagesFromDisk(items);
      return useAppStore.getState().messages.length - before;
    },
    [mergeMessagesFromDisk]
  );

  const recentStickers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    // 从最新往前收集，凑够 8 个不同贴纸即停（避免全量 reverse+filter）
    for (let i = chatMessages.length - 1; i >= 0 && out.length < 8; i--) {
      const m = chatMessages[i]!;
      if (m.mediaType !== "sticker") continue;
      if (!m.mediaUrl?.startsWith("data:image/webp;base64,")) continue;
      if (seen.has(m.mediaUrl)) continue;
      seen.add(m.mediaUrl);
      out.push(m.mediaUrl);
    }
    return out;
  }, [chatMessages]);

  const [sending, setSending] = useState(false);
  const [searchingContact, setSearchingContact] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const closeGroupInfo = useCallback(() => setShowGroupInfo(false), []);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [scheduledMessageDialogOpen, setScheduledMessageDialogOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [noteOpenRequest, setNoteOpenRequest] = useState(0);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShowGroupInfo(false);
    setHeaderMenuOpen(false);
    setFollowUpDialogOpen(false);
    setScheduledMessageDialogOpen(false);
    setMediaPanelOpen(false);
    setContactPickerOpen(false);
  }, [selectedChatId]);

  useEffect(() => {
    if (!headerMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      const el = headerMenuRef.current;
      if (el && !el.contains(e.target as Node)) setHeaderMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeaderMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [headerMenuOpen]);
  const {
    showScreen,
    setShowScreen,
    screenUrl,
    screenError,
  } = usePhoneScreenPolling();
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  const [favoriteStickers, setFavoriteStickers] = useState<string[]>([]);
  const messageListRef = useRef<MessageListHandle | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 用户上翻看历史时不强制吸底；切会话 / 自己发消息时强制到底 */
  const stickToBottomRef = useRef(true);
  const prevChatIdRef = useRef<string | null>(null);
  /** 受控滚动：事件驱动。订阅 store 总 messages 长度（真正入库的新消息才触发），
   *  不依赖 chatMessages（其长度会随 owner 过滤条件波动，导致反复滚动闪烁）。 */
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    // 切会话：无条件滚到底
    const chatChanged = prevChatIdRef.current !== selectedChatId;
    if (chatChanged) {
      prevChatIdRef.current = selectedChatId;
      stickToBottomRef.current = true;
    }
    prevMessageCountRef.current = selectedChatId
      ? useAppStore.getState().messagesByChatId[selectedChatId]?.length || 0
      : 0;
    // 只观察当前聊天的索引桶；其它聊天入库不能推动当前滚动条。
    return useAppStore.subscribe((state) => {
      const count = selectedChatId
        ? state.messagesByChatId[selectedChatId]?.length || 0
        : 0;
      const prevCount = prevMessageCountRef.current;
      if (count === prevCount) return;
      prevMessageCountRef.current = count;
      if (count <= prevCount) return;
      if (!stickToBottomRef.current) return;
      requestAnimationFrame(() => {
        messageListRef.current?.scrollToBottom("auto");
      });
    });
  }, [selectedChatId]);
  const mediaResyncAtRef = useRef(new Map<string, number>());
  const mediaInFlightRef = useRef(new Set<string>());
  const [msgMenu, setMsgMenu] = useState<{
    x: number;
    y: number;
    messageId: string;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    body: string;
    direction: "in" | "out";
  } | null>(null);
  const mentionTrackerRef = useRef<
    { token: string; jid: string; everyone?: boolean }[]
  >([]);

  useEffect(() => {
    void loadStickerFavorites().then(setFavoriteStickers);
  }, []);

  const channelId = (
    settings.sendChannel === "android_bridge" ? "android_bridge" : "baileys"
  ) as ChannelId;
  const setBaileysLoginOpenRaw = useAppStore((s) => s.setBaileysLoginOpen);
  const setBaileysLoginOpen = useCallback(
    (open: boolean) => {
      if (
        open &&
        chatAccountId &&
        chatAccountId !== settings.liveBaileysAccountId
      ) {
        updateSettings({ liveBaileysAccountId: chatAccountId });
      }
      setBaileysLoginOpenRaw(open);
    },
    [
      chatAccountId,
      settings.liveBaileysAccountId,
      setBaileysLoginOpenRaw,
      updateSettings,
    ]
  );
  const isBaileys = channelId === "baileys";

  const { groupMembers, groupMemberDetails } = useGroupMembers({
    selectedChatId,
    selectedContactId,
    isBaileys,
    liveBaileysAccountId: settings.liveBaileysAccountId,
    activeAccountId: settings.activeAccountId,
    onChatChange: () => {
      mentionTrackerRef.current = [];
    },
  });

  const localOnlyChat = Boolean(activeChat?.localOnly);
  const {
    savedDraft,
    setSavedDraft,
    savedFilter,
    setSavedFilter,
    savedTagFilter,
    setSavedTagFilter,
    savedSelectMode,
    setSavedSelectMode,
    savedSelectedIds,
    setSavedSelectedIds,
    savedVisibleMessages,
    savedTags,
    savedVisibleIds,
    toggleSavedSelection,
    clearSavedSelection,
    resetSaved,
  } = useSavedMessages({ chatMessages, localOnlyChat });
  const activePhone = phones.find((p) => p.id === selectedPhoneId);
  const chatAccount = settings.waAccounts?.find(
    (account) => account.id === chatAccountId
  );
  const chatConnected = isWaAccountConnected(
    settings.waAccounts,
    chatAccountId,
    settings.liveBaileysAccountId,
    baileysUi.connection
  );
  const chatConnection = resolveWaAccountConnection(
    settings.waAccounts,
    chatAccountId,
    settings.liveBaileysAccountId,
    baileysUi.connection
  );

  // A chat preview can arrive from WhatsApp before its transcript does (for
  // example after sending from the official app). Request one history sync so
  // opening that chat does not leave the center panel on the empty state.
  const emptyHistoryRequestRef = useRef(new Set<string>());
  useEffect(() => {
    if (
      !isBaileys ||
      !selectedChatId ||
      !chatConnected ||
      chatMessages.length > 0 ||
      !activeChat
    ) {
      return;
    }
    if (!(activeChat.lastMessage || activeChat.updatedAt)) return;
    const requestKey = `${chatAccountId}:${selectedChatId}`;
    if (emptyHistoryRequestRef.current.has(requestKey)) return;
    emptyHistoryRequestRef.current.add(requestKey);
    void baileysSync(chatAccountId, { requestHistory: true }).catch((error) => {
      emptyHistoryRequestRef.current.delete(requestKey);
      syncLog("ui.chat", "empty chat history sync failed", {
        chatId: selectedChatId,
        accountId: chatAccountId,
        error: String(error),
      });
    });
  }, [
    activeChat,
    chatAccountId,
    chatConnected,
    chatMessages.length,
    isBaileys,
    selectedChatId,
  ]);

  const { exportingChat, exportChat } = useChatExport({
    activeChat,
    activeContact,
    chatMessages,
    chatAccount,
    pushToast,
  });

  const {
    saveContactDialog,
    setSaveContactDialog,
    savingContact,
    handleSaveContact,
    confirmSaveContact,
  } = useSaveContact({
    activeContact,
    activeChat,
    isBaileys,
    bridgeConnected,
    chatAccountId,
    selectedPhoneId,
    updateContact,
    pushToast,
  });

  const {
    forwardMessage,
    setForwardMessage,
    forwardSending,
    forwardTargets,
    handleForwardMessage,
  } = useForwardMessage({
    chats,
    contacts,
    selectedContactId,
    blocklistByAccountId: settings.blocklistByAccountId,
    blocklistJids: settings.blocklistJids,
    liveBaileysAccountId: settings.liveBaileysAccountId,
    activeAccountId: settings.activeAccountId,
    pushToast,
  });

  const {
    transcribingId,
    translatingId,
    transcribe,
    translate,
  } = useMessageActions({
    patchMessage,
    pushToast,
  });

  const switchSiblingThread = (row: PersonThreadRow) => {
    // 底部标签只切换聊天线程，顶部账号浏览范围保持不变。
    const exists = useAppStore
      .getState()
      .chats.some((chat) => chat.id === row.chatId);
    if (exists) {
      setSelectedChat(row.chatId, row.accountId);
    } else {
      openContactWorkspace(row.contactId);
      const openedChatId = useAppStore.getState().selectedChatId;
      if (openedChatId) setSelectedChat(openedChatId, row.accountId);
    }
    const acc = (settings.waAccounts || []).find((a) => a.id === row.accountId);
    const accIdx =
      Math.max(
        0,
        (settings.waAccounts || []).findIndex((a) => a.id === row.accountId)
      ) + 1 || 1;
    pushToast(
      `已切换到 ${formatAccountDisplay({
        label: acc?.label,
        userName: acc?.userName,
        index1: accIdx,
      })} 与此联系人的会话`,
      "info"
    );
  };

  const selectStartAccount = (accountId: string) => {
    if (!activeChat || !activeContact) return;
    const chatId = useAppStore
      .getState()
      .ensureChatForContact(activeContact.id, accountId);
    if (!chatId) return;
    setSelectedChat(chatId, accountId);
    const acc = (settings.waAccounts || []).find((a) => a.id === accountId);
    const accIdx =
      Math.max(
        0,
        (settings.waAccounts || []).findIndex((a) => a.id === accountId)
      ) + 1 || 1;
    pushToast(
      `将通过 ${formatAccountDisplay({
        label: acc?.label,
        userName: acc?.userName,
        index1: accIdx,
      })} 发送`,
      "success"
    );
  };

  const activeFollowUp = useMemo(
    () =>
      followUps
        .filter((item) => item.contactId === selectedContactId && !item.done)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0],
    [followUps, selectedContactId]
  );
  const activeWorkflow = activeContact
    ? workflowForStage(activeContact.stage)
    : null;
  const needsNameSearch =
    !isBaileys &&
    !!activeContact &&
    !!activeContact.name.trim() &&
    !resolveSendTarget({
      phone: activeContact.phone,
      channelAddress: activeContact.channelAddress,
      entityId: activeContact.id,
    });

  useOverlayContactCard({
    isBaileys,
    bridgeConnected,
    selectedChatId,
    selectedPhoneId,
    activeContact,
  });

  const {
    typingLabel: peerTypingLabel,
    subtitle: peerPresenceSubtitle,
    online: activePeerOnline,
  } = usePeerPresence({
    enabled: isBaileys,
    chatId: selectedChatId,
    contact: activeContact,
  });

  // 群聊发送者解析：内容不变时复用旧引用（避免联系人批量更新→全量重算新对象→
  // 击穿 MessageList memo → 底部 followOutput 滚动循环闪烁）。内容真正变化仍会更新。
  const senderCacheRef = useRef<{
    map: Record<string, ReturnType<typeof presentGroupSender>>;
  } | null>(null);
  const senderByMessageId = useMemo(() => {
    const isGroup = !!(activeContact?.isGroup || activeChat?.isGroup);
    if (!isGroup) {
      senderCacheRef.current = null;
      return EMPTY_SENDER_MAP;
    }
    const aid =
      chatAccountId ||
      activeContact?.accountId ||
      activeChat?.accountId ||
      "wa-default";
    const prevMap = senderCacheRef.current?.map;
    const map: Record<string, ReturnType<typeof presentGroupSender>> = {};
    const contactLookup = buildSenderContactLookup(contacts, aid);
    const memberLookup = buildSenderMemberLookup(groupMemberDetails);
    let anyChanged = false;
    const senderMessages =
      chatMessages.length > MESSAGE_INITIAL_RENDER_COUNT
        ? chatMessages.slice(-MESSAGE_INITIAL_RENDER_COUNT)
        : chatMessages;
    for (const m of senderMessages) {
      if (m.direction !== "in" || !m.isGroup) continue;
      const next = presentGroupSender(m, {
        accountId: aid,
        contacts,
        members: groupMemberDetails,
        contactLookup,
        memberLookup,
      });
      const prev = prevMap?.[m.id];
      if (prev && shallowSenderSame(prev, next)) {
        map[m.id] = prev;
      } else {
        map[m.id] = next;
        anyChanged = true;
      }
    }
    // 全部条目内容未变 → 复用整个旧 map 引用（MessageList memo 命中）
    if (!anyChanged && prevMap) {
      senderCacheRef.current = { map: prevMap };
      return prevMap;
    }
    senderCacheRef.current = { map };
    return map;
  }, [
    chatMessages,
    activeContact?.isGroup,
    activeChat?.isGroup,
    chatAccountId,
    activeContact?.accountId,
    activeChat?.accountId,
    contacts,
    groupMemberDetails,
  ]);

  const openGroupSenderDm = useEventCallback((m: Message) => {
      const aid =
        chatAccountId ||
        activeContact?.accountId ||
        activeChat?.accountId ||
        settings.liveBaileysAccountId ||
        settings.activeAccountId ||
        "wa-default";
      const presented =
        senderByMessageId[m.id] ||
        presentGroupSender(m, {
          accountId: aid,
          contacts: useAppStore.getState().contacts,
          members: groupMemberDetails,
        });
      if (!presented.dmTarget) {
        pushToast(t("chat.memberAddressUnknown"), "error");
        return;
      }
      const dm = openOrBuildDmContact(
        presented.dmTarget,
        useAppStore.getState().contacts
      );
      const state = useAppStore.getState();
      if (!state.contacts.some((c) => c.id === dm.id)) {
        const owner =
          dm.accountId ||
          dm.boundPhoneId ||
          aid ||
          "wa-default";
        const chatId = `bridge-chat-${dm.id}`;
        useAppStore.setState((s) => {
          const hasContact = s.contacts.some((c) => c.id === dm.id);
          const hasChat = s.chats.some(
            (c) =>
              c.contactId === dm.id &&
              (c.accountId || c.phoneId || owner) === owner
          );
          return {
            contacts: hasContact ? s.contacts : [...s.contacts, dm],
            chats: hasChat
              ? s.chats
              : [
                  {
                    id: chatId,
                    contactId: dm.id,
                    contactName: dm.name,
                    lastMessage: "",
                    unread: 0,
                    updatedAt: new Date().toISOString(),
                    phoneId: owner,
                    accountId: owner,
                  },
                  ...s.chats,
                ],
          };
        });
      }
      openContactWorkspace(dm.id);
      pushToast(`已打开与 ${dm.name || presented.label} 的私信`, "success");
  });

  // 切换会话关闭菜单 / 引用
  useEffect(() => {
    resetVoice();
    setMsgMenu(null);
    setReplyTo(null);
    resetSearch();
    setForwardMessage(null);
    resetSaved();
  }, [selectedChatId]);


  // 打开/切换会话：订阅对方 presence（协议只需订一次，勿多 JID 狂轰 + 45s 轮询）
  const presenceSubKey = [
    selectedChatId || "",
    selectedContactId || "",
    activeContact?.channelAddress || "",
    activeContact?.phone || "",
    chatConnected,
  ].join("|");

  useEffect(() => {
    if (!isBaileys || !selectedChatId) return;
    if (!chatConnected) return;
    const contact = activeContact;
    // 优先真实 jid，其次电话；不要把 phone 原串塞进 jids 列表重复订阅
    const jid =
      (contact?.channelAddress && contact.channelAddress.includes("@")
        ? contact.channelAddress
        : "") ||
      (contact?.phone
        ? `${contact.phone.replace(/\D/g, "")}@s.whatsapp.net`
        : "");
    if (!jid && !contact?.phone) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void baileysPresence("subscribe", {
        jid: jid || undefined,
        phoneE164: contact?.phone,
        channelAddress: contact?.channelAddress,
        subscribe: true,
        accountId: chatAccountId,
      }).catch(() => undefined);
    };

    // 立刻一次 + 800ms 补一次即可（chatstate 偶发要二次）；不再 45s 循环刷协议
    run();
    const t1 = window.setTimeout(run, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- presenceSubKey 已覆盖相关字段
  }, [isBaileys, presenceSubKey]);

  // 全局搜索 / 跟进跳转：虚拟列表定位 + 短暂高亮
  useEffect(() => {
    if (!focusMessageId || !selectedChatId) return;
    stickToBottomRef.current = false;
    let tries = 0;
    const tick = () => {
      const idx = chatMessages.findIndex((m) => m.id === focusMessageId);
      if (idx >= 0) {
        messageListRef.current?.scrollToMessage(focusMessageId, "smooth");
        window.setTimeout(() => setFocusMessageId(null), 2200);
        return;
      }
      if (++tries < 16) window.setTimeout(tick, 80);
      else setFocusMessageId(null);
    };
    window.setTimeout(tick, 40);
  }, [focusMessageId, selectedChatId, setFocusMessageId, chatMessages]);

  useEffect(() => {
    if (!msgMenu) return;
    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const close = () => setMsgMenu(null);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setMsgMenu(null);
      };
      const onPointer = (e: Event) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("[data-msg-context-menu]")) return;
        close();
      };
      window.addEventListener("pointerdown", onPointer, true);
      window.addEventListener("keydown", onKey);
      remove = () => {
        window.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("keydown", onKey);
      };
    }, 0);
    return () => {
      window.clearTimeout(timer);
      remove?.();
    };
  }, [msgMenu]);

  // 打开会话 / 新消息：滚到最新一条（底部）；虚拟列表用 imperative API
  useEffect(() => {
    const chatChanged = prevChatIdRef.current !== selectedChatId;
    if (chatChanged) {
      prevChatIdRef.current = selectedChatId;
      stickToBottomRef.current = true;
    }
    if (!stickToBottomRef.current && !chatChanged) return;

    const raf = requestAnimationFrame(() => {
      messageListRef.current?.scrollToBottom("auto");
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [selectedChatId]);

  const onAtBottomChange = useCallback((atBottom: boolean) => {
    stickToBottomRef.current = atBottom;
  }, []);

  const openMessageMenu = useCallback(
    (
      e: React.MouseEvent | React.PointerEvent,
      messageId: string,
      anchor?: DOMRect | null
    ) => {
      e.preventDefault();
      e.stopPropagation();
      let cx = "clientX" in e ? e.clientX : 0;
      let cy = "clientY" in e ? e.clientY : 0;
      if (anchor) {
        cx = anchor.left;
        cy = anchor.bottom + 4;
      }
      // ChatPanelMessageMenu measures its real height and flips/clamps after render.
      // Keep the original click point; a guessed menu height can push a tall menu
      // to the top of the viewport before the real positioning pass runs.
      setMsgMenu({ x: cx, y: cy, messageId });
    },
    []
  );

  const openImagePreview = useCallback((src: string, alt: string) => {
    setImagePreview({ src, alt });
  }, []);
  const closeImagePreview = useCallback(() => setImagePreview(null), []);

  const copyTextSafe = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(t("chat.copySuccess"), "success");
    } catch {
      pushToast(t("chat.copyFailed"), "error");
    }
  };

  /** 协议操作用 key：优先 waKey，否则用 id + 联系人地址拼 */
  const resolveMessageKey = (m: Message) =>
    resolveMessageKeyFrom(
      m,
      useAppStore.getState().contacts,
      selectedContactId
    );

  const editLatestMessage = useCallback(() => {
    if (!isBaileys || editingId) return false;
    const message = findLatestEditableOutgoingMessage(chatMessages);
    if (!message || !resolveMessageKey(message)) return false;
    setReplyTo(null);
    setEditingId(message.id);
    setDraftReply(message.body);
    pushToast(t("messageMenu.editHint"), "info");
    return true;
  }, [chatMessages, editingId, isBaileys, pushToast, selectedContactId, t]);

  const reloadMedia = async (m: Message, quiet = false) => {
    const sourceMessage = m.savedFromMessageId
      ? useAppStore.getState().messages.find((item) => item.id === m.savedFromMessageId) || m
      : m;
    return reloadMediaAction({
      message: m,
      sourceMessage,
      isBaileys,
      chatConnected,
      chatAccountId,
      activeContactName: activeContact?.name || "",
      mediaResyncAt: mediaResyncAtRef.current,
      mediaInFlight: mediaInFlightRef.current,
      setMediaBusyId,
      resolveMessageKey,
      updateMessageDelivery,
      pushToast,
      quiet,
    });
  };

  const handleToggleBlock = async () => {
    return toggleBlock({
      isBaileys,
      activeContact,
      chatAccountId,
      connected: chatConnected,
      settings: useAppStore.getState().settings,
      updateSettings,
      pushToast,
      requestConfirm,
      t,
    });
  };

  const blocked = (() => {
    if (!isBaileys || !activeContact || activeContact.isGroup) return false;
    if (activeChat?.isGroup) return false;
    return isJidBlocked(
      getAccountBlocklist(
        settings.blocklistByAccountId,
        chatAccountId ||
          settings.liveBaileysAccountId ||
          settings.activeAccountId ||
          "",
        settings.blocklistJids
      ),
      activeContact.channelAddress || activeContact.phone
    );
  })();

  /** 拉黑联系人后拦截一切出站（文本/媒体/商品/语音/转发），提示先取消拉黑 */
  const guardBlockedSend = useCallback(() => {
    if (!blocked) return true;
    pushToast(t("chat.blockedSend"), "error");
    return false;
  }, [blocked, pushToast]);

  const {
    sendText,
  } = useTextSend({
    sending,
    setSending,
    guardBlockedSend,
    editingId,
    setEditingId,
    chatMessages,
    chatConnected,
    chatAccountId,
    setDraftReply,
    replyTo,
    setReplyTo,
    pushToast,
    stickToBottom: () => {
      stickToBottomRef.current = true;
    },
    activeContact,
    activeChat,
    isBaileys,
    selectedChatId,
    selectedContactId,
    updateContact,
    accountConnecting:
      chatConnection === "connecting" ||
      chatConnection === "reconnecting" ||
      chatConnection === "starting" ||
      chatConnection === "close",
    needsScan:
      chatConnection === "qr" ||
      chatConnection === "logged_out" ||
      (chatAccountId === settings.liveBaileysAccountId && baileysUi.hasQr),
    channelId,
    selectedPhoneId,
    enqueueOutgoingMessage,
    patchMessage,
    updateMessageDelivery,
    mentionTrackerRef,
    groupMembers,
    setBaileysLoginOpen,
  });

  const retryMessage = async (id: string) => {
    const message =
      chatMessages.find((item) => item.id === id) ||
      useAppStore.getState().messages.find((item) => item.id === id);
    return retryMessageAction({
      id,
      message,
      isBaileys,
      chatConnected,
      chatAccountId,
      setMediaBusyId,
      updateMessageDelivery,
      pushToast,
    });
  };

  const retryMessageRef = useRef(retryMessage);
  retryMessageRef.current = retryMessage;
  const reloadMediaRef = useRef(reloadMedia);
  reloadMediaRef.current = reloadMedia;
  const onRetryMessage = useCallback((id: string) => {
    void retryMessageRef.current(id);
  }, []);
  const onReloadMediaStable = useCallback((m: Message, quiet = false) => {
    void reloadMediaRef.current(m, quiet);
  }, []);

  const resolveRecipient = () => {
    const contact = activeContact;
    if (!contact) return { contact: null, recipient: "" };
    const recipient = resolveSendTarget({
      phone: contact.phone,
      channelAddress: isBaileys ? contact.channelAddress : undefined,
      jid: isBaileys ? contact.channelAddress : undefined,
      entityId:
        (isBaileys && (contact.id || selectedChatId || selectedContactId)) ||
        undefined,
    });
    return { contact, recipient };
  };

  const openScheduledMessageDialog = () => {
    const { contact, recipient } = resolveRecipient();
    if (!activeChat || !contact || !recipient) {
      pushToast(t("chat.noSendAddress"), "error");
      return;
    }
    setScheduledMessageDialogOpen(true);
  };

  const submitScheduledMessage = (dueAt: string, text: string) => {
    const { contact, recipient } = resolveRecipient();
    if (!activeChat || !contact || !recipient) {
      pushToast(t("chat.noSendAddress"), "error");
      return;
    }
    const id = scheduleMessage({
      chatId: activeChat.id,
      contactId: contact.id,
      contactName: contact.name || activeChat.contactName,
      recipient,
      text,
      dueAt,
      channelId,
      deviceId: selectedPhoneId,
      accountId: chatAccountId,
    });
    if (!id) return;
    setScheduledMessageDialogOpen(false);
    setDraftReply("");
    pushToast(t("chat.scheduleSaved"), "success");
  };

  const {
    catalogOpen,
    setCatalogOpen,
    catalogManageOpen,
    setCatalogManageOpen,
    catalogLoading,
    products,
    refreshCatalog,
    openCatalog,
    openProductManager,
    handleSendProduct,
  } = useCatalog({
    isBaileys,
    chatConnected,
    chatAccountId,
    channelId,
    selectedPhoneId,
    setSending,
    enqueueOutgoingMessage,
    patchMessage,
    pushToast,
    resolveRecipient,
    guardBlockedSend,
  });

  const handleSendContactCard = async (sharedContact: Contact) => {
    if (!guardBlockedSend()) return;
    if (!isBaileys) {
      // 当前通道不支持联系人名片：提示文案由 i18n 提供。
      pushToast(t("chat.contactUnsupported"), "error");
      return;
    }
    const { contact, recipient } = resolveRecipient();
    if (!contact || !recipient || !chatConnected) {
      pushToast(t("chat.connectFirst"), "error");
      return;
    }
    const digits = sharedContact.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      pushToast(t("chat.invalidContactPhone"), "error");
      return;
    }
    setSending(true);
    try {
      const displayName = sharedContact.name.trim() || `+${digits}`;
      const phoneE164 = `+${digits}`;
      const raw = await gatedMediaSend(
        { phoneE164: recipient, accountId: chatAccountId },
        () =>
          baileysSendContact(
            recipient,
            { displayName, phoneE164 },
            chatAccountId
          )
      );
      const msgId = enqueueOutgoingMessage({
        body: `[名片] ${displayName}`,
        phoneE164: recipient,
        contactId: contact.id,
        channelId,
        deviceId: selectedPhoneId,
        accountId: chatAccountId,
        deliveryStatus: "sent",
      });
      if (msgId) {
        patchMessage(msgId, {
          mediaType: "contact",
          contactCard: { displayName, phoneE164 },
          waMessageId: raw.id,
          waKey:
            raw.id && raw.jid
              ? { id: raw.id, remoteJid: raw.jid, fromMe: true }
              : undefined,
        });
      }
      setContactPickerOpen(false);
      pushToast(t("chat.contactSent"), "success");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : t("chat.contactSendFailed"),
        "error"
      );
    } finally {
      setSending(false);
    }
  };

  const openAndroidMediaShare = async (
    file: File,
    dataUrl: string,
    caption: string,
    phoneE164: string
  ) => {
    return openAndroidMediaShareAction({
      file,
      dataUrl,
      caption,
      phoneE164,
      selectedPhoneId,
    });
  };

  const {
    sendFile,
    sendAudio,
    sendImage,
    sendRecentSticker,
    sendGif,
  } = useMediaSend({
    sending,
    setSending,
    guardBlockedSend,
    stickToBottom: () => {
      stickToBottomRef.current = true;
    },
    resolveRecipient,
    pushToast,
    isBaileys,
    chatConnected,
    setBaileysLoginOpen,
    setDraftReply,
    enqueueOutgoingMessage,
    patchMessage,
    updateMessageDelivery,
    channelId,
    selectedPhoneId,
    chatAccountId,
    openAndroidMediaShare,
    toStickerDataUrl: imageToStickerDataUrl,
  });

  const stickerFavoriteActions = createStickerFavoriteActions({
    favoriteStickers,
    setFavoriteStickers,
    toStickerDataUrl: imageToStickerDataUrl,
    pushToast,
  });
  const toggleFavoriteSticker = stickerFavoriteActions.toggle;
  const removeFavoriteSticker = stickerFavoriteActions.remove;

  const handleSearchContact = async () => {
    return searchContact({
      activeContact,
      searchingContact,
      bridgeConnected,
      selectedPhoneId,
      setSearchingContact,
      pushToast,
    });
  };

  const handleMarkUnread = async () => {
    if (!activeChat) return;
    let remoteOk = !isBaileys;
    const { recipient } = resolveRecipient();
    if (isBaileys && chatConnected && recipient) {
      try {
        await baileysChatModify(
          "markUnread",
          {
            jid: recipient.includes("@") ? recipient : undefined,
            phoneE164: recipient.includes("@") ? undefined : recipient,
            channelAddress: activeContact?.channelAddress,
            accountId: chatAccountId,
          }
        );
        remoteOk = true;
      } catch {
        remoteOk = false;
      }
    }
    markChatUnreadLocal(activeChat.id, 1);
    pushToast(
      remoteOk ? t("chat.markedUnread") : t("chat.markedUnreadLocal"),
      remoteOk ? "success" : "info"
    );
  };

  const handleChatPreference = async (
    action: "pin" | "unpin" | "mute" | "unmute",
    durationMs?: number
  ) => {
    if (!activeChat) return;
    const { recipient } = resolveRecipient();
    await applyChatPreference({
      action,
      chat: activeChat,
      target: {
        jid: recipient.includes("@") ? recipient : undefined,
        phoneE164: recipient && !recipient.includes("@") ? recipient : undefined,
        channelAddress: activeContact?.channelAddress,
        accountId: chatAccountId,
      },
      isBaileys,
      connected: chatConnected,
      durationMs,
      patchChat,
      pushToast,
    });
  };

  const composerOnSend = useEventCallback(sendText);
  const composerOnSendImage = useEventCallback((file: File, caption?: string) =>
    sendImage(file, false, caption)
  );
  const composerOnSendSticker = useEventCallback((file: File) =>
    sendImage(file, true)
  );
  const composerOnSendGif = useEventCallback(sendGif);
  const composerOnSendRecentSticker = useEventCallback(sendRecentSticker);
  const composerOnRemoveFavoriteSticker = useEventCallback(removeFavoriteSticker);
  const composerOnSendFile = useEventCallback(sendFile);
  const composerOnSendAudio = useEventCallback(sendAudio);
  const composerOnOpenCatalog = useEventCallback(openCatalog);
  const composerOnOpenContactPicker = useEventCallback(() =>
    setContactPickerOpen(true)
  );
  const {
    recording,
    voicePaused,
    recordSec,
    beginVoice,
    toggleVoicePause,
    endVoice,
    readVoiceLevel,
    resetVoice,
  } = useVoiceRecording({
    isBaileys,
    sending,
    chatConnected,
    pushToast,
    setBaileysLoginOpen,
    setSending,
    resolveRecipient,
    channelId,
    selectedPhoneId,
    chatAccountId,
    enqueueOutgoingMessage,
    patchMessage,
    updateMessageDelivery,
    guardBlockedSend,
    stickToBottom: () => {
      stickToBottomRef.current = true;
    },
  });
  const composerOnBeginVoice = useEventCallback(beginVoice);
  const composerReadVoiceLevel = useEventCallback(readVoiceLevel);
  const composerOnToggleVoicePause = useEventCallback(toggleVoicePause);
  const composerOnEndVoice = useEventCallback(endVoice);
  const composerResolvePresenceTarget = useEventCallback(() => {
    const { recipient } = resolveRecipient();
    if (!recipient) return null;
    return {
      phoneE164: recipient.includes("@") ? undefined : recipient,
      jid: recipient.includes("@") ? recipient : undefined,
      channelAddress: recipient.includes("@") ? recipient : undefined,
      accountId: chatAccountId,
    };
  });

  if (!selectedChatId || !activeChat) {
    return (
      <main className="flex min-w-0 flex-1 bg-zinc-950">
        <ChatWelcome />
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 bg-zinc-950">
      {/* 对话 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatPanelHeader
          activeChat={activeChat}
          activeContact={activeContact}
          activePeerOnline={activePeerOnline}
          peerTypingLabel={peerTypingLabel}
          peerPresenceSubtitle={peerPresenceSubtitle}
          localOnlyChat={localOnlyChat}
          isBaileys={isBaileys}
          chatConnected={chatConnected}
          chatAccount={chatAccount}
          chatAccountId={chatAccountId}
          settings={settings}
          baileysUi={baileysUi}
          activePhone={activePhone}
          activeFollowUp={activeFollowUp}
          followUpTitle={activeWorkflow?.followUpTitle}
          menuOpen={headerMenuOpen}
          exportingChat={exportingChat}
          searchingContact={searchingContact}
          needsNameSearch={needsNameSearch}
          showScreen={showScreen}
          headerMenuRef={headerMenuRef}
          onToggleSearch={() => {
            if (chatSearchOpen) {
              setChatSearchQuery("");
              setFocusMessageId(null);
            }
            setChatSearchOpen((open) => !open);
          }}
          onToggleMenu={() => setHeaderMenuOpen((v) => !v)}
          onCloseMenu={() => setHeaderMenuOpen(false)}
          onOpenGroupInfo={() => setShowGroupInfo(true)}
          onOpenCrmProfile={() => {
            if (activeContact) {
              setSelectedContact(activeContact.id);
              // 一次性标记：客户库挂载后定位到该客户并打开详情，
              // 避免 quickFilter 过滤 + 看板详情默认收起导致「跳过去一片空白」。
              useAppStore.setState({ crmFocusContactId: activeContact.id });
              setActiveNav("crm");
            }
          }}
          onSaveContact={() => void handleSaveContact()}
          onOpenSearch={() => {
            if (chatSearchOpen) {
              setChatSearchQuery("");
              setFocusMessageId(null);
            }
            setChatSearchOpen(true);
          }}
          onExportChat={() => void exportChat()}
          onMarkUnread={() => void handleMarkUnread()}
          onTogglePin={() =>
            void handleChatPreference(activeChat.pinned ? "unpin" : "pin")
          }
          onMute={(durationMs) =>
            void handleChatPreference("mute", durationMs)
          }
          onUnmute={() => void handleChatPreference("unmute")}
          onCreateFollowUp={() => setFollowUpDialogOpen(true)}
          onScheduleMessage={openScheduledMessageDialog}
          onOpenMedia={() => setMediaPanelOpen(true)}
          onOpenNote={() => setNoteOpenRequest((value) => value + 1)}
          onToggleBlock={() => void handleToggleBlock()}
          onSearchContact={handleSearchContact}
          onToggleScreen={() => setShowScreen((v) => !v)}
        />

        <div className="flex min-h-0 flex-1">
        {showScreen && (
          <aside className="flex w-72 shrink-0 items-center justify-center overflow-hidden border-r border-zinc-800/90 bg-black">
            {screenUrl ? (
              <img
                src={screenUrl}
                alt={t("chat.phoneScreenAlt")}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="text-center text-2xs text-zinc-500">
                <Loader2 className="mx-auto mb-1.5 h-6 w-6 animate-spin opacity-50" />
                {screenError || t("chat.screenLoading")}
              </div>
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col" data-chat-surface>
        {(activeContact || activeChat) && !activeChat?.localOnly && !activeContact?.isGroup && !activeChat?.isGroup && (
          <ChatInternalNoteBar
            chatId={selectedChatId}
            contactId={selectedContactId}
            openRequest={noteOpenRequest}
          />
        )}
        {chatSearchOpen && (
          <ChatSearchBar
            query={chatSearchQuery}
            matchCount={chatSearchMatches.length}
            activeIndex={chatSearchIndex}
            onChange={setChatSearchQuery}
            onPrevious={() => showSearchMatch(chatSearchIndex - 1)}
            onNext={() => showSearchMatch(chatSearchIndex + 1)}
            onClose={() => {
              setChatSearchOpen(false);
              setChatSearchQuery("");
              setFocusMessageId(null);
            }}
          />
        )}
        {blocked && (
          <div
            className="flex items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2"
            role="note"
          >
            <Ban className="h-3.5 w-3.5 shrink-0 text-rose-300" />
            <span className="min-w-0 flex-1 text-[11px] leading-4 text-rose-200">
              该联系人已被拉黑，对方无法向你发送消息。
            </span>
            <button
              type="button"
              onClick={() => void handleToggleBlock()}
              className="shrink-0 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/25"
            >
              取消拉黑
            </button>
          </div>
        )}
        {localOnlyChat && (
          <SavedMessageToolbar
            filter={savedFilter}
            onFilterChange={setSavedFilter}
            tagFilter={savedTagFilter}
            onTagFilterChange={setSavedTagFilter}
            tags={savedTags}
            selectMode={savedSelectMode}
            selectedCount={savedSelectedIds.size}
            onToggleSelectMode={() => {
              setSavedSelectMode((current) => !current);
              setSavedSelectedIds(new Set());
            }}
            onSelectAll={() => setSavedSelectedIds(new Set(savedVisibleIds))}
            onPinSelected={() => {
              setSavedMessagesPinned([...savedSelectedIds], true);
              clearSavedSelection();
            }}
            onDeleteSelected={() => {
              deleteSavedMessages([...savedSelectedIds]);
              clearSavedSelection();
            }}
          />
        )}
        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden",
            !chatBgStyle && "chat-canvas bg-zinc-950"
          )}
          style={chatBgStyle}
        >
          {chatBgStyle && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 bg-black/30"
            />
          )}
          <div className="relative z-[1] flex h-full min-h-0 flex-col">
            <MessageList
              ref={messageListRef}
              chatId={selectedChatId}
              messages={savedVisibleMessages}
              focusMessageId={focusMessageId}
              menuMessageId={msgMenu?.messageId}
              mediaBusyId={mediaBusyId}
              transcribingId={transcribingId}
              translatingId={translatingId}
              senderByMessageId={senderByMessageId}
              onAtBottomChange={onAtBottomChange}
              onOpenMenu={openMessageMenu}
              onRetry={onRetryMessage}
              onReloadMedia={onReloadMediaStable}
              onTranscribe={transcribe}
              onTranslate={translate}
              onPreview={openImagePreview}
              selectable={localOnlyChat && savedSelectMode}
              selectedMessageIds={savedSelectedIds}
              onToggleSelect={toggleSavedSelection}
              onSenderClick={
                activeContact?.isGroup || activeChat?.isGroup
                  ? openGroupSenderDm
                  : undefined
              }
              onQuoteClick={(messageId) =>
                messageListRef.current?.scrollToMessage(messageId, "smooth")
              }
              onLoadOlderFromDisk={loadOlderFromDisk}
            />
          </div>
        </div>

        {/* 多号同一客户：切换条 + 撞单提示 */}
        {!localOnlyChat && <PersonMultiAccountPanel
          variant="banner"
          seed={activeContact}
          contacts={contacts}
          chats={chats}
          selectedContactId={selectedContactId}
          selectedChatId={selectedChatId}
          focusAccountId={chatAccountId}
          waAccounts={settings.waAccounts}
          liveBaileysAccountId={settings.liveBaileysAccountId}
          liveConnection={baileysUi.connection}
          onOpenThread={switchSiblingThread}
          onSelectStartAccount={isBaileys ? selectStartAccount : undefined}
        />}

        {localOnlyChat ? (
          <form
            className="flex items-center gap-2 border-t border-zinc-800/90 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const body = savedDraft.trim();
              if (!body) return;
              enqueueOutgoingMessage({
                body,
                chatId: SAVED_MESSAGES_CHAT_ID,
                contactId: "",
                channelId: "local",
                deliveryStatus: "sent",
              });
              setSavedDraft("");
            }}
          >
            <input
              value={savedDraft}
              onChange={(event) => setSavedDraft(event.target.value)}
              placeholder={t("chat.selfDraft")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-brand/60"
              aria-label={t("tooltip.selfMessage")}
            />
            <Button
              type="submit"
              variant="primary"
              className="!h-9 !min-h-9 !w-9 rounded-lg !px-0"
              disabled={!savedDraft.trim()}
              aria-label={t("tooltip.selfMessage")}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>
        ) : <Composer
          resetKey={selectedChatId}
          setDraftReply={setDraftReply}
          sending={sending}
          isBaileys={isBaileys}
          baileysConnected={chatConnected}
          activeContact={activeContact}
          lastInboundBody={lastInboundBody}
          updateContact={updateContact}
          pushToast={pushToast}
          editingId={editingId}
          setEditingId={setEditingId}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          recording={recording}
          voicePaused={voicePaused}
          recordSec={recordSec}
          onSend={composerOnSend}
          onEditLatest={editLatestMessage}
          onSendImage={composerOnSendImage}
          onSendSticker={composerOnSendSticker}
          onSendGif={composerOnSendGif}
          recentStickers={recentStickers}
          onSendRecentSticker={composerOnSendRecentSticker}
          favoriteStickers={favoriteStickers}
          onRemoveFavoriteSticker={composerOnRemoveFavoriteSticker}
          onSendAudio={composerOnSendAudio}
          onSendFile={composerOnSendFile}
          onOpenCatalog={composerOnOpenCatalog}
          onOpenContactPicker={composerOnOpenContactPicker}
          onBeginVoice={composerOnBeginVoice}
          readVoiceLevel={composerReadVoiceLevel}
          onToggleVoicePause={composerOnToggleVoicePause}
          onEndVoice={composerOnEndVoice}
          resolvePresenceTarget={composerResolvePresenceTarget}
          groupMembers={
            activeContact?.isGroup || activeChat?.isGroup
              ? groupMembers
              : EMPTY_GROUP_MEMBERS
          }
          mentionTrackerRef={mentionTrackerRef}
        />}
        </div>
        </div>
      </div>
      {catalogOpen && (
        <ProductPicker
          products={products}
          loading={catalogLoading}
          onClose={() => setCatalogOpen(false)}
          onRefresh={() => void refreshCatalog()}
          onSend={handleSendProduct}
          onManageProducts={openProductManager}
        />
      )}
      {catalogManageOpen && (
        <ProductManager
          products={products}
          loading={catalogLoading}
          accountId={chatAccountId}
          onClose={() => setCatalogManageOpen(false)}
          onRefresh={refreshCatalog}
        />
      )}
      {contactPickerOpen && (
        <ContactCardPicker
          contacts={useAppStore.getState().contacts}
          sending={sending}
          onClose={() => setContactPickerOpen(false)}
          onSend={handleSendContactCard}
        />
      )}
      {msgMenu && (
        <ChatPanelMessageMenu
          menu={msgMenu}
          chatMessages={chatMessages}
          favoriteStickers={favoriteStickers}
          mediaBusyId={mediaBusyId}
          isBaileys={isBaileys}
          chatAccountId={chatAccountId}
          chatConnected={chatConnected}
          replyTo={replyTo}
          onClose={() => setMsgMenu(null)}
          onCopy={copyTextSafe}
          onReload={reloadMedia}
          onToggleSticker={toggleFavoriteSticker}
          onRetry={onRetryMessage}
          setEditingId={setEditingId}
          setReplyTo={setReplyTo}
          setDraftReply={setDraftReply}
          onForward={setForwardMessage}
        />
      )}
      {forwardMessage && (
        <ForwardMessageModal
          preview={messagePlainText(forwardMessage)}
          targets={forwardTargets}
          sending={forwardSending}
          onClose={() => setForwardMessage(null)}
          onSend={handleForwardMessage}
        />
      )}
      {followUpDialogOpen && activeContact && (
        <ChatFollowUpDialog
          contactName={activeContact.name}
          initialDueAt={activeFollowUp?.dueAt}
          initialNote={activeFollowUp?.note}
          onClose={() => setFollowUpDialogOpen(false)}
          onSubmit={(dueAt, note) => {
            const result = scheduleFollowUp(activeContact.id, dueAt, note || undefined);
            if (!result) return;
            setFollowUpDialogOpen(false);
            pushToast(activeFollowUp ? t("chat.followUpUpdated") : t("chat.followUpCreated"), "success");
          }}
        />
      )}
      {scheduledMessageDialogOpen && activeContact && activeChat && (
        <ChatScheduledMessageDialog
          contactName={activeContact.name || activeChat.contactName}
          initialText={useAppStore.getState().draftReply}
          onClose={() => setScheduledMessageDialogOpen(false)}
          onSubmit={submitScheduledMessage}
        />
      )}
      {saveContactDialog && (
        <SaveContactDialog
          phone={saveContactDialog.phone}
          initialName={saveContactDialog.initialName}
          saving={savingContact}
          onClose={() => setSaveContactDialog(null)}
          onSave={(name) => void confirmSaveContact(name)}
        />
      )}
      {mediaPanelOpen && (
        <ChatMediaPanel
          chatId={activeChat.id}
          title={displayContactLabel(
            activeContact?.name || activeChat.contactName,
            activeContact?.phone,
            activeContact?.channelAddress,
            activeChat.lastMessage,
            { isGroup: !!(activeContact?.isGroup || activeChat.isGroup) }
          )}
          memoryMessages={chatMessages}
          onClose={() => setMediaPanelOpen(false)}
          onPreviewImage={(src, alt) => {
            setMediaPanelOpen(false);
            setImagePreview({ src, alt });
          }}
        />
      )}
      {imagePreview && (
        <ImagePreviewDialog
          preview={imagePreview}
          onClose={closeImagePreview}
        />
      )}

      <GroupInfoPanel
        open={showGroupInfo && !!(activeContact?.isGroup || activeChat?.isGroup)}
        onClose={closeGroupInfo}
        contact={activeContact}
        accountId={chatAccountId}
        groupJid={
          activeContact?.channelAddress?.includes("@g.us")
            ? activeContact.channelAddress
            : undefined
        }
        onLeftGroup={() => {
          const leftContactId = activeContact?.id;
          closeGroupInfo();
          if (selectedChatId) deleteChatLocal(selectedChatId, { clearMessages: true });
          if (leftContactId) deleteContactLocal(leftContactId);
          setSelectedChat(null);
          setSelectedContact(null);
        }}
      />
    </main>
  );
}
