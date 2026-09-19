/**
 * 入群申请实时事件 → 推送给桌面端（通知 + 可选系统消息）。
 */
import { normalizeGroupMetadata } from "./groupMeta.mjs";

function labelAction(action) {
  const a = String(action || "");
  if (a === "created") return "申请加入";
  if (a === "revoked") return "撤销了入群申请";
  if (a === "rejected") return "入群申请被拒绝";
  return a || "入群申请变更";
}

/**
 * @param {any} sock
 * @param {{
 *   contacts: Map<string, any>,
 *   messages: Map<string, any>,
 *   upsertContact: Function,
 *   push: (type: string, payload: object) => void,
 *   applyGroupSummary?: Function,
 *   scheduleContactsPush?: Function,
 *   lookupName?: (jid: string) => string,
 * }} deps
 */
export function attachGroupJoinRequestEvents(sock, deps) {
  if (!sock?.ev?.on) return () => {};

  const nameOf = (jid) => {
    if (!jid) return "";
    if (typeof deps.lookupName === "function") {
      const n = deps.lookupName(jid);
      if (n) return n;
    }
    const c = deps.contacts.get(jid);
    if (c?.displayName) return c.displayName;
    return String(jid).replace(/@.+$/, "") || jid;
  };

  const onReq = (ev) => {
    try {
      const groupJid = String(ev?.id || "").trim();
      if (!groupJid.endsWith("@g.us")) return;
      const participant = String(
        ev?.participant || ev?.participantPn || ""
      ).trim();
      const author = String(ev?.author || ev?.authorPn || "").trim();
      const action = String(ev?.action || "created");
      const method = String(ev?.method || "");
      const groupName =
        deps.contacts.get(groupJid)?.displayName ||
        nameOf(groupJid) ||
        "群组";
      const who = nameOf(participant) || participant || "有人";
      const title = `${groupName} · 入群申请`;
      const body =
        action === "created"
          ? `${who} 申请加入群组${method ? `（${method}）` : ""}`
          : `${who} ${labelAction(action)}`;

      deps.push("group.join_request", {
        groupJid,
        groupName,
        participant,
        participantPn: ev?.participantPn || "",
        author,
        action,
        method,
        title,
        body,
        at: Date.now(),
      });

      // 仅新申请写入时间线系统消息
      if (action === "created") {
        const ts = Date.now();
        const msgId = `sys-gjoin-${groupJid}-${participant}-${ts}`;
        const sysMsg = {
          id: msgId,
          jid: groupJid,
          channelAddress: groupJid,
          body: `📩 ${body}`,
          direction: "in",
          sentAt: ts,
          displayName: groupName,
          isGroup: true,
          groupJid,
          mediaType: "system",
          systemKind: "group_join_request",
          systemAction: action,
          systemParticipants: participant ? [participant] : [],
          systemAuthor: author,
        };
        deps.messages.set(msgId, sysMsg);
        deps.push("messages.sync", {
          items: [sysMsg],
          live: true,
          source: "group-join-request",
        });
        const c0 =
          deps.contacts.get(groupJid) || deps.upsertContact(groupJid, groupName);
        if (c0) {
          c0.isGroup = true;
          c0.lastMessage = sysMsg.body;
          c0.updatedAt = ts;
          deps.contacts.set(groupJid, c0);
          if (typeof deps.scheduleContactsPush === "function") {
            deps.scheduleContactsPush();
          }
        }
      }

      // 轻量刷新群摘要（人数等）
      void sock
        .groupMetadata?.(groupJid)
        ?.then?.((meta) => {
          const norm = normalizeGroupMetadata(meta);
          if (!norm) return;
          if (typeof deps.applyGroupSummary === "function") {
            deps.applyGroupSummary(norm);
          }
          if (typeof deps.scheduleContactsPush === "function") {
            deps.scheduleContactsPush();
          }
        })
        ?.catch?.(() => undefined);
    } catch {
      /* ignore */
    }
  };

  sock.ev.on("group.join-request", onReq);
  return () => {
    try {
      sock.ev.off("group.join-request", onReq);
    } catch {
      /* ignore */
    }
  };
}
