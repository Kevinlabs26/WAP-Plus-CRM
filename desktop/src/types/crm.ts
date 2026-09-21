import type { SalesStage } from "@shared/protocol";

export type { SalesStage };

export interface PhoneDevice {
  id: string;
  name: string;
  model: string;
  remark: string;
  online: boolean;
  battery: number;
  charging?: boolean;
  whatsappInstalled?: boolean;
  accessibilityEnabled?: boolean;
  overlayEnabled?: boolean;
  boundRegion?: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  /**
   * 归属 WhatsApp 账号槽位（多号）。
   * 缺省时运行时按 DEFAULT_ACCOUNT_ID / 当前活跃号补齐。
   */
  accountId?: string;
  /**
   * 跨号同一自然人（如相同手机号）的合并键；聊天线程仍按 account 分离。
   */
  personKey?: string;
  /** Baileys 会话地址；手机号被 WhatsApp 隐藏时仍可用 @lid 收发 */
  channelAddress?: string;
  country?: string;
  /** 朗读/TTS 语言偏好（BCP47 短码如 zh-CN/fr-FR）；空 = 自动探测 */
  language?: string;
  company?: string;
  source?: string;
  owner?: string;
  tags: string[];
  stage: SalesStage;
  notes?: string;
  /** 客户卡长摘要（可 AI 生成后手改） */
  aiSummary?: string;
  /** 一句话意向 / 卡点（客户卡） */
  aiIntent?: string;
  /** 建议下一步（客户卡） */
  aiNextStep?: string;
  /** 建议推进的销售阶段（未自动改 stage，需确认） */
  aiSuggestedStage?: SalesStage;
  /** 洞察上次生成时间 ISO */
  aiInsightAt?: string;
  /** 永久绑定的手机 id — 核心壁垒功能 */
  boundPhoneId?: string;
  lastMessageAt?: string;
  nextFollowUpAt?: string;
  /** WhatsApp 头像 URL（Baileys profilePictureUrl，可能过期） */
  avatarUrl?: string;
  /** 高清头像（点开级），优先用于悬停/预览 */
  avatarFullUrl?: string;
  /** 沟通/译出偏好：en | zh | fr | es … */
  preferredLang?: string;
  isGroup?: boolean;
  participantCount?: number;
  groupOwner?: string;
  groupDesc?: string;
  groupAnnounce?: boolean;
  groupRestrict?: boolean;
  groupEphemeral?: number;
  groupJoinApproval?: boolean;
  groupLinkedParent?: string;
  groupIsCommunity?: boolean;
}

export type GroupMemberRole = "member" | "admin" | "superadmin" | string;

