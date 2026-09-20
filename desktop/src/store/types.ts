import type { StoreApi } from "zustand";
import type {
  Activity,
  ActivityKind,
  AiSuggestion,
  ChatPreview,
  Contact,
  DashboardStats,
  FollowUp,
  Message,
  PhoneDevice,
  SalesStage,
  ScheduledMessage,
  WaMessageKey,
  WhatsAppLabel,
} from "@/types/crm";
import type { QuickReplyCategory } from "@/lib/quickReplies";
import type { BridgeEvent } from "@/lib/bridge";
import type {
  BroadcastCampaign,
  BroadcastItem,
} from "@/types/broadcast";
import type { PeerPresenceEntry } from "./presenceIngest";
import type {
  SettingsChatFolder,
  SettingsChatFolderClone,
  SettingsShape,
} from "./settingsDefaults";

export type NavId =
  | "phones"
  | "chats"
  | "crm"
  | "stats"
  | "today"
  | "broadcast"
  | "starred"
  | "monitor";
export type ChatListFilter = "all" | "unread" | "today" | "leads";

export type ToastTone = "info" | "success" | "error";
export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  /** 有标题时渲染为右下角的结构化业务通知。 */
  title?: string;
  dedupeKey?: string;
  onClick?: () => void;
}

export type ToastOptions = Pick<
  ToastItem,
  "title" | "dedupeKey" | "onClick"
> & { durationMs?: number };

export type ConfirmTone = "default" | "danger";
export interface ConfirmRequest {
  id: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  resolve: (ok: boolean) => void;
}

/** 运行时 Bridge 连接快照（不持久化） */
export interface BridgeRuntime {
  connected: boolean;
  host: string;
  port: number;
  deviceName: string | null;
  transport: string | null;
  lastError: string | null;
  /** 浏览器预览无 Tauri */
  tauriUnavailable: boolean;
  updatedAt: number;
}

export interface QuickReply {
  id: string;
  title: string;
  body: string;
  category: QuickReplyCategory;
}

export type ChatFolder = SettingsChatFolder;
export type ChatFolderClone = SettingsChatFolderClone;

/** 与 settingsDefaults.SettingsShape 对齐（含黑名单/跟进规则等） */
export type AppSettings = SettingsShape;

export interface PersistSlice {
  phones: PhoneDevice[];
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  scheduledMessages: ScheduledMessage[];
  activities: Activity[];
  settings: AppSettings;
  broadcastCampaigns: BroadcastCampaign[];
}

/** 各 slice 工厂共用的 set/get 上下文（zustand create 内部传入） */
export interface SliceContext {
  set: StoreApi<AppState>["setState"];
  get: () => AppState;
}

export interface AppState extends PersistSlice {
  stats: DashboardStats;
  selectedPhoneId: string | null;
  selectedContactId: string | null;
  selectedChatId: string | null;
  selectedThreadAccount: { chatId: string; accountId: string } | null;
  /** 聊天右上角「客户资料」跳转时，客户库定位到该联系人（一次性，消费后清空） */
  crmFocusContactId: string | null;
  aiSuggestions: AiSuggestion[];
  draftReply: string;
  draftReplyByChatId: Record<string, string>;
  activeNav: NavId;
  settingsOpen: boolean;
  /** 启动检查发现的新版本（仅运行时，用于设置按钮角标） */
  updateAvailableVersion: string | null;
  commandOpen: boolean;
  /** 顶栏 WhatsApp 扫码小弹窗 */
  baileysLoginOpen: boolean;
  /** 顶栏展示用的 Baileys 连接摘要 */
  baileysUi: {
    connection: string;
    userName: string | null;
    hasQr: boolean;
    labelsByAccountId: Record<string, WhatsAppLabel[]>;
    chatLabelIdsByAccountId: Record<string, Record<string, string[]>>;
  };
  /**
   * 对方 presence：key = chatId / contactId / channelAddress / phone
   * presence: composing | recording | available | unavailable（paused 只清输入）
   * lastSeen: 毫秒时间戳（对方关闭在线时可能没有）
   */
  peerPresenceByKey: Record<string, PeerPresenceEntry>;
  /** 聊天页右侧客户工作台是否收起 */
  crmPanelCollapsed: boolean;
  /** 客户工作台当前页签 */
  crmPanelTab: "customer" | "quick-replies";
  chatListFilter: ChatListFilter;
  toasts: ToastItem[];
  /** 应用内确认框（替代 window.confirm） */
  confirmDialog: ConfirmRequest | null;
  bridge: BridgeRuntime;
  hydrated: boolean;
  /** UI 主界面是否就绪（boot 完成后为 true）；未就绪时门控自动行为 */
  uiReady: boolean;
  messagesByChatId: Record<string, Message[]>;
  unreadHoldUntilByChatId: Record<string, number>;

