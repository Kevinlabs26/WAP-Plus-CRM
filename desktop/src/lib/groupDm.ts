/**
 * 从群成员打开私信所需的纯函数（不碰 React）。
 *
 * 匹配必须严格：禁止用 @lid 用户段当手机号、禁止 id 子串模糊匹配，
 * 否则会打开别人的私聊把记录串在一起。
 */
import { buildPersonKey } from "@/lib/utils";
import type { Contact, GroupMember } from "@/types/crm";

export type GroupMemberDmTarget = {
  /** 发送/会话用的主地址：优先 PN，其次可靠 phone，最后才是 @lid */
  jid: string;
  phoneE164?: string;
  name?: string;
  avatarUrl?: string;
  accountId: string;
  /** 原始 lid（若有），仅作精确 channelAddress 匹配 */
  lid?: string;
  pnJid?: string;
};

function normJid(s?: string | null): string {
  return String(s || "").trim();
}

function phoneDigits(s?: string | null): string {
  return String(s || "").replace(/\D/g, "");
}

function isLid(j: string) {
  return j.includes("@lid");
}

function isPnJid(j: string) {
  return j.includes("@s.whatsapp.net") || j.includes("@c.us");
}

function isGroupJid(j: string) {
  return j.endsWith("@g.us");
}

/**
 * 从群成员解析私信目标。
 * - 绝不把 @lid 的 user 段当成手机号
 * - jid 优先：pnJid > 电话推出来的 PN > 非 lid 的 m.jid > lid
 */
export function memberToDmTarget(
  m: Pick<
    GroupMember,
    "jid" | "phoneE164" | "name" | "avatarUrl" | "pnJid" | "lid"
  > & { displayName?: string; contactId?: string },
  accountId: string
): GroupMemberDmTarget | null {
  const rawJid = normJid(m.jid);
  const pnJid = normJid(m.pnJid);
  const lid = normJid(m.lid) || (isLid(rawJid) ? rawJid : "");

  // 手机号：仅 phoneE164 或 pnJid 的数字段（禁止从 @lid 抽号）
  let phone = phoneDigits(m.phoneE164);
  if (!phone && pnJid && isPnJid(pnJid)) {
    phone = phoneDigits(pnJid.replace(/@.+$/, "").split(":")[0]);
  }
  if (!phone && rawJid && isPnJid(rawJid)) {
    phone = phoneDigits(rawJid.replace(/@.+$/, "").split(":")[0]);
  }
  if (phone.length < 7 || phone.length > 15) phone = "";

  let jid = "";
  if (pnJid && isPnJid(pnJid) && !isGroupJid(pnJid)) jid = pnJid;
  else if (phone) jid = `${phone}@s.whatsapp.net`;
  else if (rawJid && isPnJid(rawJid) && !isGroupJid(rawJid)) jid = rawJid;
  else if (lid && isLid(lid)) jid = lid;
  else if (rawJid && !isGroupJid(rawJid)) jid = rawJid;

  if (!jid || isGroupJid(jid)) return null;

  const name = String(m.displayName || m.name || "").trim();
  return {
    jid,
    phoneE164: phone || undefined,
    name: name && name !== "群成员" ? name : undefined,
    avatarUrl: m.avatarUrl,
    accountId,
    lid: lid || undefined,
    pnJid: pnJid && isPnJid(pnJid) ? pnJid : undefined,
  };
}

/** 稳定 contact id，便于 openContactWorkspace */
export function dmContactId(accountId: string, jid: string): string {
  const key = encodeURIComponent(`${accountId}:${jid}`);
  return `bridge-contact-${key}`;
}

/**
 * 只允许「硬证据」命中已有联系人，避免串会话：
 * 1) channelAddress 全等（jid / lid / pn）
 * 2) 稳定 bridge-contact id 全等
 * 3) 完整 E.164 数字全等（且双方都有 ≥7 位号）
 * 禁止：id.includes / 后缀 / 短号
 */
export function findExistingDmContact(
  contacts: Contact[],
  target: GroupMemberDmTarget
): Contact | undefined {
  const jid = normJid(target.jid);
  const lid = normJid(target.lid);
  const pn = normJid(target.pnJid);
  const phone = phoneDigits(target.phoneE164);
  const aid = target.accountId;
  const exactIds = new Set(
    [jid, lid, pn]
      .filter(Boolean)
      .map((j) => dmContactId(aid, j))
  );

  const candidates = contacts.filter((c) => {
    if (c.isGroup) return false;
    if (aid && c.accountId && c.accountId !== aid) return false;
    if (aid && c.boundPhoneId && c.boundPhoneId !== aid && !c.accountId)
      return false;
    return true;
  });

  // 1) 精确 channelAddress
  for (const addr of [jid, lid, pn]) {
    if (!addr) continue;
    const hit = candidates.find((c) => c.channelAddress === addr);
    if (hit) return hit;
  }

  // 2) 精确稳定 id
  for (const c of candidates) {
    if (exactIds.has(c.id)) return c;
  }

  // 3) 完整手机号全等（不可用 includes/endsWith）
  if (phone.length >= 7) {
    const hit = candidates.find((c) => {
      const cp = phoneDigits(c.phone);
      if (cp && cp === phone) return true;
      // channelAddress 为 PN 时比对 user 段
      const ch = normJid(c.channelAddress);
      if (isPnJid(ch)) {
        const d = phoneDigits(ch.replace(/@.+$/, "").split(":")[0]);
        return d === phone;
      }
      return false;
    });
    if (hit) return hit;
  }

  return undefined;
}

export function buildDmContact(target: GroupMemberDmTarget): Contact {
  const phone = target.phoneE164 || "";
  const name =
    target.name ||
    (phone ? `+${phone}` : target.jid.replace(/@.+$/, "").slice(0, 16));
  const now = new Date().toISOString();
  // channelAddress：有 PN 用 PN；否则保留实际 jid（可能是 lid）
  const channel =
    (target.pnJid && isPnJid(target.pnJid) ? target.pnJid : "") ||
    (phone ? `${phone}@s.whatsapp.net` : "") ||
    target.jid;
  return {
    id: dmContactId(target.accountId, channel),
    name,
    phone: phone ? `+${phone.replace(/^\+/, "")}` : "",
    channelAddress: channel,
    accountId: target.accountId,
    boundPhoneId: target.accountId,
    tags: [],
    stage: "new",
    avatarUrl: target.avatarUrl,
    personKey: buildPersonKey({
      phone,
      channelAddress: channel,
      jid: channel,
      isGroup: false,
    }),
    lastMessageAt: now,
  };
}
