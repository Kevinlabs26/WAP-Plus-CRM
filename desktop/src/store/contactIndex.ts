import type { ChatPreview, Contact } from "../types/crm.ts";
import { DEFAULT_ACCOUNT_ID } from "../types/account.ts";
import { normalizeIngestPhone } from "./bridgeIngestHelpers.ts";

export type ContactMatchKeys = {
  deviceId: string;
  channelAddress?: string;
  phone?: string;
  jid?: string;
  pnJid?: string;
};

export type ContactLookup = {
  /** 等价于原 findIndex(matchContact)，但批内 O(1) 命中；未命中返回 -1 */
  matchIndex: (keys: ContactMatchKeys) => number;
  /** id 精确查找 */
  idIndex: (id: string) => number;
};

function ownerOf(c: Contact): string {
  return c.accountId || c.boundPhoneId || DEFAULT_ACCOUNT_ID;
}

function contactMatch(c: Contact, keys: ContactMatchKeys): boolean {
  if (ownerOf(c) !== keys.deviceId) return false;
  if (
    keys.channelAddress &&
    c.channelAddress &&
    c.channelAddress === keys.channelAddress
  )
    return true;
  if (keys.phone && c.phone && c.phone === keys.phone) return true;
  if (keys.jid && c.channelAddress === keys.jid) return true;
  if (keys.pnJid) {
    const pnPhone = normalizeIngestPhone(keys.pnJid);
    if (pnPhone && c.phone === pnPhone) return true;
    if (c.channelAddress === keys.pnJid) return true;
  }
  return false;
}

/**
 * 批内联系人索引：contacts 在批内只 push/splice/替换元素（引用不变），
 * 因此按「长度版本」惰性重建即可。命中后会二次校验，防止替换引用后的假阳性；
 * 未命中返回 -1，由调用方回退线性扫描，保证与原有 matchContact 语义完全一致。
 */
export function createContactLookup(
  contacts: Contact[]
): ContactLookup {
  let byId = new Map<string, number>();
  let byChannel = new Map<string, number>();
  let byPhone = new Map<string, number>();
  let builtForLength = -1;

  const ensureBuilt = () => {
    if (contacts.length === builtForLength) return;
    byId = new Map<string, number>();
    byChannel = new Map<string, number>();
    byPhone = new Map<string, number>();
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (!c) continue;
      const owner = ownerOf(c);
      const p = `${owner}\u0000`;
      if (c.id) byId.set(c.id, i);
      if (c.channelAddress) byChannel.set(`${p}ch:${c.channelAddress}`, i);
      if (c.phone) {
        byPhone.set(`${p}ph:${c.phone}`, i);
        const n = normalizeIngestPhone(c.phone);
        if (n && n !== c.phone) byPhone.set(`${p}ph:${n}`, i);
      }
    }
    builtForLength = contacts.length;
  };

  const matchIndex = (keys: ContactMatchKeys): number => {
    ensureBuilt();
    const p = `${keys.deviceId}\u0000`;
    const cands: string[] = [];
    if (keys.channelAddress) cands.push(`${p}ch:${keys.channelAddress}`);
    if (keys.jid) cands.push(`${p}ch:${keys.jid}`);
    if (keys.phone) cands.push(`${p}ph:${keys.phone}`);
    if (keys.pnJid) {
      const n = normalizeIngestPhone(keys.pnJid);
      if (n) cands.push(`${p}ph:${n}`);
      cands.push(`${p}ch:${keys.pnJid}`);
    }
    for (const k of cands) {
      const i = byChannel.get(k) ?? byPhone.get(k);
      if (i == null || i < 0 || i >= contacts.length) continue;
      if (contactMatch(contacts[i], keys)) return i;
    }
    return -1;
  };

  const idIndex = (id: string): number => {
    ensureBuilt();
    const i = byId.get(id);
    return i == null ? -1 : i;
  };

  return { matchIndex, idIndex };
}

export type ChatIdLookup = {
  /** 按 chatId 查找索引；chats 引用/长度变化时自动重建 */
  idx: (chats: ChatPreview[], chatId: string) => number;
};

export function createChatIdLookup(): ChatIdLookup {
  let ref: ChatPreview[] | null = null;
  let len = -1;
  let byId = new Map<string, number>();
  const idx = (chats: ChatPreview[], chatId: string): number => {
    if (ref !== chats || len !== chats.length) {
      ref = chats;
      len = chats.length;
      byId = new Map<string, number>();
      for (let i = 0; i < chats.length; i++) {
        const c = chats[i];
        if (c?.id) byId.set(c.id, i);
      }
    }
    return byId.get(chatId) ?? -1;
  };
  return { idx };
}
