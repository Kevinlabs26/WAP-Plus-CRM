/**
 * WAP Plus CRM — 桌面端 ↔ Android Bridge 通信协议
 * 两端共用语义；Android 侧可用同名 JSON 字段解析。
 */

export type DeviceId = string;
export type ContactId = string;
export type ChatId = string;

/** 运行时可枚举的消息类型列表（与 MessageType 联合类型保持同步）。 */
export const MESSAGE_TYPES = [
  "bridge.auth",
  "device.hello",
  "device.status",
  "device.battery",
  "contacts.sync",
  "contacts.save",
  "contacts.save_batch",
  "messages.sync",
  "messages.ack",
  "presence.update",
  "group.join_request",
  "messages.delete",
  "chats.delete",
  "blocklist.sync",
  "blocklist.update",
  "history.sync_status",
  "baileys.error",
  "wa.open_chat",
  "wa.type_text",
  "wa.send",
  "wa.open_and_send",
  "wa.sync_conversations",
  "wa.prepare_media",
  "wa.send_media",
  "wa.search_contact",
  "overlay.show_card",
  "overlay.hide",
  "ping",
  "pong",
  "ack",
  "error",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Android MessageDispatcher 入站处理的 type（不含仅上行/事件类）。 */
export const ANDROID_DISPATCH_MESSAGE_TYPES = [
  "contacts.save",
  "contacts.save_batch",
  "wa.open_chat",
  "wa.type_text",
  "wa.send",
  "wa.open_and_send",
  "wa.sync_conversations",
  "wa.prepare_media",
  "wa.send_media",
  "wa.search_contact",
  "overlay.show_card",
  "overlay.hide",
  "ping",
  "ack",
] as const;

export type AndroidDispatchMessageType =
  (typeof ANDROID_DISPATCH_MESSAGE_TYPES)[number];

export interface DeviceHello {
  id?: DeviceId;
  name: string;
  model: string;
  androidVersion?: string;
  bridgeVersion?: string;
  battery?: number;
  accessibilityEnabled?: boolean;
}

export interface BridgeAuth {
  token: string;
}

export interface DeviceStatus {
  online: boolean;
  whatsappInstalled: boolean;
  accessibilityEnabled: boolean;
  overlayEnabled: boolean;
}

export interface DeviceBattery {
  level: number; // 0-100
  charging: boolean;
}

export interface ContactSyncItem {
  phoneE164: string;
  displayName: string;
  /** Baileys v7 主地址（可能是 PN，也可能是 LID）。 */
  jid?: string;
  /** 与 LID 对应的电话号码 JID。 */
  pnJid?: string;
  /** CRM 稳定会话地址，优先保存 LID。 */
  channelAddress?: string;
  waJid?: string;
  lastMessage?: string;
  updatedAt?: number;
  avatarUrl?: string;
  isGroup?: boolean;
  participantCount?: number;
  groupOwner?: string;
  /** 群简介 */
  groupDesc?: string;
  groupAnnounce?: boolean;
  groupRestrict?: boolean;
  groupEphemeral?: number;
  groupJoinApproval?: boolean;
  groupLinkedParent?: string;
  groupIsCommunity?: boolean;
  [key: string]: unknown;
}

/** 群成员（GET /groups/:jid） */
export interface GroupParticipantInfo {
  jid: string;
  phoneE164?: string;
  lid?: string;
  name?: string;
  avatarUrl?: string;
  role?: "member" | "admin" | "superadmin" | string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

/** 群完整元数据（只读 API） */
export interface GroupMetadataInfo {
  jid: string;
  subject?: string;
  desc?: string;
  owner?: string;
  ownerPn?: string;
  creation?: number;
  subjectTime?: number;
  descTime?: number;
  participantCount?: number;
  participants?: GroupParticipantInfo[];
  announce?: boolean;
  restrict?: boolean;
  memberAddMode?: boolean;
  joinApprovalMode?: boolean;
  ephemeralDuration?: number;
  isCommunity?: boolean;
  isCommunityAnnounce?: boolean;
  linkedParent?: string;
  addressingMode?: string;
  inviteCode?: string;
}

export interface ContactsSyncPayload {
  items: ContactSyncItem[];
  source?: string;
}

export interface ContactSavePayload {
  name: string;
  phoneE164: string;
}

export interface ContactSaveBatchPayload {
  items: ContactSavePayload[];
}

export interface MessageSyncItem {
  id?: string;
  kind?: "message" | "reaction";
  jid?: string;
  channelAddress?: string;
  body?: string;
  direction?: "in" | "out";
  sentAt?: number | string;
  phoneE164?: string;
  displayName?: string;
  pushName?: string;
  isGroup?: boolean;
  groupJid?: string;
  senderJid?: string;
  senderPhoneE164?: string;
  senderName?: string;
  /** 系统消息：group_participants 等 */
  systemKind?: string;
  systemAction?: string;
  systemParticipants?: string[];
  systemAuthor?: string;
  /** 群消息被 @ 的 jid 列表 */
  mentionedJids?: string[];
  avatarUrl?: string;
  mediaType?: "image" | "sticker" | "audio" | "video" | "gif" | "document" | "location" | string;
  mediaUrl?: string;
  mediaMime?: string;
  mediaFileName?: string;
  mediaSeconds?: number;
  mediaPtt?: boolean;
  mediaCaption?: string;
  waKey?: ProtocolWaMessageKey;
  emoji?: string;
  targetMessageId?: string;
  targetRemoteJid?: string;
  targetFromMe?: boolean;
  fromMe?: boolean;
  [key: string]: unknown;
}

export interface ProtocolWaMessageKey {
  remoteJid: string;
  fromMe: boolean;
  id: string;
  participant?: string;
}

export interface MessagesSyncPayload {
  items: MessageSyncItem[];
  live?: boolean;
  source?: string;
}

export type MessageAck =
  | "sent"
  | "server"
  | "delivered"
  | "read"
  | "played";

export interface MessageAckItem {
  id: string;
  remoteJid?: string;
  fromMe?: boolean;
  status?: number;
  ack: MessageAck;
  participant?: string;
}

export interface MessageAckPayload {
  items: MessageAckItem[];
  source?: string;
}

export interface PresenceUpdateItem {
  jid: string;
  participant?: string;
  presence: string;
  lastSeen?: number;
  phoneE164?: string;
  aliases?: string[];
  displayName?: string;
}

export interface PresenceUpdatePayload {
  items: PresenceUpdateItem[];
  source?: string;
}

export interface GroupJoinRequestPayload {
  groupJid: string;
  groupName?: string;
  participant?: string;
  participantPn?: string;
  author?: string;
  action?: string;
  method?: string;
  title?: string;
  body?: string;
  at?: number;
}

export interface MessagesDeletePayload {
  items?: {
    id: string;
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
  }[];
  all?: boolean;
  jid?: string;
  source?: string;
}

export interface ChatsDeletePayload {
  jids: string[];
  source?: string;
}

export interface BlocklistSyncPayload {
  jids: string[];
  source?: string;
}

export interface BlocklistUpdatePayload {
  jids: string[];
  type: "add" | "remove" | string;
  source?: string;
}

export interface HistorySyncStatusPayload {
  syncType?: unknown;
  status?: string;
  explicit?: boolean;
  at?: number;
  source?: string;
}

export interface WaOpenChat {
  phoneE164: string;
  displayName?: string;
}

export interface WaTypeText {
  text: string;
}

export interface WaSend {
  /** 若为空则发送当前输入框内容 */
  text?: string;
}

/** 一键：打开聊天 + 输入 + 发送 */
export interface WaOpenAndSend {
  phoneE164: string;
  text: string;
  displayName?: string;
}

export type WaSyncConversations = Record<string, never>;

export interface WaPrepareMedia {
  messageId: string;
  jid?: string;
  phoneE164?: string;
  displayName?: string;
  body?: string;
  sentAt?: number;
}

export interface WaSendMedia {
  /** 手机本地缓存路径（旧客户端兼容）；桌面端通常使用 dataUrl。 */
  localPath?: string;
  dataUrl?: string;
  fileName?: string;
  phoneE164?: string;
  mime: string;
  caption?: string;
}

export interface WaSearchContact {
  query: string;
}

export interface OverlayCard {
  contactName: string;
  tags: string[];
  stage: string;
  nextFollowUp?: string;
  aiSummary?: string;
}

export interface ProtocolError {
  code: string;
  message: string;
  refId?: string;
}

export interface AckPayload {
  refId: string;
  ok: boolean;
  status:
    | "sent"
    | "opened"
    | "failed"
    | "ready"
    | "saved"
    | "exists"
    | "authenticated"
    | "clicked"
    | "delivered";
  error?: string;
  items?: unknown[];
  opened?: boolean;
}

export interface BaileysErrorPayload {
  message: string;
}

export interface ProtocolPayloadMap {
  "bridge.auth": BridgeAuth;
  "device.hello": DeviceHello;
  "device.status": DeviceStatus;
  "device.battery": DeviceBattery;
  "contacts.sync": ContactsSyncPayload;
  "contacts.save": ContactSavePayload;
  "contacts.save_batch": ContactSaveBatchPayload;
  "messages.sync": MessagesSyncPayload;
  "messages.ack": MessageAckPayload;
  "presence.update": PresenceUpdatePayload;
  "group.join_request": GroupJoinRequestPayload;
  "messages.delete": MessagesDeletePayload;
  "chats.delete": ChatsDeletePayload;
  "blocklist.sync": BlocklistSyncPayload;
  "blocklist.update": BlocklistUpdatePayload;
  "history.sync_status": HistorySyncStatusPayload;
  "baileys.error": BaileysErrorPayload;
  "wa.open_chat": WaOpenChat;
  "wa.type_text": WaTypeText;
  "wa.send": WaSend;
  "wa.open_and_send": WaOpenAndSend;
  "wa.sync_conversations": WaSyncConversations;
  "wa.prepare_media": WaPrepareMedia;
  "wa.send_media": WaSendMedia;
  "wa.search_contact": WaSearchContact;
  "overlay.show_card": OverlayCard;
  "overlay.hide": Record<string, never>;
  ping: Record<string, never>;
  pong: Record<string, never>;
  ack: AckPayload;
  error: ProtocolError;
}

export type ProtocolPayload<T extends MessageType = MessageType> =
  ProtocolPayloadMap[T];

/** 信封：Android Bridge 的每行 JSON 消息。 */
export type Envelope<T extends MessageType = MessageType> =
  T extends MessageType
    ? {
        id: string;
        type: T;
        ts: number;
        deviceId?: DeviceId;
        payload: ProtocolPayload<T>;
      }
    : never;

/** 销售阶段（与 CRM 一致） */
export const SALES_STAGES = [
  "new",
  "contacted",
  "quoting",
  "won",
  "after_sales",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number] | (string & {});

export const DEFAULT_TAGS = [
  "VIP",
  "高意向",
  "老客户",
  "等待回复",
  "不联系",
] as const;
