/**
 * 黑名单只读/写：fetchBlocklist + updateBlockStatus。
 */

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * @param {{
 *   getSocket: () => any,
 *   getConnection: () => string,
 *   push?: (type: string, payload: object) => void,
 *   syncDbg?: Function,
 * }} deps
 */
export function createBlocklistService(deps) {
  const dbg = deps.syncDbg || (() => {});
  /** @type {Set<string>} */
  let cache = new Set();

  function requireSock() {
    const sock = deps.getSocket?.();
    if (!sock || deps.getConnection?.() !== "connected") {
      throw err("WhatsApp 尚未连接", "not_connected");
    }
    return sock;
  }

  function list() {
    return [...cache].sort();
  }

  function setAll(jids) {
    cache = new Set(
      (jids || []).map((j) => String(j || "").trim()).filter(Boolean)
    );
  }

  function applyUpdate(jids, type) {
    const arr = (Array.isArray(jids) ? jids : [jids])
      .map((j) => String(j || "").trim())
      .filter(Boolean);
    for (const j of arr) {
      if (type === "add") cache.add(j);
      else cache.delete(j);
    }
    return arr;
  }

  async function fetch(force = false) {
    const sock = requireSock();
    if (!force && cache.size) return list();
    if (typeof sock.fetchBlocklist !== "function") {
      throw err("当前 Baileys 不支持 fetchBlocklist", "unsupported");
    }
    const rows = await sock.fetchBlocklist();
    const jids = (Array.isArray(rows) ? rows : [])
      .map((j) => String(j || "").trim())
      .filter(Boolean);
    setAll(jids);
    dbg("blocklist.fetch", { n: jids.length });
    if (typeof deps.push === "function") {
      deps.push("blocklist.sync", { jids: list(), source: "fetch" });
    }
    return list();
  }

  async function setStatus(jidOrPhone, action) {
    const sock = requireSock();
    const act = String(action || "").toLowerCase();
    if (act !== "block" && act !== "unblock") {
      throw err("action 须为 block|unblock", "invalid_action");
    }
    let jid = String(jidOrPhone || "").trim();
    if (!jid) throw err("目标为空", "invalid_jid");
    if (!jid.includes("@")) {
      const d = jid.replace(/\D/g, "");
      if (d.length < 8) throw err("号码无效", "invalid_jid");
      jid = `${d}@s.whatsapp.net`;
    }
    await sock.updateBlockStatus(jid, act);
    applyUpdate([jid], act === "block" ? "add" : "remove");
    dbg("blocklist.setStatus", { jid, act });
    if (typeof deps.push === "function") {
      deps.push("blocklist.update", {
        jids: [jid],
        type: act === "block" ? "add" : "remove",
        source: "local",
      });
      deps.push("blocklist.sync", { jids: list(), source: "local" });
    }
    return { jid, action: act, jids: list() };
  }

  function onRemoteSet(blocklist) {
    setAll(blocklist || []);
    if (typeof deps.push === "function") {
      deps.push("blocklist.sync", { jids: list(), source: "blocklist.set" });
    }
  }

  function onRemoteUpdate(update) {
    const type = update?.type === "add" ? "add" : "remove";
    const changed = applyUpdate(update?.blocklist || update?.jids || [], type);
    if (typeof deps.push === "function") {
      deps.push("blocklist.update", {
        jids: changed,
        type,
        source: "blocklist.update",
      });
      deps.push("blocklist.sync", { jids: list(), source: "blocklist.update" });
    }
  }

  return {
    list,
    fetch,
    setStatus,
    onRemoteSet,
    onRemoteUpdate,
    getCache: () => cache,
  };
}

/**
 * @param {any} sock
 * @param {ReturnType<typeof createBlocklistService>} service
 */
export function attachBlocklistEvents(sock, service) {
  if (!sock?.ev?.on || !service) return () => {};
  const onSet = (ev) => {
    try {
      service.onRemoteSet(ev?.blocklist || ev);
    } catch {
      /* ignore */
    }
  };
  const onUpdate = (ev) => {
    try {
      service.onRemoteUpdate(ev);
    } catch {
      /* ignore */
    }
  };
  sock.ev.on("blocklist.set", onSet);
  sock.ev.on("blocklist.update", onUpdate);
  return () => {
    try {
      sock.ev.off("blocklist.set", onSet);
      sock.ev.off("blocklist.update", onUpdate);
    } catch {
      /* ignore */
    }
  };
}
