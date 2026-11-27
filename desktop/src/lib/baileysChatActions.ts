import type {
  BaileysChatModifyAction,
  BaileysMediaResponse,
  BaileysOkResponse,
} from "@shared/baileysProtocol";
import { baileysResetAccount, request, resolveBaileysAccountId } from "./baileysCore";

export type ChatModifyAction = BaileysChatModifyAction;

export async function baileysLogout(accountId?: string | null) {
  const id = resolveBaileysAccountId(accountId);
  const result = await request<BaileysOkResponse>("/logout", { method: "POST" }, id);
  await baileysResetAccount(id);
  return result;
}

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

export type BaileysSaveContactsProgress = {
  completed: number;
  total: number;
  saved: number;
  failed: number;
};

export async function baileysSaveContacts(
  accountId: string | null | undefined,
  contacts: Array<{ name: string; phoneE164: string }>,
  options?: {
    chunkSize?: number;
    onProgress?: (progress: BaileysSaveContactsProgress) => void;
  }
) {
  const totals = {
    saved: 0,
    failed: 0,
    savedPhones: [] as string[],
    failedDetails: [] as Array<{ name: string; phoneE164: string; error: string }>,
  };
  const defaultChunkSize = options?.onProgress
    ? contacts.length <= 50
      ? 1
      : 5
    : 500;
  const chunkSize = Math.max(1, Math.min(500, options?.chunkSize ?? defaultChunkSize));
  const totalCount = contacts.length;
  options?.onProgress?.({ completed: 0, total: totalCount, saved: 0, failed: 0 });

  for (let start = 0; start < totalCount; start += chunkSize) {
    const batch = contacts.slice(start, start + chunkSize);
    const result = await request<{
      items?: Array<{ status?: "saved" | "failed"; error?: string }>;
    }>(
      "/contacts/save_batch",
      {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ items: batch }),
      },
      accountId
    );
    const returnedItems = (result.items || []).slice(0, batch.length);
    for (const [index, item] of returnedItems.entries()) {
      const target = batch[index]!;
      if (item.status === "saved") {
        totals.saved += 1;
        totals.savedPhones.push(target.phoneE164);
      } else {
        totals.failed += 1;
        totals.failedDetails.push({
          name: target.name,
          phoneE164: target.phoneE164,
          error: item.error || "Unknown error",
        });
      }
    }
    for (let missingIdx = returnedItems.length; missingIdx < batch.length; missingIdx++) {
      const target = batch[missingIdx]!;
      totals.failed += 1;
      totals.failedDetails.push({
        name: target.name,
        phoneE164: target.phoneE164,
        error: "No status returned",
      });
    }
    options?.onProgress?.({
      completed: Math.min(totalCount, start + batch.length),
      total: totalCount,
      saved: totals.saved,
      failed: totals.failed,
    });
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
    signal?: AbortSignal;
  }
) =>
  request<BaileysMediaResponse>("/message/media", {
    method: "POST",
    signal: opts?.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    body: JSON.stringify({
      key,
      mediaType: opts?.mediaType,
      mimetype: opts?.mimetype,
    }),
  }, opts?.accountId);

/** 清空会话并重新要二维码（按钮「重新获取二维码」必须走这里） */
export const baileysRestart = async (
  clearAuth = true,
  accountId?: string | null
) => {
  const id = resolveBaileysAccountId(accountId);
  if (clearAuth) {
    await baileysResetAccount(id);
    return { ok: true };
  }
  return request<{ ok: boolean; message?: string; connection?: string }>(
    "/restart",
    {
      method: "POST",
      body: JSON.stringify({ clearAuth }),
    },
    id
  );
};

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
