/**
 * 群写操作（需管理员/成员权限，失败由 WhatsApp 返回）。
 * 与 groupService（只读）分离，避免读写混杂。
 */
import { extractInviteCode, normalizeGroupMetadata } from "./groupMeta.mjs";

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * @param {{
 *   getSocket: () => any,
 *   getConnection: () => string,
 *   groupService: { fetchMetadata: Function, applyGroupSummary?: Function },
 *   resolveSendJid?: (addr: string) => Promise<string>,
 *   syncDbg?: Function,
 * }} deps
 */
export function createGroupWriteService(deps) {
  const dbg = deps.syncDbg || (() => {});

  function requireSock() {
    const sock = deps.getSocket?.();
    if (!sock || deps.getConnection?.() !== "connected") {
      throw err("WhatsApp 尚未连接", "not_connected");
    }
    return sock;
  }

  function assertGroupJid(jid) {
    const id = String(jid || "").trim();
    if (!id.endsWith("@g.us")) throw err("不是群 JID（需 @g.us）", "invalid_jid");
    return id;
  }

  async function resolveParticipantJids(list) {
    const out = [];
    for (const raw of list || []) {
      const s = String(raw || "").trim();
      if (!s) continue;
      if (s.includes("@")) {
        out.push(s);
        continue;
      }
      if (typeof deps.resolveSendJid === "function") {
        try {
          const j = await deps.resolveSendJid(s);
          if (j) {
            out.push(j);
            continue;
          }
        } catch {
          /* fallthrough */
        }
      }
      const digits = s.replace(/\D/g, "");
      if (digits.length >= 8) out.push(`${digits}@s.whatsapp.net`);
      else throw err(`无法解析成员：${s}`, "invalid_participant");
    }
    return [...new Set(out)];
  }

  async function refresh(jid) {
    if (typeof deps.groupService?.fetchMetadata === "function") {
      return deps.groupService.fetchMetadata(jid, { apply: true, push: true });
    }
    return null;
  }

  async function updateSubject(jid, subject) {
    const id = assertGroupJid(jid);
    const name = String(subject || "").trim().slice(0, 100);
    if (!name) throw err("群名称不能为空", "invalid_subject");
    const sock = requireSock();
    await sock.groupUpdateSubject(id, name);
    dbg("group.updateSubject", { id, name });
    return refresh(id);
  }

  async function updateDescription(jid, description) {
    const id = assertGroupJid(jid);
    const sock = requireSock();
    const desc = String(description ?? "").slice(0, 2048);
    await sock.groupUpdateDescription(id, desc);
    dbg("group.updateDescription", { id, len: desc.length });
    return refresh(id);
  }

  async function participantsUpdate(jid, action, participants) {
    const id = assertGroupJid(jid);
    const act = String(action || "").toLowerCase();
    if (!["add", "remove", "promote", "demote"].includes(act)) {
      throw err("action 须为 add|remove|promote|demote", "invalid_action");
    }
    const jids = await resolveParticipantJids(participants);
    if (!jids.length) throw err("成员列表为空", "empty_participants");
    const sock = requireSock();
    const result = await sock.groupParticipantsUpdate(id, jids, act);
    dbg("group.participantsUpdate", { id, act, n: jids.length });
    const group = await refresh(id);
    return { result, group };
  }

  async function getInviteCode(jid) {
    const id = assertGroupJid(jid);
    const sock = requireSock();
    const code = await sock.groupInviteCode(id);
    if (!code) throw err("无法获取邀请码（可能无权限）", "invite_failed");
    return {
      inviteCode: code,
      inviteUrl: `https://chat.whatsapp.com/${code}`,
    };
  }

  async function revokeInvite(jid) {
    const id = assertGroupJid(jid);
    const sock = requireSock();
    const code = await sock.groupRevokeInvite(id);
    return {
      inviteCode: code || "",
      inviteUrl: code ? `https://chat.whatsapp.com/${code}` : "",
    };
  }

  async function acceptInvite(codeOrUrl) {
    const code = extractInviteCode(codeOrUrl);
    if (!code) throw err("无效的群邀请链接或邀请码", "invalid_invite");
    const sock = requireSock();
    if (typeof sock.groupAcceptInvite !== "function") {
      throw err("当前 Baileys 不支持 groupAcceptInvite", "unsupported");
    }
    const gid = await sock.groupAcceptInvite(code);
    dbg("group.acceptInvite", { code, gid });
    let group = null;
    if (gid) {
      try {
        group = await refresh(String(gid));
      } catch {
        group = normalizeGroupMetadata({ id: gid, subject: "" });
      }
    }
    return { groupJid: gid || "", group };
  }

  async function leave(jid) {
    const id = assertGroupJid(jid);
    const sock = requireSock();
    await sock.groupLeave(id);
    dbg("group.leave", { id });
    return { ok: true, jid: id };
  }

  /**
   * @param {string} jid
   * @param {{
   *   announcement?: boolean,
   *   locked?: boolean,
   *   memberAddMode?: 'admin_add'|'all_member_add',
   *   joinApprovalMode?: 'on'|'off',
   * }} patch
   */
  async function updateSettings(jid, patch = {}) {
    const id = assertGroupJid(jid);
    const sock = requireSock();
    const done = [];
    if (typeof patch.announcement === "boolean") {
      await sock.groupSettingUpdate(
        id,
        patch.announcement ? "announcement" : "not_announcement"
      );
      done.push(patch.announcement ? "announcement" : "not_announcement");
    }
    if (typeof patch.locked === "boolean") {
      await sock.groupSettingUpdate(id, patch.locked ? "locked" : "unlocked");
      done.push(patch.locked ? "locked" : "unlocked");
    }
    if (
      patch.memberAddMode === "admin_add" ||
      patch.memberAddMode === "all_member_add"
    ) {
      await sock.groupMemberAddMode(id, patch.memberAddMode);
      done.push(`memberAdd:${patch.memberAddMode}`);
    }
    if (patch.joinApprovalMode === "on" || patch.joinApprovalMode === "off") {
      await sock.groupJoinApprovalMode(id, patch.joinApprovalMode);
      done.push(`joinApproval:${patch.joinApprovalMode}`);
    }
    if (!done.length) throw err("未提供可识别的设置项", "empty_settings");
    dbg("group.updateSettings", { id, done });
    const group = await refresh(id);
    return { done, group };
  }

  async function listJoinRequests(jid) {
    const id = assertGroupJid(jid);
    const sock = requireSock();
    if (typeof sock.groupRequestParticipantsList !== "function") {
      throw err("当前 Baileys 不支持入群申请列表", "unsupported");
    }
    const rows = await sock.groupRequestParticipantsList(id);
    // Baileys: participants.map(v => v.attrs) → { jid, t, method, ... }
    const list = (Array.isArray(rows) ? rows : []).map((row) => {
      if (!row || typeof row !== "object") return null;
      const jidKey = String(row.jid || row.id || "").trim();
      if (!jidKey) return null;
      const status = String(
        row.request_method || row.method || row.status || row.t || ""
      ).trim();
      return { jid: jidKey, status, raw: row };
    }).filter(Boolean);
    dbg("group.listJoinRequests", { id, n: list.length });
    return list;
  }

  async function updateJoinRequests(jid, action, participants) {
    const id = assertGroupJid(jid);
    const act = String(action || "").toLowerCase();
    if (act !== "approve" && act !== "reject") {
      throw err("action 须为 approve|reject", "invalid_action");
    }
    const jids = await resolveParticipantJids(participants);
    if (!jids.length) throw err("成员列表为空", "empty_participants");
    const sock = requireSock();
    if (typeof sock.groupRequestParticipantsUpdate !== "function") {
      throw err("当前 Baileys 不支持入群申请审批", "unsupported");
    }
    const result = await sock.groupRequestParticipantsUpdate(id, jids, act);
    dbg("group.updateJoinRequests", { id, act, n: jids.length });
    const pending = await listJoinRequests(id).catch(() => []);
    const group = await refresh(id);
    return { result, pending, group };
  }

  async function createGroup(subject, participants = []) {
    const name = String(subject || "").trim().slice(0, 100);
    if (!name) throw err("群名称不能为空", "invalid_subject");
    const sock = requireSock();
    if (typeof sock.groupCreate !== "function") {
      throw err("当前 Baileys 不支持建群", "unsupported");
    }
    const jids = await resolveParticipantJids(participants);
    const meta = await sock.groupCreate(name, jids);
    let group = null;
    try {
      const id = meta?.id || meta?.gid || "";
      if (id) group = await refresh(id);
    } catch {
      /* ignore */
    }
    if (!group && meta) {
      group = normalizeGroupMetadata(meta);
      if (group && typeof deps.groupService?.applyGroupSummary === "function") {
        deps.groupService.applyGroupSummary(group);
      }
    }
    dbg("group.create", {
      subject: name,
      jid: group?.jid || meta?.id,
      members: jids.length,
    });
    return { group, raw: meta };
  }

  return {
    updateSubject,
    updateDescription,
    participantsUpdate,
    getInviteCode,
    revokeInvite,
    acceptInvite,
    leave,
    updateSettings,
    listJoinRequests,
    updateJoinRequests,
    createGroup,
  };
}
