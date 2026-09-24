import type {
  BaileysChatModifyAction,
  BaileysMediaResponse,
  BaileysOkResponse,
} from "@shared/baileysProtocol";
import { request } from "./baileysCore";

export type ChatModifyAction = BaileysChatModifyAction;

export const baileysLogout = (accountId?: string | null) =>
  request<BaileysOkResponse>("/logout", { method: "POST" }, accountId);

export const baileysChatModify = (
  action: ChatModifyAction,
  target: {
    jid?: string;
    phoneE164?: string;
    channelAddress?: string;
    accountId?: string | null;
  },
  extra?: {
    durationMs?: number | null;
    value?: boolean;
    lastMessages?: Array<{
      key: {
        remoteJid: string;
        id: string;
        fromMe?: boolean;
        participant?: string;
      };
      messageTimestamp: number;
    }>;
  }
) =>
  request<BaileysOkResponse>("/chat/modify", {
    method: "POST",
    body: JSON.stringify({
      action,
      jid: target.jid,
      phoneE164: target.phoneE164,
      channelAddress: target.channelAddress,
      ...extra,
    }),
  }, target.accountId);

export async function baileysSaveContacts(
  accountId: string | null | undefined,
  contacts: Array<{ name: string; phoneE164: string }>
) {
  const totals = { saved: 0, failed: 0 };
  for (let start = 0; start < contacts.length; start += 500) {
    const result = await request<{
      items?: Array<{ status?: "saved" | "failed" }>;
    }>(
      "/contacts/save_batch",
      {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ items: contacts.slice(start, start + 500) }),
      },
      accountId
    );
    for (const item of result.items || []) {
      if (item.status === "saved") totals.saved += 1;
      else totals.failed += 1;
    }
    totals.failed += Math.max(
      0,
      Math.min(500, contacts.length - start) - (result.items?.length || 0)
    );
  }
  return totals;
}

export const baileysMessagesRead = (
  keys: Array<{
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  }>,
  accountId?: string | null
) =>
  request<{ ok: boolean; count: number }>("/messages/read", {
    method: "POST",
    body: JSON.stringify({ keys }),
  }, accountId);

export const baileysFetchMessageHistory = (
  input: {
    key: {
      remoteJid: string;
      id: string;
      fromMe?: boolean;
      participant?: string;
    };
    oldestMsgTimestampMs: number;
    count?: number;
  },
  accountId?: string | null
) =>
  request<{ ok: boolean; count: number; requestId?: string }>(
    "/messages/history",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    accountId
  );

export const baileysMessageDelete = (
  key: {
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  },
  forEveryone = true,
  accountId?: string | null
) =>
  request<BaileysOkResponse>("/message/delete", {
    method: "POST",
    body: JSON.stringify({ key, forEveryone }),
  }, accountId);

export const baileysMessageReact = (
  key: {
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  },
  emoji: string,
  accountId?: string | null
) =>
  request<BaileysOkResponse>("/message/react", {
    method: "POST",
    body: JSON.stringify({ key, text: emoji }),
  }, accountId);

/** 按协议 key 补下媒体（桥接内存中需仍有原始消息） */
export const baileysDownloadMedia = (
  key: {
    remoteJid?: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  },
  opts?: {
    mediaType?: string;
    mimetype?: string;
    accountId?: string | null;
  }
) =>
  request<BaileysMediaResponse>("/message/media", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      key,
      mediaType: opts?.mediaType,
      mimetype: opts?.mimetype,
    }),
  }, opts?.accountId);

/** 清空会话并重新要二维码（按钮「重新获取二维码」必须走这里） */
export const baileysRestart = (
  clearAuth = true,
  accountId?: string | null
) =>
  request<{ ok: boolean; message?: string; connection?: string }>(
    "/restart",
    {
      method: "POST",
      body: JSON.stringify({ clearAuth }),
    },
    accountId
  );

/** 拉联系人/群成员头像；quality=image 为高清（点开级） */
export async function baileysFetchAvatar(
  opts: {
    jid?: string;
    phone?: string;
    quality?: "preview" | "image" | "full" | "hd";
    force?: boolean;
    /** 拉当前登录号本人头像（bridge 会补 socket.user 多种 jid） */
    self?: boolean;
    accountId?: string | null;
  } = {}
) {
  const q = new URLSearchParams();
  if (opts.jid) q.set("jid", opts.jid);
  if (opts.phone) q.set("phone", opts.phone);
  if (opts.quality) q.set("quality", opts.quality);
  if (opts.force) q.set("force", "1");
  if (opts.self) q.set("self", "1");
  return request<{
    ok?: boolean;
    jid?: string;
    avatarUrl?: string;
    avatarFullUrl?: string;
  }>(`/avatar?${q.toString()}`, { method: "GET" }, opts.accountId);
}