  setSelectedPhone: (id: string | null) => void;
  setUiReady: (v: boolean) => void;
  setSelectedContact: (id: string | null) => void;
  setSelectedChat: (id: string | null, accountId?: string | null) => void;
  setDraftReply: (text: string) => void;
  setChatDraft: (chatId: string, text: string) => void;
  applyAiSuggestion: (text: string, mode?: "replace" | "append") => void;
  addOutgoingMessage: (body: string) => void;
  /**
   * 乐观写入一条出站消息（可带投递元数据），返回 message id。
   * 失败/限速也会落库，便于队列重试。
   */
  enqueueOutgoingMessage: (input: {
    body: string;
    chatId?: string | null;
    contactId?: string | null;
    phoneE164?: string;
    channelId?: string;
    deviceId?: string | null;
    accountId?: string;
    systemKind?: string;
    deliveryStatus?: Message["deliveryStatus"];
    lastError?: string;
    nextAttemptAt?: string;
  }) => string | null;
  /** 按 id 合并字段；无实质变化时不触发 set（避免整表重渲染） */
  patchMessage: (id: string, patch: Partial<Message>) => boolean;
  updateMessageDelivery: (
    id: string,
    patch: Partial<
      Pick<
        Message,
        | "deliveryStatus"
        | "lastError"
        | "retryCount"
        | "nextAttemptAt"
        | "phoneE164"
        | "contactId"
        | "channelId"
        | "deviceId"
        | "waMessageId"
        | "waKey"
        | "sentAt"
        | "reactions"
        | "mediaUrl"
        | "mediaType"
        | "mediaMime"
        | "mediaFileName"
        | "mediaCaption"
        | "mediaThumbUrl"
        | "mediaPending"
        | "mediaError"
        | "mediaSeconds"
        | "mediaPtt"
        | "body"
        | "quoted"
        | "edited"
      >
    >
  ) => void;
  /** 滚动定位某条消息（会话内高亮） */
  focusMessageId: string | null;
  setFocusMessageId: (id: string | null) => void;
  /** 仅本地删除气泡（不调用 WhatsApp 撤回） */
  deleteLocalMessage: (id: string) => void;
  /** 更新会话本地标志（归档/静音/置顶） */
  patchChat: (chatId: string, patch: Partial<ChatPreview>) => void;
  /** 删除整个会话（本地）；可选同时清消息 */
  deleteChatLocal: (chatId: string, opts?: { clearMessages?: boolean }) => void;
  /** 释放长期未联系会话的本地消息，保留联系人/群组资料 */
  releaseInactiveChatHistory: (chatIds: string[]) => Promise<number>;
  /** 当前会话入站消息的 waKey 列表（已读用） */
  inboundKeysForChat: (chatId: string | null) => WaMessageKey[];
  /** 取出可自动重试的出站消息（queued/failed 且到点） */
  listRetryableOutgoing: (nowIso?: string) => Message[];
  setActiveNav: (nav: NavId) => void;
  setSettingsOpen: (open: boolean, category?: string) => void;
  setUpdateAvailableVersion: (version: string | null) => void;
  settingsCategory: string;
  setSettingsCategory: (category: string) => void;
  setCommandOpen: (open: boolean) => void;
  setBaileysLoginOpen: (open: boolean) => void;
  setBaileysUi: (patch: Partial<AppState["baileysUi"]>) => void;
  syncWhatsAppLabels: (
    labels: WhatsAppLabel[],
    chatLabelIds: Record<string, string[]>,
    accountId: string
  ) => void;
  /** 克制版群发战役 */
  createBroadcastCampaign: (input: {
    accountId: string;
    template: string;
    contactIds: string[];
    phoneNumbers?: string[];
    extraGapSec?: number;
    extraGapMaxSec?: number;
    media?: import("@/types/broadcast").BroadcastMedia[];
    mediaMode?: import("@/types/broadcast").BroadcastMediaMode;
  }) => { ok: true; id: string } | { ok: false; reason: string };
  startBroadcastCampaign: (
    id: string
  ) => { ok: true } | { ok: false; reason: string };
  pauseBroadcastCampaign: (id: string) => void;
  resumeBroadcastCampaign: (
    id: string
  ) => { ok: true } | { ok: false; reason: string };
  retryFailedBroadcastCampaign: (id: string) => number;
  cancelBroadcastCampaign: (id: string) => void;
  retireAccountMessaging: (accountId: string) => void;
  completeBroadcastCampaignIfIdle: (id: string) => void;
  patchBroadcastItem: (
    campaignId: string,
    itemId: string,
    patch: Partial<BroadcastItem>
  ) => void;

