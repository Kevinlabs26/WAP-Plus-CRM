import {
  isHumanName,
  isLidJid,
  looksLikeInternalId,
  phoneFromJid,
  prettyName,
} from "./jidUtils.mjs";

/**
 * 联系人 upsert / LID 映射 / 号码补全。
 * deps: { contacts: Map, getSocket: () => sock|null, isSelfJid }
 */
export function createContactStore(deps) {
  const { contacts, getSocket, isSelfJid } = deps;

  /** 有真人名字时写入/升级 displayName（不把已有名字覆盖成空） */
  function mergeHumanName(contact, name) {
    if (!contact || !isHumanName(name)) return contact;
    const n = name.trim();
    if (!contact.displayName || !isHumanName(contact.displayName)) {
      contact.displayName = n;
    }
    return contact;
  }

  /** 记下 LID↔PN，供后续 getPNForLID / 展示 */
  function rememberLidPn(lid, pn) {
    if (!lid || !pn) return;
    const phone = phoneFromJid(pn);
    if (isLidJid(lid)) {
      const c = upsertContact(lid, "", phone || pn);
      if (c) {
        c.pnJid = pn.endsWith("@s.whatsapp.net") ? pn : c.pnJid;
        c.lidJid = lid;
        if (phone) c.phoneE164 = phone;
        if (!c.displayName || looksLikeInternalId(c.displayName)) {
          c.displayName = prettyName(c.displayName, c.phoneE164, pn);
        }
        contacts.set(lid, c);
      }
    }
    const pnJid = pn.includes("@")
      ? pn
      : phone
        ? `${phone.replace(/\D/g, "")}@s.whatsapp.net`
        : `${String(pn).replace(/\D/g, "")}@s.whatsapp.net`;
    if (phoneFromJid(pnJid)) {
      upsertContact(pnJid, "", phone || pnJid);
    }
    try {
      getSocket()?.signalRepository?.lidMapping?.storeLIDPNMappings?.([
        { lid, pn: pnJid },
      ]);
    } catch {
      /* ignore */
    }
  }

  /**
   * 同步 upsert：phone 可后补（LID 映射异步）。
   * 用 jid 作 map key；若已有同号码的 PN 联系人则合并。
   */
  function upsertContact(jid, name = "", phoneHint = "") {
    if (!jid || jid === "status@broadcast") return null;
    if (jid.endsWith("@g.us")) {
      const existing = contacts.get(jid) || {};
      const hadPersonAliases =
        Boolean(existing.phoneE164 || existing.lidJid || existing.pnJid);
      for (const [key, value] of contacts) {
        if (key !== jid && value?.isGroup && !String(key).endsWith("@g.us")) {
          contacts.delete(key);
        }
      }
      // 群名：新 subject 优先；勿被空字符串盖成「群聊」
      const incoming = typeof name === "string" ? name.trim() : "";
      const prevName =
        typeof existing.displayName === "string"
          ? existing.displayName.trim()
          : "";
      const displayName = isHumanName(incoming)
        ? incoming
        : isHumanName(prevName)
          ? prevName
          : incoming || prevName || "群聊";
      const item = {
        ...existing,
        jid,
        isGroup: true,
        phoneE164: "",
        lidJid: "",
        pnJid: "",
        displayName,
        lastMessage: existing.lastMessage || "",
        updatedAt: Math.max(existing.updatedAt || 0, Date.now()),
        avatarUrl: hadPersonAliases ? "" : existing.avatarUrl || "",
        avatarCheckedAt: hadPersonAliases ? 0 : existing.avatarCheckedAt || 0,
      };
      contacts.set(jid, item);
      return item;
    }
    if (isSelfJid(jid) || isSelfJid(phoneHint)) return null;
    // 清掉已误存的本人记录
    if (contacts.has(jid) && isSelfJid(jid)) {
      contacts.delete(jid);
      return null;
    }
    const existing = contacts.get(jid) || {};
    let phoneE164 =
      phoneFromJid(phoneHint) ||
      phoneFromJid(jid) ||
      (existing.phoneE164 && phoneFromJid(existing.phoneE164)
        ? existing.phoneE164
        : "") ||
      "";

    // 若号码已挂在另一条记录上，合并到那条（避免 LID / PN 双份）
    if (phoneE164) {
      for (const [k, c] of contacts) {
        if (k === jid) continue;
        if (c.phoneE164 === phoneE164) {
          const merged = {
            ...c,
            jid: c.jid?.endsWith("@s.whatsapp.net") ? c.jid : jid,
            lidJid: isLidJid(jid) ? jid : c.lidJid || existing.lidJid || "",
            pnJid:
              c.pnJid ||
              (jid.endsWith("@s.whatsapp.net") ? jid : existing.pnJid || ""),
            displayName: prettyName(
              // 新名字优先（pushName），否则保留旧的好名字
              isHumanName(name)
                ? name
                : c.displayName || existing.displayName || name,
              phoneE164,
              jid
            ),
            lastMessage: existing.lastMessage || c.lastMessage || "",
            updatedAt: Math.max(existing.updatedAt || 0, c.updatedAt || 0),
            avatarUrl: c.avatarUrl || existing.avatarUrl || "",
            avatarCheckedAt: Math.max(
              c.avatarCheckedAt || 0,
              existing.avatarCheckedAt || 0
            ),
            phoneE164,
          };
          mergeHumanName(merged, name);
          contacts.set(k, merged);
          // 让 LID key 也指向同一对象视图
          contacts.set(jid, { ...merged, jid });
          return merged;
        }
      }
    }

    const item = {
      jid,
      lidJid: isLidJid(jid) ? jid : existing.lidJid || "",
      pnJid: jid.endsWith("@s.whatsapp.net")
        ? jid
        : existing.pnJid || "",
      phoneE164,
      displayName: prettyName(
        isHumanName(name) ? name : existing.displayName || name,
        phoneE164,
        jid
      ),
      lastMessage: existing.lastMessage || "",
      updatedAt: existing.updatedAt || Date.now(),
      avatarUrl: existing.avatarUrl || "",
      avatarCheckedAt: existing.avatarCheckedAt || 0,
    };
    mergeHumanName(item, name);
    // 保留历史上的好名字
    if (!isHumanName(item.displayName) && isHumanName(existing.displayName)) {
      item.displayName = existing.displayName.trim();
    }
    contacts.set(jid, item);
    // 联系人 Map 软顶：优先丢掉最久未更新的非群条目
    if (contacts.size > 8000) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [k, c] of contacts) {
        if (c?.isGroup) continue;
        const t = Number(c?.updatedAt) || 0;
        if (t < oldestAt) {
          oldestAt = t;
          oldestKey = k;
        }
      }
      if (oldestKey != null) contacts.delete(oldestKey);
      else {
        const first = contacts.keys().next().value;
        if (first != null) contacts.delete(first);
      }
    }
    return item;
  }

  async function resolvePnJid(jid) {
    if (!jid) return "";
    if (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us")) return jid;
    if (!isLidJid(jid) || !getSocket()) return "";
    try {
      const store = getSocket().signalRepository?.lidMapping;
      if (store?.getPNForLID) {
        const pn = await store.getPNForLID(jid);
        if (pn && typeof pn === "string") return pn;
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  /** 尽量补全号码 + 规范化展示名，并推送一次 contacts.sync */
  async function enrichContact(jid, name = "", altJid = "") {
    if (jid?.endsWith("@g.us")) return upsertContact(jid, name);
    let contact = upsertContact(
      jid,
      name,
      phoneFromJid(altJid) || altJid
    );
    if (!contact) return null;
    // 名字能读到就保留（enrich 主要补号，不抹掉 pushName）
    mergeHumanName(contact, name);

    if (!contact.phoneE164) {
      // 1) 消息自带 remoteJidAlt
      if (altJid) {
        const p = phoneFromJid(altJid);
        if (p) {
          contact = upsertContact(jid, name, p) || contact;
          if (altJid.endsWith("@s.whatsapp.net")) {
            contact.pnJid = altJid;
            contacts.set(jid, contact);
            upsertContact(altJid, contact.displayName, p);
          }
        }
      }
    }

    if (!contact.phoneE164 || isLidJid(jid)) {
      const pn = await resolvePnJid(jid);
      if (pn) {
        const p = phoneFromJid(pn);
        contact = upsertContact(jid, name || contact.displayName, p) || contact;
        contact.pnJid = pn;
        contacts.set(jid, contact);
        upsertContact(pn, contact.displayName, p);
      }
    }

    // 展示名仍是内部 id 时换成号码
    if (looksLikeInternalId(contact.displayName) && contact.phoneE164) {
      contact.displayName = contact.phoneE164;
      contacts.set(jid, contact);
    }

    return contact;
  }


  return {
    mergeHumanName,
    rememberLidPn,
    upsertContact,
    resolvePnJid,
    enrichContact,
  };
}
