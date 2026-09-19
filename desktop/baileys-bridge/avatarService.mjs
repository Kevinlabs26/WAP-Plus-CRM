import {
  isHumanName,
  isLidJid,
  phoneFromJid,
} from "./jidUtils.mjs";

/**
 * 头像队列 + 联系人 key 查找。
 * deps: { contacts: Map, socket, logger, push, contactPayload? optional not needed }
 */
export function createAvatarService(deps) {
  const {
    contacts,
    getConnection,
    getSocket,
    logger,
    push,
    enrichContact,
    contactPayload,
  } = deps;

  let avatarPumpRunning = false;
  const avatarQueue = [];
  const avatarQueued = new Set();
  const AVATAR_TTL_MS = 12 * 60 * 60 * 1000;
  const AVATAR_FAIL_BACKOFF_MS = 10 * 60_000;
  const AVATAR_GAP_MS = 500;
  const AVATAR_BATCH_PUSH = 16;


  function contactKeys(c) {
    const keys = [];
    if (!c) return keys;
    if (c.isGroup) return c.jid ? [c.jid] : keys;
    for (const k of [c.jid, c.lidJid, c.pnJid]) {
      if (k && !keys.includes(k)) keys.push(k);
    }
    if (c.phoneE164) {
      const d = c.phoneE164.replace(/\D/g, "");
      if (d) {
        const pn = `${d}@s.whatsapp.net`;
        if (!keys.includes(pn)) keys.push(pn);
      }
    }
    return keys;
  }

  function normalizeAvatarJid(j) {
    if (!j || typeof j !== "string") return "";
    let s = j.trim();
    if (!s) return "";
    // 123:xx@s.whatsapp.net → 123@s.whatsapp.net（本人 jid 常带设备后缀）
    if (s.includes(":")) s = s.replace(/:\d+@/, "@");
    if (!s.includes("@") && /^\d{7,15}$/.test(s.replace(/\D/g, ""))) {
      s = `${s.replace(/\D/g, "")}@s.whatsapp.net`;
    }
    return s;
  }

  function avatarLookupJids(c) {
    if (c?.isGroup) {
      const groupJid = normalizeAvatarJid(c.jid);
      return groupJid ? [groupJid] : [];
    }
    // profilePictureUrl：LID 与 PN 都可能成功；自己的号最稳
    const list = [];
    const add = (j) => {
      const n = normalizeAvatarJid(j);
      if (n && !list.includes(n)) list.push(n);
      // 同时保留原始 jid（少数路径需要 device 后缀）
      if (j && typeof j === "string") {
        const raw = j.trim();
        if (raw && raw !== n && !list.includes(raw)) list.push(raw);
      }
    };
    add(c.lidJid);
    add(c.pnJid);
    if (c.phoneE164) {
      const d = c.phoneE164.replace(/\D/g, "");
      if (d) add(`${d}@s.whatsapp.net`);
    }
    add(c.jid);
    return list;
  }

  /**
   * 不依赖 contacts Map：直接对 jid 列表拉头像（本人头像常用，self 可能被 isSelfJid 挡出通讯录）
   */
  async function fetchAvatarForJids(jids, { full = false } = {}) {
    if (!getSocket() || getConnection() !== "connected") {
      return { ok: false, avatarUrl: "", avatarFullUrl: "" };
    }
    const tried = [];
    const add = (j) => {
      const n = normalizeAvatarJid(j);
      if (n && !tried.includes(n)) tried.push(n);
      if (j && typeof j === "string") {
        const raw = j.trim();
        if (raw && !tried.includes(raw)) tried.push(raw);
      }
    };
    for (const j of jids || []) add(j);
    if (!tried.length) return { ok: false, avatarUrl: "", avatarFullUrl: "" };

    let remote = "";
    const kind = full ? "image" : "preview";
    const fallback = full ? "preview" : "image";
    for (const tryJid of tried) {
      try {
        remote =
          (await getSocket().profilePictureUrl(tryJid, kind, full ? 18_000 : 12_000)) ||
          "";
        if (remote) break;
      } catch {
        /* next */
      }
    }
    if (!remote) {
      for (const tryJid of tried) {
        try {
          remote =
            (await getSocket().profilePictureUrl(
              tryJid,
              fallback,
              full ? 12_000 : 15_000
            )) || "";
          if (remote) break;
        } catch {
          /* next */
        }
      }
    }
    const dataUrl = remote ? await fetchAvatarDataUrl(remote) : "";
    if (!dataUrl) return { ok: false, avatarUrl: "", avatarFullUrl: "" };
    // 尽量写回通讯录缓存（若有）
    const c = findContactByAnyJid(tried[0]) || null;
    if (c) {
      writeAvatarToContact(c, dataUrl, { full });
      if (full && !c.avatarUrl) writeAvatarToContact(c, dataUrl, { full: false });
    }
    return {
      ok: true,
      avatarUrl: dataUrl,
      avatarFullUrl: full ? dataUrl : "",
    };
  }

  function findContactByAnyJid(jid) {
    if (!jid) return null;
    if (contacts.has(jid)) return contacts.get(jid);
    if (String(jid).endsWith("@g.us")) return null;
    const wantedDigits = String(jid).replace(/\D/g, "");
    for (const c of contacts.values()) {
      if (c.jid === jid || c.lidJid === jid || c.pnJid === jid) return c;
      if (c.phoneE164) {
        const d = c.phoneE164.replace(/\D/g, "");
        if (d && wantedDigits === d) return c;
      }
    }
    return null;
  }

  function writeAvatarToContact(c, dataUrl, opts = {}) {
    if (!c) return;
    const full = Boolean(opts.full);
    if (dataUrl) {
      if (full) {
        c.avatarFullUrl = dataUrl;
        if (!c.avatarUrl) c.avatarUrl = dataUrl;
      } else {
        c.avatarUrl = dataUrl;
      }
    }
    c.avatarCheckedAt = Date.now();
    for (const k of contactKeys(c)) {
      const cur = contacts.get(k) || { ...c, jid: k };
      cur.avatarUrl = c.avatarUrl;
      cur.avatarFullUrl = c.avatarFullUrl || cur.avatarFullUrl;
      cur.avatarCheckedAt = c.avatarCheckedAt;
      cur.phoneE164 = cur.phoneE164 || c.phoneE164;
      cur.displayName = isHumanName(cur.displayName)
        ? cur.displayName
        : c.displayName || cur.displayName;
      cur.lidJid = cur.lidJid || c.lidJid;
      cur.pnJid = cur.pnJid || c.pnJid;
      cur.lastMessage = cur.lastMessage || c.lastMessage;
      cur.updatedAt = Math.max(cur.updatedAt || 0, c.updatedAt || 0);
      contacts.set(k, cur);
    }
  }

  async function fetchAvatarDataUrl(remoteUrl) {
    if (!remoteUrl) return "";
    // 已经是 data URL
    if (String(remoteUrl).startsWith("data:")) return remoteUrl;
    try {
      const res = await fetch(remoteUrl, {
        headers: {
          // WhatsApp CDN 有时校验 UA；不带 Referer 更稳
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });
      if (!res.ok) return "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 3_500_000) return "";
      const ctype = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      const mime = ctype.startsWith("image/") ? ctype : "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      return "";
    }
  }

  function enqueueAvatar(jid) {
    if (!jid) return;
    const c = findContactByAnyJid(jid);
    if (!c) return;
    const qKey = c.lidJid || c.phoneE164 || c.pnJid || c.jid;
    if (!qKey || avatarQueued.has(qKey)) return;
    const now = Date.now();
    if (c.avatarUrl && now - (c.avatarCheckedAt || 0) < AVATAR_TTL_MS) return;
    // 失败退避：有图长 TTL；无图短退避，允许同步后重试
    if (!c.avatarUrl && c.avatarCheckedAt && now - c.avatarCheckedAt < AVATAR_FAIL_BACKOFF_MS)
      return;
    avatarQueued.add(qKey);
    avatarQueue.push(qKey);
    void pumpAvatars();
  }

  async function pumpAvatars() {
    if (avatarPumpRunning) return;
    avatarPumpRunning = true;
    const pendingPush = [];
    try {
      while (
        avatarQueue.length &&
        getSocket() &&
        getConnection() === "connected"
      ) {
        const qKey = avatarQueue.shift();
        avatarQueued.delete(qKey);
        let c = findContactByAnyJid(qKey);
        if (!c) continue;

        // 拉头像前尽量补 PN（部分环境 PN 更稳）
        if (!c.phoneE164 || isLidJid(c.jid)) {
          c =
            (await enrichContact(
              c.lidJid || c.jid,
              c.displayName,
              c.pnJid || c.phoneE164 || ""
            )) || c;
        }

        let remotePreview = "";
        for (const tryJid of avatarLookupJids(c)) {
          if (!remotePreview) {
            try {
              remotePreview =
                (await getSocket().profilePictureUrl(tryJid, "preview", 12_000)) || "";
            } catch { /* next */ }
          }
          if (remotePreview) break;
        }
        let got = false;
        if (remotePreview) {
          const prevUrl = await fetchAvatarDataUrl(remotePreview);
          if (prevUrl) { writeAvatarToContact(c, prevUrl, { full: false }); got = true; }
        }
        if (!got) {
          c.avatarCheckedAt = Date.now();
          writeAvatarToContact(c, c.avatarUrl || "");
        }

        const payload = contactPayload(findContactByAnyJid(qKey) || c);
        if (payload) pendingPush.push(payload);

        if (pendingPush.length >= AVATAR_BATCH_PUSH) {
          push("contacts.sync", {
            items: pendingPush.splice(0, pendingPush.length),
            source: "avatar",
          });
        }
        await new Promise((r) => setTimeout(r, AVATAR_GAP_MS));
      }
      if (pendingPush.length) {
        push("contacts.sync", { items: pendingPush, source: "avatar" });
      }
    } finally {
      avatarPumpRunning = false;
      if (avatarQueue.length && getConnection() === "connected") {
        void pumpAvatars();
      }
    }
  }

  function scheduleAvatarsForActive(limit = 24) {
    const seen = new Set();
    const list = [...contacts.values()]
      .filter((c) => c.lastMessage || c.updatedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const c of list) {
      const key = c.lidJid || c.phoneE164 || c.pnJid || c.jid;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // 强制可重试：清掉过期 fail 标记以外，无图的重新入队
      if (!c.avatarUrl) c.avatarCheckedAt = 0;
      enqueueAvatar(key);
      if (seen.size >= limit) break;
    }
  }



  async function fetchAvatarHd(jid, { force = false } = {}) {
    if (!jid || !getSocket() || getConnection() !== "connected") {
      return { ok: false, avatarUrl: "", avatarFullUrl: "" };
    }
    let c = findContactByAnyJid(jid) || null;
    if (!force && c?.avatarFullUrl && String(c.avatarFullUrl).startsWith("data:")) {
      return { ok: true, avatarUrl: c.avatarUrl || c.avatarFullUrl, avatarFullUrl: c.avatarFullUrl };
    }
    if (c) c.avatarCheckedAt = 0;
    if (!c) {
      c = { jid, displayName: "", phoneE164: "", updatedAt: Date.now() };
      contacts.set(jid, c);
    }
    let remoteFull = "";
    for (const tryJid of avatarLookupJids(c)) {
      try {
        remoteFull = (await getSocket().profilePictureUrl(tryJid, "image", 18_000)) || "";
        if (remoteFull) break;
      } catch { /* next */ }
    }
    if (!remoteFull) {
      for (const tryJid of avatarLookupJids(c)) {
        try {
          remoteFull = (await getSocket().profilePictureUrl(tryJid, "preview", 12_000)) || "";
          if (remoteFull) break;
        } catch { /* next */ }
      }
    }
    const dataUrl = remoteFull ? await fetchAvatarDataUrl(remoteFull) : "";
    if (dataUrl) {
      writeAvatarToContact(c, dataUrl, { full: true });
      if (!c.avatarUrl) writeAvatarToContact(c, dataUrl, { full: false });
      const payload = contactPayload(findContactByAnyJid(jid) || c);
      if (payload) push("contacts.sync", { items: [payload], source: "avatar-hd" });
    }
    const out = findContactByAnyJid(jid) || c;
    return {
      ok: Boolean(out?.avatarFullUrl || out?.avatarUrl),
      avatarUrl: out?.avatarUrl || "",
      avatarFullUrl: out?.avatarFullUrl || out?.avatarUrl || "",
    };
  }

  return {
    contactKeys,
    avatarLookupJids,
    normalizeAvatarJid,
    findContactByAnyJid,
    writeAvatarToContact,
    fetchAvatarDataUrl,
    fetchAvatarForJids,
    fetchAvatarHd,
    enqueueAvatar,
    pumpAvatars,
    scheduleAvatarsForActive,
  };
}
