import { gateConfigFromRuntime, sendRuntimeFromSettings } from "@/channels";
import { setSendGateConfigProvider } from "@/channels/sendGate";
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
import { updateMessageIndex } from "./messageIndex";
import { persist } from "./persist";

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

setSendGateConfigProvider(() => {
  const state = useAppStore.getState();
  return gateConfigFromRuntime(sendRuntimeFromSettings(state.settings, state.messages));
});

// 所有草稿入口（输入、AI、跨号窗口及发送清理）共用既有数据库落盘。
useAppStore.subscribe((state, prev) => {
  if (state.hydrated && state.draftReplyByChatId !== prev.draftReplyByChatId) {
    persist(() => useAppStore.getState());
  }
});

useAppStore.subscribe((state, prev) => {
  if (state.messages === prev.messages) return;
  const index = updateMessageIndex(state.messages, state.messagesByChatId);
  if (index !== state.messagesByChatId) useAppStore.setState({ messagesByChatId: index });
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
