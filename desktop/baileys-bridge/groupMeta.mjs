/**
 * GroupMetadata 规范化（纯函数，无 socket 依赖）。
 * 与 Baileys GroupMetadata / GroupParticipant 对齐。
 */

function str(v) {
  return v == null ? "" : String(v).trim();
}

/**
 * @param {import('baileys').GroupParticipant | Record<string, unknown>} p
 */
export function normalizeGroupParticipant(p) {
  if (!p || typeof p !== "object") return null;
  const id = str(p.id || p.jid || p.lid);
  if (!id) return null;
  const adminRaw = p.admin;
  let role = "member";
  if (p.isSuperAdmin || adminRaw === "superadmin") role = "superadmin";
  else if (p.isAdmin || adminRaw === "admin") role = "admin";

  const lid = str(p.lid) || (id.endsWith("@lid") ? id : "");
  const pnJid = str(p.phoneNumber || p.pnJid || p.jidPn || "");
  const phone =
    str(p.phoneNumber).replace(/@.+$/, "") ||
    (pnJid.includes("@") ? pnJid.replace(/@.+$/, "") : "") ||
    (id.includes("@s.whatsapp.net") || id.includes("@c.us")
      ? id.replace(/@.+$/, "")
      : "") ||
    str(p.pn) ||
    "";

  return {
    jid: id,
    phoneE164: phone || undefined,
    lid: lid || undefined,
    // 便于前端/通讯录按 PN jid 反查
    pnJid: pnJid.endsWith("@s.whatsapp.net")
      ? pnJid
      : phone
        ? `${String(phone).replace(/\D/g, "")}@s.whatsapp.net`
        : undefined,
    name: str(p.name || p.notify || p.verifiedName || p.pushName) || undefined,
    role,
    isAdmin: role === "admin" || role === "superadmin",
    isSuperAdmin: role === "superadmin",
  };
}

/**
 * @param {import('baileys').GroupMetadata | Record<string, unknown>} meta
 */
export function normalizeGroupMetadata(meta) {
  if (!meta || typeof meta !== "object") return null;
  const id = str(meta.id || meta.jid);
  if (!id.endsWith("@g.us")) return null;

  const participants = Array.isArray(meta.participants)
    ? meta.participants
        .map((p) => normalizeGroupParticipant(p))
        .filter(Boolean)
    : [];

  const subject = str(meta.subject || meta.name || meta.displayName);
  const size =
    Number(meta.size) ||
    participants.length ||
    Number(meta.participantCount) ||
    0;

  return {
    jid: id,
    subject,
    desc: str(meta.desc) || undefined,
    owner: str(meta.owner || meta.ownerPn) || undefined,
    ownerPn: str(meta.ownerPn) || undefined,
    creation: Number(meta.creation) || undefined,
    subjectTime: Number(meta.subjectTime) || undefined,
    descTime: Number(meta.descTime) || undefined,
    participantCount: size,
    participants,
    announce: Boolean(meta.announce),
    restrict: Boolean(meta.restrict),
    memberAddMode: Boolean(meta.memberAddMode),
    joinApprovalMode: Boolean(meta.joinApprovalMode),
    ephemeralDuration: Number(meta.ephemeralDuration) || 0,
    isCommunity: Boolean(meta.isCommunity),
    isCommunityAnnounce: Boolean(meta.isCommunityAnnounce),
    linkedParent: str(meta.linkedParent) || undefined,
    addressingMode: str(meta.addressingMode) || undefined,
    inviteCode: str(meta.inviteCode) || undefined,
  };
}

/** 从邀请链接或纯 code 提取邀请码 */
export function extractInviteCode(input) {
  const raw = str(input);
  if (!raw) return "";
  // https://chat.whatsapp.com/XXXX 或 chat.whatsapp.com/XXXX
  const m = raw.match(
    /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]+)/i
  );
  if (m?.[1]) return m[1];
  // 纯 code
  if (/^[A-Za-z0-9_-]{8,64}$/.test(raw)) return raw;
  return "";
}

/**
 * Baileys group-participants.update 里 participants 可能是：
 * - string jid
 * - { id / jid / lid / phoneNumber }
 * 绝不能 String(object)，否则会变成 [object Object]
 */
export function participantRefToJid(p) {
  if (p == null) return "";
  if (typeof p === "string" || typeof p === "number") return str(p);
  if (typeof p !== "object") return "";
  return str(
    p.id ||
      p.jid ||
      p.lid ||
      p.phoneNumber ||
      p.participant ||
      p.pnJid ||
      ""
  );
}

function displayPhoneTail(jidOrPhone) {
  const s = str(jidOrPhone);
  if (!s) return "";
  const user = s.includes("@") ? s.replace(/@.+$/, "") : s;
  const digits = user.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  if (user && user.length <= 24 && !user.includes("{")) return user;
  return "";
}

/**
 * 成员变更 → 可读系统文案
 * @param {{ action?: string, participants?: any[], author?: any }} update
 * @param {(jid: string) => string} [nameOf]
 */
export function formatParticipantUpdateBody(update, nameOf = (j) => j) {
  const action = str(update?.action || "modify");
  const people = (Array.isArray(update?.participants)
    ? update.participants
    : []
  )
    .map((p) => {
      const jid = participantRefToJid(p);
      if (!jid) return "";
      const named = nameOf(jid);
      // nameOf 若仍返回空/像 jid，尽量给可读号码
      if (named && named !== jid && !named.includes("@")) return named;
      return displayPhoneTail(jid) || named || jid;
    })
    .filter(Boolean);
  const who = people.length ? people.join("、") : "成员";
  const authorJid = participantRefToJid(update?.author);
  let by = "";
  if (authorJid) {
    const an = nameOf(authorJid);
    const authorLabel =
      an && an !== authorJid && !String(an).includes("@")
        ? an
        : displayPhoneTail(authorJid) || an || authorJid;
    by = `（操作者 ${authorLabel}）`;
  }

  switch (action) {
    case "add":
      return `${who} 加入了群组${by}`;
    case "remove":
      return `${who} 被移出群组${by}`;
    case "promote":
      return `${who} 成为管理员${by}`;
    case "demote":
      return `${who} 被取消管理员${by}`;
    default:
      return `群成员变更：${who}${by}`;
  }
}
