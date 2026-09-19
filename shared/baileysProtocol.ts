import type {
  ContactSyncItem,
  GroupMetadataInfo,
  MessageSyncItem,
  ProtocolPayloadMap,
  ProtocolWaMessageKey,
} from "./protocol";
import versions from "./baileys-versions.json" with { type: "json" };

/** SSOT 数值见 baileys-versions.json；sidecar protocol.mjs 运行时读取同一文件。 */
export const BAILEYS_BRIDGE_PROTOCOL_VERSION =
  versions.BAILEYS_BRIDGE_PROTOCOL_VERSION as 4;
export const BAILEYS_LIBRARY_VERSION =
  versions.BAILEYS_LIBRARY_VERSION as "7.0.0-rc14";

export type BaileysConnectionState =
  | "starting"
  | "qr"
  | "connected"
  | "reconnecting"
  | "logged_out"
  | "error";

export interface BaileysUser {
  id?: string;
  lid?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  [key: string]: unknown;
}

export interface BaileysBridgeStatus {
  protocolVersion: number;
  baileysVersion: string;
  connection: BaileysConnectionState;
  qrDataUrl?: string;
  user?: BaileysUser | null;
  lastError?: string;
  hasQr?: boolean;
  reconnectAttempts?: number;
  lastDisconnectAt?: number;
  signedIn?: boolean;
  presenceEventCount?: number;
  lastPresenceDebug?: Record<string, unknown> | null;
  eventCursor?: number;
}

export type BaileysEventType =
  | "device.hello"
  | "contacts.sync"
  | "messages.sync"
  | "messages.ack"
  | "presence.update"
  | "group.join_request"
  | "messages.delete"
  | "chats.delete"
  | "blocklist.sync"
  | "blocklist.update"
  | "history.sync_status"
  | "baileys.error";

export type BaileysEvent<T extends BaileysEventType = BaileysEventType> =
  T extends BaileysEventType
    ? {
        seq: number;
        protocolVersion: number;
        type: T;
        ts: number;
        deviceId: "baileys";
        payload: ProtocolPayloadMap[T];
      }
    : never;

export interface BaileysEventsResponse {
  protocolVersion: number;
  baileysVersion: string;
  events: BaileysEvent[];
  cursor: number;
  gap?: {
    after: number;
    from: number;
    to: number;
    count: number;
  };
}

export interface BaileysSyncResponse {
  protocolVersion: number;
  baileysVersion: string;
  contacts: ContactSyncItem[];
  messages: MessageSyncItem[];
  historyRequest?: {
    requested: boolean;
    requestId?: string;
    peerMessageId?: string;
    cooldownMs?: number;
  } | null;
}

export interface BaileysOkResponse {
  ok: boolean;
}

export interface BaileysSendResponse extends BaileysOkResponse {
  id?: string;
  jid?: string;
  edited?: boolean;
  forwarded?: boolean;
}

export interface BaileysQuotePayload extends Partial<ProtocolWaMessageKey> {
  id: string;
  body?: string;
  message?: Record<string, unknown>;
}

export type BaileysChatModifyAction =
  | "archive"
  | "unarchive"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "markRead"
  | "markUnread"
  | "delete"
  | "clear";

export interface BaileysMediaResponse extends BaileysOkResponse {
  mediaUrl?: string;
  mediaType?: string;
  mediaMime?: string;
  mediaFileName?: string;
  id?: string;
  error?: string;
}

export interface BaileysGroupMetadataResponse {
  ok: boolean;
  protocolVersion?: number;
  baileysVersion?: string;
  group?: GroupMetadataInfo;
  error?: string;
  code?: string;
}

export interface BaileysCommonGroupsResponse {
  ok: boolean;
  protocolVersion?: number;
  baileysVersion?: string;
  groups?: GroupMetadataInfo[];
  error?: string;
  code?: string;
}

export interface BaileysGroupInviteInfoResponse {
  ok: boolean;
  protocolVersion?: number;
  baileysVersion?: string;
  invite?: GroupMetadataInfo & { inviteCode?: string };
  error?: string;
  code?: string;
}
