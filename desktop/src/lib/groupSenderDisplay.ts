/**
 * 群消息发送者展示：把 LID 数字串换成可读名/号码/头像，并供点击私信。
 */
import {
  buildDmContact,
  dmContactId,
  findExistingDmContact,
  memberToDmTarget,
  type GroupMemberDmTarget,
} from "@/lib/groupDm";
import type { Contact, GroupMember, Message } from "@/types/crm";

function digits(s?: string | null) {
  return String(s || "").replace(/\D/g, "");
}

function jidUser(j?: string | null) {
  const s = String(j || "").trim();
  if (!s) return "";
  return s.includes("@") ? s.slice(0, s.indexOf("@")) : s;
}

/** 纯 LID 段 / 内部 id，不能当显示名 */
export function isOpaqueSenderLabel(name?: string | null): boolean {
  const s = String(name || "").trim();
  if (!s) return true;
  if (s === "群成员" || s === "?" || s === "未知" || s === "未知联系人")
    return true;
  if (s.includes("@lid") || s.includes("@s.whatsapp.net") || s.includes("@g.us"))
    return true;
  if (/^\d{10,}$/.test(s)) return true;
  if (/^\+\d{10,}$/.test(s) && s.length > 16) return true;
  return false;
}

export type SenderPresentation = {
  label: string;
  avatarUrl?: string;
  /** 已缓存的高清头像（悬停放大用，避免把小图硬放大） */
  avatarFullUrl?: string;
  dmTarget: GroupMemberDmTarget | null;
  subtitle?: string;
};

export type SenderContactLookup = {
  byChannel: Map<string, Contact>;
  byId: Map<string, Contact>;
  byPhone: Map<string, Contact>;
};

export type SenderMemberLookup = {
  byJid: Map<string, GroupMember>;
  byPhone: Map<string, GroupMember>;
};

export function buildSenderContactLookup(
  contacts: Contact[],
  accountId?: string | null
): SenderContactLookup {
  const lookup: SenderContactLookup = {
    byChannel: new Map(),
    byId: new Map(),
    byPhone: new Map(),
  };
  for (const contact of contacts) {
    if (contact.isGroup) continue;
    if (accountId && contact.accountId && contact.accountId !== accountId) continue;
    if (
      accountId &&
      !contact.accountId &&
      contact.boundPhoneId &&
      contact.boundPhoneId !== accountId
    )
      continue;
    if (contact.channelAddress) lookup.byChannel.set(contact.channelAddress, contact);
    lookup.byId.set(contact.id, contact);
    const phone = digits(contact.phone);
    if (phone) lookup.byPhone.set(phone, contact);
    const channel = String(contact.channelAddress || "");
    if (channel.includes("@s.whatsapp.net") || channel.includes("@c.us")) {
      const channelPhone = digits(channel.split("@")[0].split(":")[0]);
      if (channelPhone) lookup.byPhone.set(channelPhone, contact);
    }
  }
  return lookup;
}

export function buildSenderMemberLookup(
  members: GroupMember[]
): SenderMemberLookup {
  const lookup: SenderMemberLookup = {
    byJid: new Map(),
    byPhone: new Map(),
  };
  for (const member of members) {
    for (const jid of [member.jid, member.lid, member.pnJid]) {
      const key = String(jid || "").trim().toLowerCase();
      if (key) lookup.byJid.set(key, member);
    }
    const phone =
      digits(member.phoneE164) ||
      (member.pnJid && !member.pnJid.includes("@lid")
        ? digits(jidUser(member.pnJid))
        : "");
    if (phone) lookup.byPhone.set(phone, member);
  }
  return lookup;
}

function matchMember(
  senderJid: string | undefined,
  phone: string | undefined,
  members: GroupMember[],
  lookup?: SenderMemberLookup
): GroupMember | undefined {
  const sj = String(senderJid || "").trim().toLowerCase();
  const ph = digits(phone);
  if (lookup) {
    return (
      (sj ? lookup.byJid.get(sj) : undefined) ||
      (ph.length >= 7 ? lookup.byPhone.get(ph) : undefined)
    );
  }
  if (!members?.length) return undefined;
  for (const m of members) {
    const keys = [m.jid, m.lid, m.pnJid]
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean);
    if (sj && keys.includes(sj)) return m;
    if (ph.length >= 7) {
      const mp =
        digits(m.phoneE164) ||
        (m.pnJid && !m.pnJid.includes("@lid") ? digits(jidUser(m.pnJid)) : "");
      if (mp && mp === ph) return m;
    }
  }
  return undefined;
}

function findExistingFromLookup(
  target: GroupMemberDmTarget,
  lookup: SenderContactLookup
): Contact | undefined {
  const addresses = [target.jid, target.lid, target.pnJid]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const address of addresses) {
    const hit = lookup.byChannel.get(address);
    if (hit) return hit;
  }
  for (const address of addresses) {
    const hit = lookup.byId.get(dmContactId(target.accountId, address));
    if (hit) return hit;
  }
  const phone = digits(target.phoneE164);
  return phone.length >= 7 ? lookup.byPhone.get(phone) : undefined;
}

