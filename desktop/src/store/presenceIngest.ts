import type { ChatPreview, Contact } from "@/types/crm";

/** 与 appStore.peerPresenceByKey 条目一致 */
export type PeerPresenceEntry = {
  presence: string;
  at: number;
  jid?: string;
  lastSeen?: number;
  onlineAt?: number;
};

export type PresenceIngestContext = {
  contacts: Contact[];
  chats: ChatPreview[];
  selectedChatId: string | null;
  selectedContactId: string | null;
  /** payload.items from presence.update */
  items: unknown[];
  now?: number;
};

function asString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const normDigits = (s: string) => s.replace(/\D/g, "");
const jidUser = (s: string) => {
  const t = s.trim();
  if (!t) return "";
  // 123:device@s.whatsapp.net / user@lid
  const noDevice = t.replace(/:\d+@/, "@");
  return noDevice.includes("@") ? noDevice.split("@")[0] : noDevice;
};

/** 只加精确键，禁止短数字/模糊 includes（会串会话） */
function addExactKey(keys: Set<string>, k?: string | null) {
  if (!k) return;
  const s = String(k).trim();
  if (!s) return;
  // 过短纯数字极易碰撞，不当 presence 键
  if (/^\d{1,6}$/.test(s)) return;
  keys.add(s);
  keys.add(s.toLowerCase());
}

function collectContactKeys(
  c: Contact,
  chatIdsByContact: Map<string, string[]>
): string[] {
  const keys: string[] = [];
  const add = (k?: string | null) => {
    if (!k) return;
    keys.push(k);
    keys.push(k.toLowerCase());
  };
  add(c.id);
  add(`bridge-chat-${c.id}`);
  add(c.channelAddress);
  if (c.channelAddress?.includes("@")) {
    add(c.channelAddress.replace(/:\d+@/, "@"));
    add(jidUser(c.channelAddress));
  }
  if (c.phone) {
    add(c.phone);
    const d = normDigits(c.phone);
    if (d.length >= 7) {
      add(d);
      add(`+${d}`);
      add(`${d}@s.whatsapp.net`);
    }
  }
  for (const chatId of chatIdsByContact.get(c.id) || []) add(chatId);
  return keys;
}

/**
 * 纯函数：合并 presence.update 事件到 peerPresenceByKey。
 * 键匹配必须精确，避免 A 的状态写到 B。
 */
