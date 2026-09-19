/**
 * 群事件：成员变更 → 系统消息 + 刷新摘要。
 */
import {
  formatParticipantUpdateBody,
  normalizeGroupMetadata,
  participantRefToJid,
} from "./groupMeta.mjs";

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
      if (n) return n;
    }
    const c = deps.contacts.get(jid);
    if (c?.displayName) return c.displayName;
    const phone = String(jid).replace(/@.+$/, "");
    return phone || jid;
  };

  const onUpdate = (update) => {
    const id = update?.id;
    if (!id || !String(id).endsWith("@g.us")) return;

    const body = formatParticipantUpdateBody(update, nameOf);
    const ts = Date.now();
    const msgId = `sys-gpart-${id}-${ts}-${String(update?.action || "x")}`;
    const participantJids = (
      Array.isArray(update?.participants) ? update.participants : []
    )
      .map((p) => participantRefToJid(p))
      .filter(Boolean);
    const authorJid = participantRefToJid(update?.author);
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

  sock.ev.on("group-participants.update", onUpdate);
  return () => {
    try {
      sock.ev.off("group-participants.update", onUpdate);
    } catch {
      /* ignore */
    }
  };
}
