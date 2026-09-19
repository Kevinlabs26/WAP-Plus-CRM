function ingestString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function looksLikeMessageAsName(raw?: string | null): boolean {
  if (!raw) return false;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length > 80) return true;
  if (/https?:\/\//i.test(s)) return true;
  if ((s.match(/[?!。.!?]/g) || []).length >= 2 && s.length > 24) return true;
  if (
    /^(salut|bonjour|bonsoir|hello|hi|merci)\b/i.test(s) &&
    s.length > 28 &&
    /\s/.test(s)
  )
    return true;
  return false;
}

function isInternalContactName(n: string, opts?: { isGroup?: boolean }): boolean {
  if (!n) return true;
  const t = n.trim().toLowerCase();
  if (
    t === "未知联系人" ||
    t === "未知" ||
    t === "unknown" ||
    t === "群成员" ||
    t === "号码解析中…" ||
    t === "号码解析中..." ||
    t === "未备注联系人"
  )
    return true;
  if (t === "群聊") return true;
  if (
    n.includes("@lid") ||
    n.includes("@s.whatsapp.net") ||
    n.includes("@g.us")
  )
    return true;
  const compact = n.replace(/[\s().-]/g, "");
  if (/^\d{10,}$/.test(n) || /^\+?\d{7,15}$/.test(compact)) return true;
  if (!opts?.isGroup && looksLikeMessageAsName(n)) return true;
  return false;
}

function looksLikeSelfContact(
  c: { name?: string; phone?: string; channelAddress?: string },
  selfName: string
): boolean {
  if (selfName && (c.name || "").trim() === selfName) {
    const ph = (c.phone || "").trim();
    if (!ph || ph === selfName) return true;
  }
  return false;
}

function normalizeIngestPhone(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  // WhatsApp LID：不当作可拨打号码写入 CRM
  if (s.includes("@lid")) return "";
  if (s.includes("@s.whatsapp.net") || s.includes("@c.us")) {
    const d = s.split("@")[0].split(":")[0];
    return d && /^\d{7,15}$/.test(d) ? `+${d}` : "";
  }
  if (s.startsWith("+") && /^\+\d{7,15}$/.test(s)) return s;
  if (/^\d{7,15}$/.test(s)) return `+${s}`;
  // 超长数字串多半是内部 id
  if (/^\d{16,}$/.test(s)) return "";
  return "";
}

/**
 * 纯解析层：把单条 bridge 联系人 item 解析为结构化身份信息。
 * 不访问 bag / store，便于单测。
 * 返回 null 表示本条应被丢弃（无可识别身份，或幽灵「自己」）。
 */

export type ParsedContactItem = {
  jid: string;
  pnJid: string;
  channelAddress: string;
  isGroup: boolean;
  participantCount: number;
  phone: string;
  name: string;
  niceName: string;
  avatarUrl: string;
  avatarFullUrl: string;
};

export function parseContactItem(
  item: Record<string, unknown>,
  selfName: string
): ParsedContactItem | null {
  const string = ingestString;
  const normalizePhone = normalizeIngestPhone;

  const jid = string(item.jid, 120);
  const pnJid = string(item.pnJid, 120);
  let channelAddress = string(item.channelAddress ?? item.lidJid, 120);
  if (!channelAddress && jid.includes("@lid")) channelAddress = jid;
  if (!channelAddress && string(item.lid, 120).includes("@lid")) {
    channelAddress = string(item.lid, 120);
  }
  const isGroup =
    Boolean(item.isGroup) ||
    jid.endsWith("@g.us") ||
    channelAddress.endsWith("@g.us");
  const participantCount = Number(item.participantCount);
  const phone = isGroup
    ? ""
    : normalizePhone(
        string(item.phoneE164 ?? item.phone ?? item.phoneNumber, 80) ||
          pnJid ||
          (jid.includes("@lid") ? "" : jid)
      );
  const nameCandidates = [
    item.displayName,
    item.name,
    item.subject,
    item.notify,
    item.pushName,
    item.verifiedName,
  ].map((value) => string(value, 200));
  // displayName/name 偶尔是电话号码；继续向后找 WhatsApp 默认昵称。
  let name =
    nameCandidates.find(
      (candidate) => candidate && !isInternalContactName(candidate, { isGroup })
    ) || nameCandidates.find(Boolean) || "";
  if (isInternalContactName(name, { isGroup })) name = "";
  if (!phone && !name && !jid && !channelAddress) return null;

  const avatarUrl = string(item.avatarUrl ?? item.imgUrl, 3_500_000);
  const avatarFullUrl = string(item.avatarFullUrl, 3_500_000);
  const niceName =
    (name && !isInternalContactName(name, { isGroup }) ? name : "") ||
    (isGroup ? "群聊" : phone || "");

  if (
    looksLikeSelfContact(
      { name: niceName || name, phone, channelAddress },
      selfName
    ) &&
    !phone
  ) {
    return null;
  }

  return {
    jid,
    pnJid,
    channelAddress,
    isGroup,
    participantCount,
    phone,
    name,
    niceName,
    avatarUrl,
    avatarFullUrl,
  };
}
