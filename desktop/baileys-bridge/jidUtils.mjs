/** 从任意 jid / 文本里抽出可展示的 E.164 */
export function phoneFromJid(jid) {
  if (!jid || typeof jid !== "string") return "";
  const s = jid.trim();
  if (!s || s.includes("@lid") || s.includes("@g.us") || s === "status@broadcast")
    return "";
  if (s.endsWith("@s.whatsapp.net") || s.endsWith("@c.us")) {
    const d = s.split("@")[0].split(":")[0];
    return d && /^\d{7,15}$/.test(d) ? `+${d}` : "";
  }
  if (s.startsWith("+") && /^\+\d{7,15}$/.test(s)) return s;
  if (/^\d{7,15}$/.test(s)) return `+${s}`;
  return "";
}

export function isLidJid(jid) {
  return typeof jid === "string" && jid.includes("@lid");
}

export function looksLikeInternalId(name) {
  if (!name) return true;
  const s = String(name).trim();
  if (!s) return true;
  if (s.includes("@lid") || s.includes("@s.whatsapp.net") || s.includes("@g.us")) return true;
  // 纯长数字 = LID 用户段
  if (/^\d{10,}$/.test(s)) return true;
  return false;
}

export function isHumanName(name) {
  if (!name || typeof name !== "string") return false;
  const s = name.trim();
  if (!s) return false;
  if (looksLikeInternalId(s)) return false;
  if (
    s === "未知联系人" ||
    s === "未知" ||
    s === "群成员" ||
    s === "号码解析中…" ||
    s === "未备注联系人"
  )
    return false;
  // 纯手机号不当「名字」
  const compact = s.replace(/[\s().-]/g, "");
  if (phoneFromJid(s) || /^\+?\d{7,15}$/.test(compact)) return false;
  return true;
}

/**
 * 展示名优先级（没号也能看）：
 * 1) WhatsApp 通讯录名 / 推送名 pushName / notify
 * 2) 手机号（有映射才有）
 * 3) 空（交给前端显示「未备注」）
 */
export function prettyName(name, phone, jid) {
  if (isHumanName(name)) return name.trim();
  if (phone) return phone;
  if (jid && !isLidJid(jid)) {
    const p = phoneFromJid(jid);
    if (p) return p;
  }
  return phone || "";
}

/**
 * 是否本人 jid。getSelfCandidates: () => string[]
 */
export function createSelfJidChecker(getSelfCandidates) {
  return function isSelfJid(jid) {
    if (!jid || typeof jid !== "string") return false;
    if (jid === "status@broadcast") return true;
    const cand = getSelfCandidates() || [];
    if (!cand.length) return false;
    const bare = jid.replace(/:\d+@/, "@");
    for (const c of cand) {
      if (!c) continue;
      if (c === jid || c === bare) return true;
      const cb = c.replace(/:\d+@/, "@");
      if (cb === bare || cb === jid) return true;
      const pj = phoneFromJid(jid);
      const pc = phoneFromJid(c);
      if (pj && pc && pj === pc) return true;
    }
    return false;
  };
}
