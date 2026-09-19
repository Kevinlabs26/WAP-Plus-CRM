/**
 * 群只读能力：metadata / 邀请解析 / 写入 contacts 摘要字段。
 * 依赖由 createGroupService(deps) 注入，避免与 index 循环耦合。
 */
import {
  extractInviteCode,
  normalizeGroupMetadata,
} from "./groupMeta.mjs";

function identityTokens(values) {
  const out = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) continue;
    out.add(raw);
    const user = raw.split("@")[0];
    if (user) out.add(user);
    const digits = user.replace(/\D/g, "");
    if (digits) {
      out.add(digits);
      out.add(`${digits}@s.whatsapp.net`);
    }
  }
  return out;
}

/** 纯身份匹配，兼容 PN、LID 和群成员 phoneNumber 字段。 */
export function commonGroupTargetMatches(target, participants) {
  const targetTokens = identityTokens([
    ...(Array.isArray(target?.jids) ? target.jids : []),
    target?.phone,
  ]);
  if (!targetTokens.size) return false;
  return (Array.isArray(participants) ? participants : []).some((participant) => {
    const values = [
      participant?.id,
      participant?.jid,
      participant?.lid,
      participant?.phoneNumber,
      participant?.pnJid,
      participant?.phoneE164,
    ];
    return [...identityTokens(values)].some((token) => targetTokens.has(token));
  });
}

/**
 * @param {{
 *   getSocket: () => any,
 *   getConnection: () => string,
 *   contacts: Map<string, any>,
 *   upsertContact: (jid: string, name?: string, phone?: string) => any,
 *   scheduleContactsPush?: () => void,
 *   syncDbg?: (msg: string, data?: object) => void,
 * }} deps
 */