function matchContact(
  senderJid: string | undefined,
  phone: string | undefined,
  contacts: Contact[],
  accountId?: string | null,
  lookup?: SenderContactLookup
): Contact | undefined {
  const sj = String(senderJid || "").trim();
  const ph = digits(phone);
  if (lookup) {
    if (sj) {
      const direct = lookup.byChannel.get(sj);
      if (direct) return direct;
      const stable = `bridge-contact-${encodeURIComponent(`${accountId || ""}:${sj}`)}`;
      const byId = lookup.byId.get(stable);
      if (byId) return byId;
    }
    return ph ? lookup.byPhone.get(ph) : undefined;
  }
  const list = contacts.filter((c) => {
    if (c.isGroup) return false;
    if (accountId && c.accountId && c.accountId !== accountId) return false;
    return true;
  });
  if (sj) {
    const byCh = list.find((c) => c.channelAddress === sj);
    if (byCh) return byCh;
    const aid = accountId || "";
    const stable = `bridge-contact-${encodeURIComponent(`${aid}:${sj}`)}`;
    const byId = list.find((c) => c.id === stable);
    if (byId) return byId;
  }
  if (ph.length >= 7 && ph.length <= 15) {
    return list.find((c) => digits(c.phone) === ph);
  }
  return undefined;
}

export function presentGroupSender(
  m: Pick<
    Message,
    | "senderJid"
    | "senderName"
    | "senderPhoneE164"
    | "senderAvatarUrl"
    | "direction"
  >,
  opts: {
    accountId: string;
    contacts: Contact[];
    members?: GroupMember[];
    contactLookup?: SenderContactLookup;
    memberLookup?: SenderMemberLookup;
  }
): SenderPresentation {
  if (m.direction === "out") {
    return { label: "我", dmTarget: null, avatarUrl: undefined };
  }

  const member = matchMember(
    m.senderJid,
    m.senderPhoneE164,
    opts.members || [],
    opts.memberLookup
  );
  const contact =
    matchContact(
      m.senderJid,
      m.senderPhoneE164 || member?.phoneE164,
      opts.contacts,
      opts.accountId,
      opts.contactLookup
    ) ||
    (member
      ? matchContact(
          member.pnJid || member.jid,
          member.phoneE164,
          opts.contacts,
          opts.accountId,
          opts.contactLookup
        )
      : undefined);

  const phone =
    digits(m.senderPhoneE164) ||
    digits(member?.phoneE164) ||
    digits(contact?.phone) ||
    (member?.pnJid && !member.pnJid.includes("@lid")
      ? digits(jidUser(member.pnJid))
      : "") ||
    "";

  const humanName = [
    contact?.name,
    member?.name,
    !isOpaqueSenderLabel(m.senderName) ? m.senderName : "",
  ]
    .map((x) => String(x || "").trim())
    .find((x) => x && !isOpaqueSenderLabel(x));

  let label = humanName || "";
  if (!label && phone.length >= 7 && phone.length <= 15) {
    label = `+${phone}`;
  }
  if (!label) label = "群成员";

  const avatarUrl =
    m.senderAvatarUrl ||
    contact?.avatarFullUrl ||
    contact?.avatarUrl ||
    member?.avatarUrl ||
    undefined;
  const avatarFullUrl =
    contact?.avatarFullUrl ||
    (member as { avatarFullUrl?: string } | undefined)?.avatarFullUrl ||
    undefined;

  const dmSource: GroupMember = member
    ? member
    : {
        jid: m.senderJid || contact?.channelAddress || "",
        phoneE164: phone
          ? `+${phone}`
          : contact?.phone || undefined,
        pnJid:
          contact?.channelAddress &&
          contact.channelAddress.includes("@s.whatsapp.net")
            ? contact.channelAddress
            : undefined,
        lid: m.senderJid?.includes("@lid") ? m.senderJid : undefined,
        name: humanName,
        avatarUrl,
      };

  const dmTarget =
    memberToDmTarget(
      {
        ...dmSource,
        displayName: label !== "群成员" ? label : humanName,
      },
      opts.accountId
    ) || null;

  if (dmTarget) {
    const existing = opts.contactLookup
      ? findExistingFromLookup(dmTarget, opts.contactLookup)
      : findExistingDmContact(opts.contacts, dmTarget);
    if (existing) {
      const existingLabel =
        existing.name && !isOpaqueSenderLabel(existing.name)
          ? existing.name
          : label;
      return {
        label: existingLabel,
        avatarUrl: existing.avatarUrl || avatarUrl,
        avatarFullUrl: existing.avatarFullUrl || avatarFullUrl,
        dmTarget,
        subtitle: phone ? `+${phone}` : undefined,
      };
    }
  }

  return {
    label,
    avatarUrl,
    avatarFullUrl,
    dmTarget,
    subtitle: phone && label !== `+${phone}` ? `+${phone}` : undefined,
  };
}

export function openOrBuildDmContact(
  target: GroupMemberDmTarget,
  contacts: Contact[]
): Contact {
  return findExistingDmContact(contacts, target) || buildDmContact(target);
}
