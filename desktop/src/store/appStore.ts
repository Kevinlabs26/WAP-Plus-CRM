import { create } from "zustand";
import type { AppState, AppSettings, SliceContext } from "./types";
import { calcStats } from "./calcStats";
import { defaultSettings } from "./settingsDefaults";
import { createUiSlice } from "./uiSlice";
import { createMessageActionsSlice } from "./messageActionsSlice";
import { createIngestSlice } from "./ingestSlice";
import { createSettingsActionsSlice } from "./settingsActionsSlice";
import { createBootSlice } from "./bootSlice";
import { createSavedMessagesSlice } from "./savedMessagesSlice";
import { createBroadcastSlice } from "./broadcastSlice";
import { createActionMixins } from "./actionMixins";
import type { Message } from "@/types/crm";

export const useAppStore = create<AppState>((set, get) => {
  const ctx: SliceContext = { set, get };
  const mixins = createActionMixins(ctx);

  return {
    phones: [],
    contacts: [],
    chats: [],
    messages: [],
    followUps: [],
    scheduledMessages: [],
    activities: [],
    settings: defaultSettings as AppSettings,
    broadcastCampaigns: [],
    stats: calcStats([], [], [], []),
    selectedPhoneId: null,
    selectedContactId: null,
    selectedChatId: null,
    selectedThreadAccount: null,
    crmFocusContactId: null,
    aiSuggestions: [],
    draftReply: "",
    draftReplyByChatId: {},
    activeNav: "chats",
    settingsOpen: false,
    updateAvailableVersion: null,
    settingsCategory: "connection",
    commandOpen: false,
    baileysLoginOpen: false,
    focusMessageId: null,
    baileysUi: {
      connection: "starting",
      userName: null,
      hasQr: false,
      labelsByAccountId: {},
      chatLabelIdsByAccountId: {},
    },
    peerPresenceByKey: {},
    crmPanelCollapsed: true,
    crmPanelTab: "customer",
    chatListFilter: "all",
    toasts: [],
    confirmDialog: null,
    bridge: {
      connected: false,
      host: "127.0.0.1",
      port: 17890,
      deviceName: null,
      transport: null,
      lastError: null,
      tauriUnavailable: false,
      updatedAt: 0,
    },
    messagesByChatId: {},
    unreadHoldUntilByChatId: {},
    hydrated: false,
    uiReady: false,

    ...createUiSlice(ctx),
    ...createMessageActionsSlice(ctx),
    ...createIngestSlice(ctx),
    ...createSettingsActionsSlice(ctx),
    ...createBootSlice(ctx),
    ...createSavedMessagesSlice(ctx),
    ...createBroadcastSlice(ctx),

    ...mixins.activityActions,
    ...mixins.contactActions,
    ...mixins.contactCreationActions,
    ...mixins.followUpActions,
    ...mixins.chatFolderActions,
    ...mixins.contactWorkspaceActions,
    ...mixins.savedMessageMetadataActions,
    ...mixins.saveMessageAction,
    ...mixins.contactMergeActions,
  };
});

// 按 chatId 维护消息索引（多账号面板只读轮询用）。
// 增量维护：常态（消息尾部新增）只对受影响 bucket 追加并换新数组引用，
// 未变 bucket 复用原引用 → ChatPanel 的 selectChatMessages 引用缓存不被击穿。
// 仅当长度不变/缩小（enrich 原地替换、删除）时回退全量重建，保证正确性。
let lastIndexedMessages: Message[] | null = null;
let lastIndexByChat: Record<string, Message[]> | null = null;

useAppStore.subscribe((state, prev) => {
  if (state.messages === prev.messages) return;
  const next = state.messages;
  const lastLen = lastIndexedMessages?.length ?? -1;
  // 纯追加预检：完整逐项比较前段引用。
  // 不能用首尾采样/近似——ingest 常「原地替换(enrich/ack) + 尾部追加」混合，
  // 近似判断会把替换吞掉 → 消息显示不全。正确性优先。
  const pureAppend =
    lastIndexedMessages !== null &&
    lastIndexByChat !== null &&
    next.length > lastLen &&
    (() => {
      let i = 0;
      for (; i < lastLen; i++) {
        if (next[i] !== lastIndexedMessages![i]) return false;
      }
      return true;
    })();
  if (pureAppend) {
    const added = next.slice(lastLen);
    const index = { ...lastIndexByChat! };
    let touched = false;
    for (const m of added) {
      if (!m.chatId) continue;
      const prevBucket = index[m.chatId];
      const bucket = prevBucket ? [...prevBucket, m] : [m];
      if (bucket.length > 1) {
        const a = bucket[bucket.length - 2];
        const b = bucket[bucket.length - 1];
        if ((a.sentAt || "") > (b.sentAt || "")) {
          bucket.sort((x, y) =>
            (x.sentAt || "").localeCompare(y.sentAt || "")
          );
        }
      }
      index[m.chatId] = bucket;
      touched = true;
    }
    if (touched) {
      lastIndexedMessages = next;
      lastIndexByChat = index;
      useAppStore.setState({ messagesByChatId: index });
      return;
    }
  }
  const index: Record<string, Message[]> = {};
  for (const m of next) {
    if (!m.chatId) continue;
    (index[m.chatId] ||= []).push(m);
  }
  // 顺序由增量分支维护（append 已排序）；仅首次建索引时需要 sort
  if (lastIndexedMessages === null) {
    for (const k of Object.keys(index))
      index[k].sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
  }
  lastIndexedMessages = next;
  lastIndexByChat = index;
  useAppStore.setState({ messagesByChatId: index });
});

export { flushPersist } from "./persist";

export type {
  AppState,
  AppSettings,
  NavId,
  ChatListFilter,
  ToastTone,
  ToastItem,
  ConfirmTone,
  ConfirmRequest,
  BridgeRuntime,
  QuickReply,
  ChatFolder,
  ChatFolderClone,
  SalesStage,
} from "./types";
