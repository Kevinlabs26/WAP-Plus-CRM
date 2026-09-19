/**
 * 会话删除等 chats.* 事件。
 */

/**
 * @param {any} sock
 * @param {{
 *   push: (type: string, payload: object) => void,
 *   contacts?: Map<string, any>,
 * }} deps
 */
export function attachChatLifecycleEvents(sock, deps) {
  if (!sock?.ev?.on) return () => {};

  const onDelete = (ids) => {
    try {
      const list = (Array.isArray(ids) ? ids : [])
        .map((j) => String(j || "").trim())
        .filter(Boolean);
      if (!list.length) return;
      deps.push("chats.delete", {
        jids: list,
        source: "chats.delete",
      });
      // 标记 contacts 已无会话预览（不硬删联系人 CRM 档案）
      if (deps.contacts) {
        for (const jid of list) {
          const c = deps.contacts.get(jid);
          if (c) {
            c.lastMessage = "";
            c.chatDeleted = true;
            c.updatedAt = Date.now();
            deps.contacts.set(jid, c);
          }
        }
      }
    } catch {
      /* ignore */
    }
  };

  sock.ev.on("chats.delete", onDelete);
  return () => {
    try {
      sock.ev.off("chats.delete", onDelete);
    } catch {
      /* ignore */
    }
  };
}