export function createGroupService(deps) {
  const dbg = deps.syncDbg || (() => {});
  const commonGroupsCache = new Map();

  function requireSock() {
    const sock = deps.getSocket?.();
    const conn = deps.getConnection?.();
    if (!sock || conn !== "connected") {
      const err = new Error("WhatsApp 尚未连接");
      err.code = "not_connected";
      throw err;
    }
    return sock;
  }

  /**
   * 把规范化 metadata 摘要写入 contacts map（不存完整 members，避免内存膨胀）。
   * 完整成员仅通过 API 返回。
   */
  function applyGroupSummary(norm) {
    if (!norm?.jid) return null;
    const c = deps.upsertContact(norm.jid, norm.subject || "");
    if (!c) return null;
    c.isGroup = true;
    if (norm.subject) c.displayName = norm.subject;
    if (norm.participantCount) c.participantCount = norm.participantCount;
    if (norm.owner) c.groupOwner = norm.owner;
    c.groupDesc = norm.desc || c.groupDesc || "";
    c.groupAnnounce = Boolean(norm.announce);
    c.groupRestrict = Boolean(norm.restrict);
    c.groupEphemeral = Number(norm.ephemeralDuration) || 0;
    c.groupJoinApproval = Boolean(norm.joinApprovalMode);
    c.groupMemberAddMode = Boolean(norm.memberAddMode);
    c.groupLinkedParent = norm.linkedParent || "";
    c.groupIsCommunity = Boolean(norm.isCommunity);
    c.groupMetaAt = Date.now();
    deps.contacts.set(norm.jid, c);
    return c;
  }

  function findContactForJid(jid) {
    if (!jid || !deps.contacts) return null;
    const direct = deps.contacts.get(jid);
    if (direct) return direct;
    const user = String(jid).replace(/@.+$/, "");
    const digits = user.replace(/\D/g, "");
    for (const c of deps.contacts.values()) {
      if (!c || c.isGroup) continue;
      if (c.jid === jid || c.lidJid === jid || c.pnJid === jid) return c;
      if (c.phoneE164 && digits && c.phoneE164.replace(/\D/g, "") === digits)
        return c;
      if (user && String(c.jid || "").startsWith(user + "@")) return c;
      if (user && String(c.lidJid || "").startsWith(user + "@")) return c;
    }
    return null;
  }

  /** 用 bridge 内存通讯录给成员补 displayName / avatar */
  function enrichParticipants(participants) {
    return (participants || []).map((p) => {
      if (!p?.jid) return p;
      const c =
        findContactForJid(p.jid) ||
        (p.lid ? findContactForJid(p.lid) : null) ||
        (p.phoneE164
          ? findContactForJid(`${String(p.phoneE164).replace(/\D/g, "")}@s.whatsapp.net`)
          : null);
      if (!c) return p;
      const name = String(c.displayName || "").trim();
      return {
        ...p,
        name: name || p.name,
        phoneE164: p.phoneE164 || c.phoneE164 || undefined,
        avatarUrl: c.avatarUrl || undefined,
      };
    });
  }

  async function fetchMetadata(jid, opts = {}) {
    const id = String(jid || "").trim();
    if (!id.endsWith("@g.us")) {
      const err = new Error("不是群 JID（需 @g.us）");
      err.code = "invalid_jid";
      throw err;
    }
    const sock = requireSock();
    const meta = await sock.groupMetadata(id);
    const norm = normalizeGroupMetadata(meta);
    if (!norm) {
      const err = new Error("无法解析群元数据");
      err.code = "parse_failed";
      throw err;
    }
    norm.participants = enrichParticipants(norm.participants);
    if (opts.apply !== false) {
      applyGroupSummary(norm);
      if (opts.push !== false && typeof deps.scheduleContactsPush === "function") {
        deps.scheduleContactsPush();
      }
    }
    dbg("group.fetchMetadata", {
      jid: id,
      subject: norm.subject,
      n: norm.participantCount,
      named: (norm.participants || []).filter((x) => x.name).length,
    });
    return norm;
  }

  async function fetchCommonGroups(target, opts = {}) {
    const sock = requireSock();
    if (typeof sock.groupFetchAllParticipating !== "function") {
      const err = new Error("当前 Baileys 不支持读取参与中的群组");
      err.code = "unsupported";
      throw err;
    }
    const cacheKey = JSON.stringify({
      jids: [...(Array.isArray(target?.jids) ? target.jids : [])].sort(),
      phone: String(target?.phone || "").trim(),
    });
    const cached = commonGroupsCache.get(cacheKey);
    if (!opts.force && cached && cached.expiresAt > Date.now()) return cached.groups;

    const all = await sock.groupFetchAllParticipating();
    const groups = [];
    for (const group of Object.values(all && typeof all === "object" ? all : {})) {
      const norm = normalizeGroupMetadata(group);
      if (!norm || !commonGroupTargetMatches(target, norm.participants)) continue;
      // 共同群组只需要列表摘要，不把完整成员表传到前端。
      const { participants: _participants, ...summary } = norm;
      groups.push(summary);
    }
    groups.sort((a, b) => String(a.subject || a.jid).localeCompare(String(b.subject || b.jid)));
    commonGroupsCache.set(cacheKey, { expiresAt: Date.now() + 60_000, groups });
    dbg("group.common", { groups: groups.length });
    return groups;
  }

  async function fetchInviteInfo(codeOrUrl) {
    const code = extractInviteCode(codeOrUrl);
    if (!code) {
      const err = new Error("无效的群邀请链接或邀请码");
      err.code = "invalid_invite";
      throw err;
    }
    const sock = requireSock();
    if (typeof sock.groupGetInviteInfo !== "function") {
      const err = new Error("当前 Baileys 不支持 groupGetInviteInfo");
      err.code = "unsupported";
      throw err;
    }
    const meta = await sock.groupGetInviteInfo(code);
    const norm = normalizeGroupMetadata(meta);
    const groupJid = norm?.jid || meta?.id || "";

    // 尝试拉取群组专属真实头像（preview 模式）
    let avatarUrl = "";
    if (groupJid) {
      try {
        const rawPic = await sock.profilePictureUrl(groupJid, "preview", 10_000);
        if (rawPic && typeof deps.fetchAvatarDataUrl === "function") {
          avatarUrl = await deps.fetchAvatarDataUrl(rawPic);
        } else if (rawPic) {
          avatarUrl = rawPic;
        }
      } catch {
        // 部分群可能未设头像或限制权限，忽略异常
      }
    }

    return {
      inviteCode: code,
      ...(norm || {}),
      // 邀请信息有时 id 形态不同，尽量保留原始
      jid: groupJid,
      subject: norm?.subject || meta?.subject || "",
      avatarUrl: avatarUrl || undefined,
    };
  }

  return {
    applyGroupSummary,
    fetchMetadata,
    fetchCommonGroups,
    fetchInviteInfo,
    extractInviteCode,
  };
}