export interface GroupMember {
  jid: string;
  phoneE164?: string;
  lid?: string;
  /** 对应 @s.whatsapp.net 电话 JID（成员 id 为 @lid 时有用） */
  pnJid?: string;
  name?: string;
  /** 来自本地通讯录叠层或 bridge 补全 */
  avatarUrl?: string;
  avatarFullUrl?: string;
  role?: GroupMemberRole;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

export interface GroupDetails {
  jid: string;
  subject?: string;
  desc?: string;
  owner?: string;
  participantCount?: number;
  participants?: GroupMember[];
  announce?: boolean;
  restrict?: boolean;
  memberAddMode?: boolean;
  joinApprovalMode?: boolean;
  ephemeralDuration?: number;
  isCommunity?: boolean;
  linkedParent?: string;
  creation?: number;
  avatarUrl?: string;
}

export interface ChatPreview {
  id: string;
  contactId: string;
  contactName: string;
  lastMessage: string;
  /** 最后一条真实消息方向，用于判断是否仍等待我回复 */
  lastMessageDirection?: "in" | "out";
  /** 完整历史中是否有成功的我方消息；按主动联系设置决定是否排除。 */
  hasOutgoingHistory?: boolean;
  unread: number;
  updatedAt: string;
  phoneId: string;
  /** 归属 WhatsApp 账号；发送必须路由到此账号 session */
  accountId?: string;
  /** 本地/同步：归档、静音、置顶（Baileys chatModify） */
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: number | null;
  isGroup?: boolean;
  /** 仅本地使用的自聊（例如“我的收藏”），禁止发送到 WhatsApp */
  localOnly?: boolean;
}

export const SAVED_MESSAGES_CONTACT_ID = "bridge-contact-saved-messages";
export const SAVED_MESSAGES_CHAT_ID = "bridge-chat-saved-messages";

/** Baileys 协议消息键（撤回/已读/反应） */
export interface WaMessageKey {
  remoteJid: string;
  fromMe: boolean;
  id: string;
  participant?: string;
}

/** 出站投递状态；历史消息无此字段视为已送达 */
export type MessageDeliveryStatus =
  | "pending"
  | "queued"
  | "sent"
  | "server"
  | "delivered"
  | "read"
  | "played"
  | "failed"
  | "local";

/** 消息媒体类型（Baileys 下载后带 mediaUrl） */
export type MessageMediaType =
  | "image"
  | "sticker"
  | "audio"
  | "video"
  | "gif"
  | "document"
  | "location"
  | "product"
  | "order"
  | "contact"
  | "";

export interface MessageContactCard {
  displayName: string;
  phoneE164: string;
  vcard?: string;
}

/** 贴在原消息上的表情回应（原生样式，不是独立气泡） */
export interface MessageReaction {
  emoji: string;
  /**
   * 回应者角色：
   * - me：本登录号
   * - peer：私聊对方（无 participant 时）
   * - member：群成员（用 participantJid 区分多人）
   */
  from: "me" | "peer" | "member";
  /** 群内反应者 jid（from=member 时有意义） */
  participantJid?: string;
  /** 展示名（可选） */
  participantName?: string;
  at?: string;
}

export interface Message {
  id: string;
  chatId: string;
  direction: "in" | "out";
  body: string;
  sentAt: string;
  /** 归属 WhatsApp 账号槽（多号隔离；缺省时从 chat.accountId 推断） */
  accountId?: string;
  /** 出站投递；缺省 = 已发送（兼容旧数据） */
  deliveryStatus?: MessageDeliveryStatus;
  lastError?: string;
  retryCount?: number;
  /** ISO：队列下次可尝试时间 */
  nextAttemptAt?: string;
  /** 重试用：收件人号码 */
  phoneE164?: string;
  contactId?: string;
  channelId?: string;
  deviceId?: string | null;
  isGroup?: boolean;
  groupJid?: string;
  senderJid?: string;
  senderPhoneE164?: string;
  senderName?: string;
  /** 群内发言人头像 */
  senderAvatarUrl?: string;
  /**
   * 系统/业务来源标记。
   * `broadcast_campaign`：克制群发出站，禁止 SendQueueWatcher 自动重试（防双发）。
   */
  systemKind?: string;
  systemAction?: string;
  /** 被 @ 的成员 jid */
  mentionedJids?: string[];
  /** 群消息是否明确 @ 了当前登录账号 */
  mentionedMe?: boolean;
  /** WhatsApp 消息 id（发送成功或回声入库后写入，用于去重） */
  waMessageId?: string;
  /** 完整协议 key（优先于仅 id） */
  waKey?: WaMessageKey;
  /** 图片/语音等 */
  mediaType?: MessageMediaType | string;
  /** 语音转文字结果（本地缓存，不进 WhatsApp） */
  transcript?: string;
  /** 消息文字翻译结果（本地缓存，不进 WhatsApp） */
  translation?: string;
  /** 译文目标语言代码 */
  translationLang?: string;
  /** data: URL 或 http(s) */
  mediaUrl?: string;
  mediaMime?: string;
  mediaFileName?: string;
  mediaSeconds?: number;
  mediaPtt?: boolean;
  mediaCaption?: string;
  /** 视频/图协议缩略图 data URL */
  mediaThumbUrl?: string;
  /** bridge 侧媒体待按需拉取（无 mediaUrl） */
  mediaPending?: boolean;
  /** 最近一次媒体补拉失败原因；成功后清空 */
  mediaError?: string;
  /** WhatsApp 联系人名片（vCard） */
  contactCard?: MessageContactCard;
  /** 聚合在气泡上的表情 */
  reactions?: MessageReaction[];
  /** 协议级引用的原消息 */
  quoted?: {
    id: string;
    body: string;
    fromMe?: boolean;
    remoteJid?: string;
    participant?: string;
  };
  /** 是否编辑过 */
  edited?: boolean;
  /** 本地星标（CRM 收藏，非 WhatsApp 协议星标） */
  starred?: boolean;
  /** 星标时间 ISO */
  starredAt?: string;
  /** 转存到“我的收藏”时对应的原消息 id */
  savedFromMessageId?: string;
  savedFromContactId?: string;
  savedFromContactName?: string;
  savedFromChatName?: string;
  savedFromSentAt?: string;
  savedPinned?: boolean;
  savedTags?: string[];
}

export interface FollowUp {
  id: string;
  contactId: string;
  contactName: string;
  dueAt: string;
  note?: string;
  done: boolean;
}

export type ScheduledMessageStatus =
  | "pending"
  | "queued"
  | "sent"
  | "failed"
  | "cancelled";

/** 单个会话的一次性定时文字消息（发送仍复用普通出站队列）。 */
export interface ScheduledMessage {
  id: string;
  chatId: string;
  contactId: string;
  contactName: string;
  recipient: string;
  text: string;
  dueAt: string;
  channelId: string;
  deviceId?: string | null;
  accountId?: string;
  status: ScheduledMessageStatus;
  messageId?: string;
  error?: string;
  createdAt: string;
}

export interface WhatsAppLabel {
  id: string;
  name: string;
  color: number;
  predefinedId?: string;
}

export interface WhatsAppProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  retailerId: string;
  url: string;
  imageUrl: string;
}

export interface AiSuggestion {
  id: string;
  text: string;
  tone?: string;
}

/** 单账号槽位上的经营快照（与全局 DashboardStats 同口径） */
export interface AccountDashStats {
  accountId: string;
  chatsToday: number;
  /** 有未读消息的会话数 */
  pendingReplyChats: number;
  /** 未读消息条数 */
  pendingReplies: number;
  dealsWon: number;
  followUpsToday: number;
  contacts: number;
  trend7d: StatsTrendDay[];
}

/** 本地日维度趋势（近 N 日） */
export interface StatsTrendDay {
  /** YYYY-MM-DD（本地日界） */
  day: string;
  /** 当日有消息的会话数 */
  activeChats: number;
  inbound: number;
  outbound: number;
}

export interface DashboardStats {
  chatsToday: number;
  /** 有未读消息的会话数 */
  pendingReplyChats: number;
  /** 未读消息条数 */
  pendingReplies: number;
  dealsWon: number;
  followUpsToday: number;
  /** 按 WhatsApp 账号槽拆分；无 accountId 的归入 default 桶 */
  byAccount: AccountDashStats[];
  /** 近 7 个本地日（含今日），按 messages.sentAt */
  trend7d: StatsTrendDay[];
}

/** 客户活动时间线（专业 CRM 标配） */
export type ActivityKind =
  | "note"
  | "stage"
  | "message_out"
  | "message_in"
  | "follow_up"
  | "contact_created"
  | "phone_bound"
  | "system";

export interface Activity {
  id: string;
  contactId: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  at: string;
}
