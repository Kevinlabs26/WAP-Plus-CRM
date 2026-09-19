/**
 * 群成员展示 enrichment：用本地 CRM 通讯录叠备注名 / 头像。
 * groupMetadata 往往只有 jid，没有 name。
 */
import { displayContactLabel } from "@/lib/utils";
import type { Contact, GroupMember } from "@/types/crm";

function digits(s?: string | null) {
  return String(s || "").replace(/\D/g, "");
}

function jidUser(jid?: string | null) {
  const j = String(jid || "").trim();
  if (!j.includes("@")) return j;
  return j.slice(0, j.indexOf("@"));
}

export type EnrichedGroupMember = GroupMember & {
  displayName: string;
  avatarUrl?: string;
  contactId?: string;
  matchedContact?: boolean;
};

/**
 * 建索引：jid / lid / 纯号 / channelAddress → Contact
 */
export function buildContactLookup(contacts: Contact[], accountId?: string | null) {
  const byKey = new Map<string, Contact>();
  const put = (key: string | undefined | null, c: Contact) => {
    const k = String(key || "").trim().toLowerCase();
    if (!k) return;
    // 跳过纯过短数字噪声
    if (/^\d{1,5}$/.test(k)) return;
    const prev = byKey.get(k);
    // 同 key：优先本账号、有真名、有头像
    if (!prev) {
      byKey.set(k, c);
      return;
    }
    const score = (x: Contact) =>
      (accountId && x.accountId === accountId ? 4 : 0) +
      (x.name && x.name !== "群聊" && x.name !== "群成员" ? 2 : 0) +
      (x.avatarUrl ? 1 : 0);
    if (score(c) >= score(prev)) byKey.set(k, c);
  };

  for (const c of contacts) {
    if (c.isGroup) continue;
    put(c.channelAddress, c);
    put(c.phone, c);
    put(digits(c.phone), c);
    // 带 + 的 E.164
    const d = digits(c.phone);
    if (d) {
      put(`+${d}`, c);
      put(`${d}@s.whatsapp.net`, c);
      put(`${d}@c.us`, c);
    }
    // id 里可能嵌 jid
    const id = c.id || "";
    for (const m of id.matchAll(/[\w.-]+@(?:s\.whatsapp\.net|lid|c\.us)/gi)) {
      put(m[0], c);
      put(jidUser(m[0]), c);
      put(digits(jidUser(m[0])), c);
    }
    if (c.channelAddress?.includes("@")) {
      put(jidUser(c.channelAddress), c);
      put(digits(jidUser(c.channelAddress)), c);
      const du = digits(jidUser(c.channelAddress));
      if (du) put(`${du}@s.whatsapp.net`, c);
    }
    if (c.phone) put(jidUser(c.phone), c);
  }
  return byKey;
}

export function matchContactForMember(
  m: GroupMember,
  lookup: Map<string, Contact>
): Contact | undefined {
  const rawJid = String(m.jid || "").trim();
  const isLidJid = rawJid.includes("@lid") || String(m.lid || "").includes("@lid");
  // 手机号只允许来自 phoneE164 / pnJid；绝不用 @lid user 段（那不是电话，会误撞别人）
  const phoneDigitsOnly =
    digits(m.phoneE164) ||
    (m.pnJid && !String(m.pnJid).includes("@lid")
      ? digits(jidUser(m.pnJid))
      : "") ||
    (rawJid && !rawJid.includes("@lid") && !rawJid.includes("@g.us")
      ? digits(jidUser(rawJid))
      : "");
  const keys: string[] = [
    // 最硬：完整 jid / lid / pn 精确
    m.jid || "",
    m.lid || "",
    m.pnJid || "",
  ].filter(Boolean);
  if (phoneDigitsOnly.length >= 7 && phoneDigitsOnly.length <= 15) {
    keys.push(
      m.phoneE164 || "",
      phoneDigitsOnly,
      `+${phoneDigitsOnly}`,
      `${phoneDigitsOnly}@s.whatsapp.net`,
      `${phoneDigitsOnly}@c.us`
    );
  }
  // PN 的 user 段可以；LID 的 user 段禁止单独当 key 去撞电话簿
  if (m.pnJid && !String(m.pnJid).includes("@lid")) {
    keys.push(jidUser(m.pnJid));
  }
  if (rawJid && !isLidJid && !rawJid.includes("@g.us")) {
    keys.push(jidUser(rawJid));
  }
  // lid 仅完整 jid 匹配（已在上面），不再 digits(lidUser)
  for (const k of keys) {
    const hit = lookup.get(String(k || "").trim().toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

export function enrichGroupMember(
  m: GroupMember,
  lookup: Map<string, Contact>
): EnrichedGroupMember {
  const local = matchContactForMember(m, lookup);
  const localName = (local?.name || "").trim();
  const metaName = (m.name || "").trim();
  // 本地备注/真名优先，其次协议 name，再 displayContactLabel 回落号码
  const preferred =
    (localName && localName !== "群聊" ? localName : "") ||
    metaName ||
    "";
  const displayName = displayContactLabel(
    preferred,
    m.phoneE164 || local?.phone,
    m.pnJid || m.jid || local?.channelAddress,
    "",
    { isGroup: false }
  );
  return {
    ...m,
    name: preferred || m.name,
    phoneE164: m.phoneE164 || local?.phone || m.phoneE164,
    displayName,
    avatarUrl: local?.avatarUrl || m.avatarUrl || undefined,
    contactId: local?.id,
    matchedContact: Boolean(local),
  };
}

export function enrichGroupMembers(
  members: GroupMember[] | undefined,
  contacts: Contact[],
  accountId?: string | null
): EnrichedGroupMember[] {
  const lookup = buildContactLookup(contacts, accountId);
  return (members || []).map((m) => enrichGroupMember(m, lookup));
}