export function applyPresenceUpdate(
  prevMap: Record<string, PeerPresenceEntry>,
  ctx: PresenceIngestContext
): Record<string, PeerPresenceEntry> {
  const now = ctx.now ?? Date.now();
  let peerPresenceByKey: Record<string, PeerPresenceEntry> = { ...prevMap };
  const { contacts, chats } = ctx;

  // —— 批次级索引：避免每条 item 对全量 contacts × chats 三重扫描 ——
  // contactId → chatIds
  const chatIdsByContact = new Map<string, string[]>();
  for (const ch of chats) {
    if (!ch.contactId) continue;
    const list = chatIdsByContact.get(ch.contactId);
    if (list) list.push(ch.id);
    else chatIdsByContact.set(ch.contactId, [ch.id]);
  }
  // 归一化键 → 联系人（每联系人只算一次 keys）
  const keyToContacts = new Map<string, Contact[]>();
  const addIndex = (k: string, c: Contact) => {
    const norm = k.toLowerCase();
    const list = keyToContacts.get(norm);
    if (list) list.push(c);
    else keyToContacts.set(norm, [c]);
  };
  for (const c of contacts) {
    for (const k of collectContactKeys(c, chatIdsByContact)) addIndex(k, c);
  }

  // 过期：输入 15s；在线无刷新 90s（缩短假在线）；离线 lastSeen 保留 48h
  for (const [k, v] of Object.entries(peerPresenceByKey)) {
    if (!v?.at) {
      delete peerPresenceByKey[k];
      continue;
    }
    const age = now - v.at;
    if (
      (v.presence === "composing" || v.presence === "recording") &&
      age > 15_000
    ) {
      if (v.onlineAt && now - v.onlineAt < 90_000) {
        peerPresenceByKey[k] = {
          ...v,
          presence: "available",
          at: v.onlineAt,
        };
      } else {
        delete peerPresenceByKey[k];
      }
    } else if (v.presence === "available" && age > 90_000) {
      // 在线过期：保留 lastSeen 痕迹为 unavailable，避免 residual 绿点
      peerPresenceByKey[k] = {
        ...v,
        presence: "unavailable",
        at: now,
        lastSeen: v.lastSeen || v.onlineAt || v.at,
        onlineAt: undefined,
      };
    } else if (v.presence === "unavailable" && age > 48 * 3600_000) {
      delete peerPresenceByKey[k];
    }
  }

  for (const raw of ctx.items) {
    const item = asObject(raw);
    if (!item) continue;
    let presence = asString(item.presence, 40).toLowerCase();
    if (!presence) continue;
    if (presence === "paused") presence = "paused";

    const jid = asString(item.jid ?? item.remoteJid, 200);
    const phone = asString(item.phoneE164 ?? item.phone, 40);
    const participant = asString(item.participant, 200);
    let lastSeen: number | undefined;
    const lsRaw = item.lastSeen;
    if (typeof lsRaw === "number" && lsRaw > 0) {
      lastSeen = lsRaw < 1e12 ? lsRaw * 1000 : lsRaw;
    } else if (typeof lsRaw === "string" && /^\d+$/.test(lsRaw)) {
      const n = Number(lsRaw);
      lastSeen = n < 1e12 ? n * 1000 : n;
    }
    const aliasList = Array.isArray(item.aliases)
      ? item.aliases.map((a) => asString(a, 200)).filter(Boolean)
      : [];

    const seedKeys = new Set<string>();
    for (const a of [jid, participant, phone, ...aliasList]) {
      addExactKey(seedKeys, a);
      if (a.includes("@")) {
        addExactKey(seedKeys, a.replace(/@c\.us$/, "@s.whatsapp.net"));
        addExactKey(seedKeys, a.replace(/:\d+@/, "@"));
        addExactKey(seedKeys, jidUser(a));
      }
    }
    if (phone) {
      const digits = normDigits(phone);
      if (digits.length >= 7) {
        addExactKey(seedKeys, digits);
        addExactKey(seedKeys, `+${digits}`);
        addExactKey(seedKeys, `${digits}@s.whatsapp.net`);
      }
    }

    // 精确命中联系人（禁止 includes 模糊）：从预建索引查，O(seedKeys)
    const hitContacts: Contact[] = [];
    const seenContacts = new Set<string>();
    for (const k of seedKeys) {
      const norm = k.toLowerCase();
      const list = keyToContacts.get(norm);
      if (!list) continue;
      for (const hit of list) {
        if (seenContacts.has(hit.id)) continue;
        seenContacts.add(hit.id);
        hitContacts.push(hit);
      }
    }

    const keys = new Set<string>(seedKeys);
    for (const hit of hitContacts) {
      for (const k of collectContactKeys(hit, chatIdsByContact))
        addExactKey(keys, k);
    }

    // 不再把「当前选中会话」无条件写入 keys，避免 A 的状态落到 B 的 chatId

    const write = (entry: PeerPresenceEntry) => {
      for (const k of keys) {
        if (!k) continue;
        const prev = peerPresenceByKey[k];
        if (entry.presence === "paused") {
          if (
            prev &&
            (prev.presence === "composing" || prev.presence === "recording")
          ) {
            peerPresenceByKey[k] = {
              ...prev,
              presence: prev.onlineAt ? "available" : "unavailable",
              at: now,
            };
          }
          continue;
        }
        peerPresenceByKey[k] = {
          ...entry,
          lastSeen: entry.lastSeen ?? prev?.lastSeen,
          jid: entry.jid || prev?.jid,
        };
      }
    };

    if (presence === "paused") {
      write({ presence: "paused", at: now, jid: jid || undefined });
      continue;
    }
    if (presence === "composing" || presence === "recording") {
      write({
        presence,
        at: now,
        jid: jid || undefined,
        onlineAt: now,
      });
      continue;
    }
    if (presence === "available") {
      write({
        presence: "available",
        at: now,
        jid: jid || undefined,
        onlineAt: now,
      });
      continue;
    }
    if (presence === "unavailable") {
      write({
        presence: "unavailable",
        at: now,
        jid: jid || undefined,
        lastSeen: lastSeen ?? now,
        onlineAt: undefined,
      });
    }
  }

  const entries = Object.entries(peerPresenceByKey);
  if (entries.length > 300) {
    entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    peerPresenceByKey = Object.fromEntries(entries.slice(0, 300));
  }
  // 无实质变化时返回原引用，避免 Zustand 无意义通知
  const prevKeys = Object.keys(prevMap);
  const nextKeys = Object.keys(peerPresenceByKey);
  if (prevKeys.length === nextKeys.length) {
    let same = true;
    for (const k of nextKeys) {
      const a = prevMap[k];
      const b = peerPresenceByKey[k];
      if (
        !a ||
        !b ||
        a.presence !== b.presence ||
        a.at !== b.at ||
        a.lastSeen !== b.lastSeen ||
        a.onlineAt !== b.onlineAt ||
        a.jid !== b.jid
      ) {
        same = false;
        break;
      }
    }
    if (same) return prevMap;
  }
  return peerPresenceByKey;
}
