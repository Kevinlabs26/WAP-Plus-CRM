/**
 * 消息生命周期事件：删除、独立 reaction 流。
 * 与 messageIngest（upsert 正文）分离。
 */

/**
 * @param {any} sock
 * @param {{
 *   push: (type: string, payload: object) => void,
 *   messages?: Map<string, any>,
 * }} deps
 */
export function attachMessageLifecycleEvents(sock, deps) {
  if (!sock?.ev?.on) return () => {};

  const onDelete = (payload) => {
    try {
      if (!payload) return;
      if (payload.all && payload.jid) {
        deps.push("messages.delete", {
          all: true,
          jid: String(payload.jid),
          source: "messages.delete",
        });
        // 可选：清 bridge 内存里该 jid 消息
        if (deps.messages) {
          for (const [id, m] of [...deps.messages.entries()]) {
            if (m?.jid === payload.jid || m?.groupJid === payload.jid) {
              deps.messages.delete(id);
            }
          }
        }
        return;
      }
      const keys = Array.isArray(payload.keys) ? payload.keys : [];
      if (!keys.length) return;
      const items = keys
        .filter((k) => k?.id)
        .map((k) => ({
          id: String(k.id),
          remoteJid: k.remoteJid ? String(k.remoteJid) : undefined,
          fromMe: Boolean(k.fromMe),
          participant: k.participant ? String(k.participant) : undefined,
        }));
      if (!items.length) return;
      deps.push("messages.delete", {
        items,
        source: "messages.delete",
      });
      if (deps.messages) {
        const idSet = new Set(items.map((i) => i.id));
        for (const [id, m] of [...deps.messages.entries()]) {
          if (
            idSet.has(id) ||
            idSet.has(m?.id) ||
            (m?.waKey?.id && idSet.has(m.waKey.id))
          ) {
            deps.messages.delete(id);
          }
        }
      }
    } catch {
      /* ignore */
    }
  };

  /** Baileys 独立 reaction 事件（部分路径不走 messages.upsert） */
  const onReaction = (updates) => {
    try {
      const list = Array.isArray(updates) ? updates : [];
      const items = [];
      for (const u of list) {
        const key = u?.key;
        const reaction = u?.reaction;
        if (!key?.id) continue;
        const emoji = reaction?.text ? String(reaction.text) : "";
        // text 空 = 取消
        // key = 被反应的消息；reaction.key = 反应事件本身的消息 key。
        // 反应事件本身的 fromMe 应优先从 reaction.key 读取，不能用被回应消息的 key。
        const reactorFromMe =
          typeof reaction?.fromMe === "boolean"
            ? reaction.fromMe
            : typeof reaction?.key?.fromMe === "boolean"
              ? reaction.key.fromMe
              : Boolean(key.fromMe);
        // 群反应者：reaction.participant / reaction.key.participant / key.participant
        const reactorParticipant =
          reaction?.participant ||
          reaction?.key?.participant ||
          (!reactorFromMe ? key.participant : undefined) ||
          "";
        items.push({
          kind: "reaction",
          id: `react-ev:${key.id}:${Date.now()}`,
          jid: key.remoteJid || "",
          channelAddress: key.remoteJid || "",
          direction: reactorFromMe ? "out" : "in",
          fromMe: reactorFromMe,
          sentAt: Date.now(),
          emoji,
          targetMessageId: key.id,
          targetRemoteJid: key.remoteJid || "",
          targetFromMe: Boolean(key.fromMe),
          // 前端用 participant 区分群内多人反应
          participant: reactorParticipant || undefined,
          senderJid: reactorParticipant || undefined,
          waKey: {
            remoteJid: key.remoteJid,
            fromMe: Boolean(key.fromMe),
            id: key.id,
            participant: key.participant,
          },
        });
      }
      if (items.length) {
        deps.push("messages.sync", {
          items,
          live: true,
          source: "messages.reaction",
        });
      }
    } catch {
      /* ignore */
    }
  };

  sock.ev.on("messages.delete", onDelete);
  sock.ev.on("messages.reaction", onReaction);
  return () => {
    try {
      sock.ev.off("messages.delete", onDelete);
      sock.ev.off("messages.reaction", onReaction);
    } catch {
      /* ignore */
    }
  };
}