  /** 会话/消息辅助 */
  ensureChatForContact: (contactId: string, accountId: string) => string | null;
  clearChatMessages: (chatId: string) => void;
  markChatUnreadLocal: (chatId: string, unread?: number) => void;
  toggleMessageStarred: (id: string) => void;
  listStarredMessages: () => Message[];
  isMessageSaved: (id: string) => boolean;
  saveMessageToSelf: (id: string) => boolean;
  toggleSavedMessagePinned: (id: string) => void;
  setSavedMessagesPinned: (ids: string[], pinned: boolean) => void;
  setSavedMessageTags: (id: string, tags: string[]) => void;
  scheduleSavedMessageTomorrowFollowUp: (id: string) => boolean;
  openSavedMessageSource: (id: string) => boolean;
  deleteSavedMessages: (ids: string[]) => void;
  openSavedMessages: () => void;
  searchMessagesGlobal: (query: string, limit?: number) => Promise<Message[]>;
  ensureMessageInMemory: (id: string) => Promise<unknown>;
  importBackup: (bundle: unknown) => Promise<{ ok: boolean; reason?: string }>;
  setCrmPanelCollapsed: (v: boolean) => void;
  setCrmPanelTab: (tab: "customer" | "quick-replies") => void;
  setChatListFilter: (f: ChatListFilter) => void;
  goToChats: (filter?: ChatListFilter) => void;
  pushToast: (
    message: string,
    tone?: ToastTone,
    options?: ToastOptions
  ) => void;
  dismissToast: (id: string) => void;
  /**
   * 深色统一确认框。返回 Promise<boolean>（确定 true / 取消 false）。
   * 禁止再用 window.confirm / alert。
   */
  requestConfirm: (opts: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
  }) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  setBridgeRuntime: (patch: Partial<BridgeRuntime>) => void;
  ingestBridgeEvents: (events: BridgeEvent[]) => void;
  logActivity: (
    contactId: string,
    kind: ActivityKind,
    title: string,
    detail?: string
  ) => void;
  activitiesForContact: (contactId: string) => Activity[];
  deleteContactLocal: (id: string) => void;
  updateContact: (id: string, patch: Partial<Contact>) => void;
  /** 批量更新多个联系人（一次 setState；mergeTags 为追加标签） */
  batchUpdateContacts: (
    ids: string[],
    patch: Partial<Contact>,
    opts?: { activityTitle?: string; mergeTags?: string[] }
  ) => number;
  /** 手动合并联系人：keep 保留、drop 吸收（迁移 chats/messages/followUps/activities） */
  mergeContacts: (keepId: string, dropIds: string[]) => boolean;
  addContact: (c: Omit<Contact, "id">) => void;
  /** 批量导入联系人：静默建联系人+会话行，返回新增数 */
  importContacts: (contacts: Omit<Contact, "id">[]) => number;
  toggleFollowUp: (id: string) => void;
  addFollowUp: (f: Omit<FollowUp, "id" | "done">) => void;
  /** 一键：明天跟进（写 follow_up + contact.nextFollowUpAt） */
  scheduleTomorrowFollowUp: (
    contactId: string,
    note?: string
  ) => { dueAt: string } | null;
  /**
   * 自定义跟进时间。
   * dueAt 建议 `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`（本地）
   */
  scheduleFollowUp: (
    contactId: string,
    dueAt: string,
    note?: string
  ) => { dueAt: string } | null;
  scheduleMessage: (input: {
    chatId: string;
    contactId: string;
    contactName: string;
    recipient: string;
    text: string;
    dueAt: string;
    channelId: string;
    deviceId?: string | null;
    accountId?: string;
  }) => string | null;
  updateScheduledMessage: (
    id: string,
    patch: Partial<Pick<ScheduledMessage, "status" | "messageId" | "error">>
  ) => boolean;
  cancelScheduledMessage: (id: string) => boolean;
  removeScheduledMessage: (id: string) => boolean;
  /** 批量设置或改期未完成跟进（单次状态写入）。 */
  scheduleFollowUps: (
    contactIds: string[],
    dueAt: string,
    note?: string
  ) => number;
  updateSettings: (patch: Partial<AppSettings>) => void;
  createChatFolder: (name: string, parentId?: string | null) => string | null;
  renameChatFolder: (folderId: string, name: string) => void;
  deleteChatFolder: (folderId: string) => void;
  clearChatFolder: (folderId: string) => void;
  toggleChatFolderCollapsed: (folderId: string) => void;
  reorderChatFolder: (folderId: string, targetFolderId: string, after?: boolean) => void;
  /** 主归属移入分组（从其它组移除）；folderId=null 则回未分组 */
  moveChatToFolder: (chatId: string, folderId: string | null) => void;
  /** 分身到另一分组（主归属不变） */
  cloneChatToFolder: (chatId: string, folderId: string) => void;
  removeChatFolderClone: (cloneId: string) => void;
  /** 按号码导入到分组（主归属） */
  importPhonesToFolder: (
    folderId: string,
    rawText: string
  ) => { matched: number; created: number; skipped: number };
  openContactWorkspace: (
    contactId: string,
    opts?: { focusMessageId?: string; prefillDraft?: string }
  ) => void;
  recomputeStats: () => void;
  exportBackup: () => Promise<void>;
  exportContactsCsv: () => void;
  hydrate: () => Promise<void>;
  clearData: () => Promise<void>;
}

export type { SalesStage };
