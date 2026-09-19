import { phoneFromJid } from "./jidUtils.mjs";

/**
 * 将 Baileys presence.update 转为前端 items。
 * @returns {null | { chatJid: string, items: object[], rawKeys: string[] }}
 */
export function buildPresencePush(update, { findContactByAnyJid }) {
  const chatJid = String(update?.id || "");
  if (!chatJid || chatJid === "status@broadcast") return null;
  if (chatJid.endsWith("@g.us")) return null; // 群聊先不展示

  const presences = update?.presences || {};
  const items = [];
  const pack = (participant, presenceRaw, extra = {}) => {
    const presence = String(presenceRaw || "").trim().toLowerCase();
    if (!presence) return;
    const c =
      findContactByAnyJid(chatJid) ||
      findContactByAnyJid(participant) ||
      null;
    const phone =
      (c && c.phoneE164) ||
      phoneFromJid(chatJid) ||
      phoneFromJid(participant) ||
      "";
    const jids = [
      chatJid,
      participant,
      c?.jid,
      c?.pnJid,
      c?.lidJid,
      phone ? `${String(phone).replace(/\D/g, "")}@s.whatsapp.net` : "",
    ].filter(Boolean);
    let lastSeen = extra.lastSeen;
    if (lastSeen != null) {
      const n = Number(lastSeen);
      if (Number.isFinite(n) && n > 0) {
        lastSeen = n < 1e12 ? n * 1000 : n;
      } else {
        lastSeen = undefined;
      }
    }
    items.push({
      jid: chatJid,
      participant:
        participant && participant !== chatJid ? participant : undefined,
      presence,
      lastSeen: lastSeen || undefined,
      phoneE164: phone,
      aliases: Array.from(new Set(jids)),
      displayName: c?.displayName || "",
    });
  };

  for (const [participant, info] of Object.entries(presences)) {
    pack(participant, info && info.lastKnownPresence, {
      lastSeen: info?.lastSeen,
    });
  }
  if (!items.length && update?.lastKnownPresence) {
    pack(chatJid, update.lastKnownPresence, {
      lastSeen: update.lastSeen,
    });
  }

  return {
    chatJid,
    items,
    rawKeys: Object.keys(presences || {}),
  };
}
