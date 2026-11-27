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
  source: Contact[];
  /** 等价于原 findIndex(matchContact)，但批内 O(1) 命中；未命中返回 -1 */
  matchIndex: (keys: ContactMatchKeys) => number;
  /** id 精确查找 */
  idIndex: (id: string) => number;
  invalidate: () => void;
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
 * 批内按追加量更新索引。合并或身份字段变化时，请让索引失效。
 */
export function createContactLookup(
  contacts: Contact[]
): ContactLookup {
  const byId = new Map<string, number>();
  const byChannel = new Map<string, number>();
  const byPhone = new Map<string, number>();
  let indexedLength = 0;

  const invalidate = () => {
    byId.clear();
    byChannel.clear();
    byPhone.clear();
    indexedLength = 0;
  };

  const ensureBuilt = () => {
    if (contacts.length < indexedLength) invalidate();
    for (let i = indexedLength; i < contacts.length; i++) {
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
    indexedLength = contacts.length;
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

  return { source: contacts, matchIndex, idIndex, invalidate };
}

export type ChatIdLookup = {
  /** 按 chatId 查找索引；追加时只索引尾部。 */
  idx: (chats: ChatPreview[], chatId: string) => number;
};

export function createChatIdLookup(): ChatIdLookup {
  let ref: ChatPreview[] | null = null;
  let indexedLength = 0;
  const byId = new Map<string, number>();
  const idx = (chats: ChatPreview[], chatId: string): number => {
    if (ref !== chats || chats.length < indexedLength) {
      ref = chats;
      indexedLength = 0;
      byId.clear();
    }
    for (let i = indexedLength; i < chats.length; i++) {
      const c = chats[i];
      if (c?.id) byId.set(c.id, i);
    }
    indexedLength = chats.length;
    return byId.get(chatId) ?? -1;
  };
  return { idx };
}
