/**
 * 群事件：成员变更 → 系统消息 + 刷新摘要。
 */
import {
  formatParticipantUpdateBody,
  normalizeGroupMetadata,
  participantRefToJid,
} from "./groupMeta.mjs";
import { messageTimestampMs } from "./messageTimestamp.mjs";

export function liveGroupJoin(message, type, stubTypes, isSelfJid) {
  const groupJid = message?.key?.remoteJid;
  const messageId = message?.key?.id;
  if (type !== "notify" || !groupJid?.endsWith("@g.us") || !messageId ||
      ![stubTypes.GROUP_PARTICIPANT_ADD, stubTypes.GROUP_PARTICIPANT_INVITE,
        stubTypes.GROUP_PARTICIPANT_ADD_REQUEST_JOIN].includes(message.messageStubType)) return;
  const joinedAt = messageTimestampMs(message.messageTimestamp, 0);
  if (!joinedAt) return;
  const hasNewMember = message.messageStubParameters?.some(value => {
    try {
      const member = JSON.parse(value);
      const jid = participantRefToJid(member);
      return !!jid && ![jid, member?.lid, member?.phoneNumber, member?.pnJid].some(candidate => candidate && isSelfJid(candidate));
    } catch { return false; }
  });
  if (hasNewMember) return { groupJid, messageId, joinedAt };
}

/**
 * @param {{
 *   getSocket: () => any,
 *   contacts: Map<string, any>,
 *   messages: Map<string, any>,
 *   upsertContact: (jid: string, name?: string, phone?: string) => any,
 *   applyGroupSummary?: (norm: object) => any,
 *   scheduleContactsPush?: () => void,
 *   push: (type: string, payload: object) => void,
 *   lookupName?: (jid: string) => string,
 * }} deps
 */
export function attachGroupParticipantEvents(sock, deps) {
  if (!sock?.ev?.on) return () => {};

  const nameOf = (jid) => {
    if (!jid) return "";
    if (typeof deps.lookupName === "function") {
      const n = deps.lookupName(jid);
      if (n && !(jid.endsWith("@lid") && /^\+?\d+$/.test(n.trim()))) return n;
    }
    const c = deps.contacts.get(jid);
    if (c?.displayName && !(jid.endsWith("@lid") && /^\+?\d+$/.test(c.displayName.trim()))) {
      return c.displayName;
    }
    return jid;
  };

  const onUpdate = async (update) => {
    const id = update?.id;
    if (!id || !String(id).endsWith("@g.us")) return;

    const ts = Date.now();
    const msgId = `sys-gpart-${id}-${ts}-${String(update?.action || "x")}`;
    const phoneJid = (value) => {
      const match = /^\+?([1-9]\d{6,14})(?::\d+)?(?:@(?:s\.whatsapp\.net|c\.us))?$/.exec(String(value || "").trim());
      return match ? match[1] + "@s.whatsapp.net" : "";
    };
    const cachedMembers = deps.getCachedParticipants?.(id) || [];
    const identities = new Map(cachedMembers.flatMap((member) =>
      [member.id, member.jid, member.lid].filter(Boolean).map((jid) => [jid, member])
    ));
    const resolve = async (ref, explicitPhone) => {
      const jid = participantRefToJid(ref);
      if (!jid) return "";
      const known = identities.get(jid);
      const supplied = [explicitPhone, ref?.phoneNumber, ref?.pnJid, ref?.jidPn,
        known?.phoneNumber, known?.pnJid, deps.contacts.get(jid)?.phoneE164]
        .map(phoneJid).find(Boolean);
      if (!jid.endsWith("@lid")) return phoneJid(jid) || supplied || jid;
      const resolved = supplied || phoneJid(await deps.resolvePnJid?.(jid));
      return resolved || jid;
    };
    const refs = Array.isArray(update?.participants) ? update.participants : [];
    const [participants, authorJid] = await Promise.all([
      Promise.all(refs.map((ref) => resolve(ref))),
      resolve(update?.author || update?.authorPn, update?.authorPn),
    ]);
    const participantJids = participants.filter(Boolean);
    const originalByResolved = new Map(participants.map((jid, index) => [jid, participantRefToJid(refs[index])]));
    if (authorJid && update?.author) originalByResolved.set(authorJid, participantRefToJid(update.author));
    const body = formatParticipantUpdateBody({ ...update, participants: participantJids, author: authorJid }, (jid) => {
      const original = originalByResolved.get(jid);
      const name = nameOf(jid);
      return name === jid && original && original !== jid ? nameOf(original) : name;
    });
    const sysMsg = {
      id: msgId,
      jid: id,
      channelAddress: id,
      body,
      direction: "in",
      sentAt: ts,
      displayName: deps.contacts.get(id)?.displayName || "群聊",
      isGroup: true,
      groupJid: id,
      mediaType: "system",
      systemKind: "group_participants",
      systemAction: update?.action || "modify",
      // 只存 jid 字符串，避免前端/落库出现 [object Object]
      systemParticipants: participantJids,
      systemAuthor: authorJid || "",
    };
    deps.messages.set(msgId, sysMsg);
    deps.push("messages.sync", {
      items: [sysMsg],
      live: true,
      source: "group-participants",
    });

    // 预览更新
    const c0 = deps.contacts.get(id) || deps.upsertContact(id, "");
    if (c0) {
      c0.isGroup = true;
      c0.lastMessage = body;
      c0.updatedAt = ts;
      deps.contacts.set(id, c0);
    }

    void sock
      .groupMetadata(id)
      .then((meta) => {
        const norm = normalizeGroupMetadata(meta);
        if (!norm) return;
        if (typeof deps.applyGroupSummary === "function") {
          deps.applyGroupSummary(norm);
        } else {
          const c = deps.upsertContact(id, norm.subject || "");
          if (c) {
            c.isGroup = true;
            c.participantCount = norm.participantCount;
            if (norm.owner) c.groupOwner = norm.owner;
            deps.contacts.set(id, c);
          }
        }
        if (typeof deps.scheduleContactsPush === "function") {
          deps.scheduleContactsPush();
        }
      })
      .catch(() => undefined);
  };

  const handleUpdate = (update) => { void onUpdate(update).catch(() => undefined); };
  sock.ev.on("group-participants.update", handleUpdate);
  return () => {
    try {
      sock.ev.off("group-participants.update", handleUpdate);
    } catch {
      /* ignore */
    }
  };
}
