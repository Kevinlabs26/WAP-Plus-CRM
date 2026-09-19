/**
 * 会话内部备注（客户不可见）— 纯 helper，存 settings 映射。
 */

export type InternalNoteMap = Record<string, string>;

/** 优先 chatId，其次 contactId */
export function noteKey(chatId?: string | null, contactId?: string | null): string {
  const c = String(chatId || "").trim();
  if (c) return `chat:${c}`;
  const p = String(contactId || "").trim();
  if (p) return `contact:${p}`;
  return "";
}

export function getInternalNote(
  map: InternalNoteMap | undefined,
  chatId?: string | null,
  contactId?: string | null
): string {
  if (!map) return "";
  const k = noteKey(chatId, contactId);
  if (k && map[k]) return map[k];
  // fallback contact-only
  const ck = noteKey(null, contactId);
  if (ck && map[ck]) return map[ck];
  return "";
}

export function setInternalNote(
  map: InternalNoteMap | undefined,
  text: string,
  chatId?: string | null,
  contactId?: string | null
): InternalNoteMap {
  const next = { ...(map || {}) };
  const k = noteKey(chatId, contactId);
  if (!k) return next;
  const v = String(text || "").trim();
  if (v) next[k] = v.slice(0, 2000);
  else delete next[k];
  return next;
}

/** personKey → 跟进主号 accountId（撞单时指定） */
export type PersonPrimaryAccountMap = Record<string, string>;

export function getPersonPrimaryAccount(
  map: PersonPrimaryAccountMap | undefined,
  personKey?: string | null
): string {
  const k = String(personKey || "").trim();
  if (!k || !map) return "";
  return String(map[k] || "").trim();
}

export function setPersonPrimaryAccount(
  map: PersonPrimaryAccountMap | undefined,
  personKey: string,
  accountId: string
): PersonPrimaryAccountMap {
  const next = { ...(map || {}) };
  const k = String(personKey || "").trim();
  const a = String(accountId || "").trim();
  if (!k) return next;
  if (a) next[k] = a;
  else delete next[k];
  return next;
}
