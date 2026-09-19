import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhone(e164: string): string {
  return e164.startsWith("+") ? e164 : `+${e164}`;
}

/**
 * 从正文里切出可点击片段：
 * - http(s):// / www.
 * - E.164 国际号 +数字（7–15 位），链到 tel: 与 wa.me（展示仍为原号码）
 */
const CLICKABLE_IN_TEXT_RE =
  /((?:https?:\/\/|www\.)[^\s<>"'`）\]}>，。；！？]+|(?<![\w.])\+\d{7,15}(?![\d]))/gi;

export type TextPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string; kind?: "url" | "phone" };

function trimTrailingPunct(raw: string): { core: string; trail: string } {
  let core = raw;
  let trail = "";
  while (/[.,;:!?，。；！？、)»」』】]$/.test(core) && core.length > 1) {
    trail = core.slice(-1) + trail;
    core = core.slice(0, -1);
  }
  return { core, trail };
}

export function splitTextWithLinks(text: string): TextPart[] {
  if (!text) return [];
  const parts: TextPart[] = [];
  const re = new RegExp(
    CLICKABLE_IN_TEXT_RE.source,
    CLICKABLE_IN_TEXT_RE.flags
  );
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ type: "text", value: text.slice(last, m.index) });
    }
    const matched = m[1] || "";
    const { core, trail } = trimTrailingPunct(matched);

    // 国际手机号：+12025550123 → tel:+12025550123（系统拨号/复制）；title 可另开 WA
    if (/^\+\d{7,15}$/.test(core)) {
      parts.push({
        type: "link",
        value: core,
        href: `tel:${core}`,
        kind: "phone",
      });
      if (trail) parts.push({ type: "text", value: trail });
    } else {
      const href = /^www\./i.test(core) ? `https://${core}` : core;
      if (/^https?:\/\//i.test(href)) {
        parts.push({ type: "link", value: core, href, kind: "url" });
        if (trail) parts.push({ type: "text", value: trail });
      } else {
        parts.push({ type: "text", value: matched });
      }
    }
    last = m.index + matched.length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }
  return parts.length ? parts : [{ type: "text", value: text }];
}

export type WhatsAppTextPart =
  | { type: "text"; value: string }
  | { type: "bold" | "italic" | "strike"; value: string };

/** 解析 WhatsApp 正文中的常用格式标记，未闭合的标记保持原样。 */
export function splitWhatsAppFormatting(text: string): WhatsAppTextPart[] {
  if (!text) return [];
  const parts: WhatsAppTextPart[] = [];
  const re = /(\*[^*\n]+?\*|(?<!\w)_[^_\n]+?_(?!\w)|~[^~\n]+?~)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: text.slice(last, match.index) });
    }
    const marker = match[1][0];
    parts.push({
      type: marker === "*" ? "bold" : marker === "_" ? "italic" : "strike",
      value: match[1].slice(1, -1),
    });
    last = match.index + match[1].length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }
  return parts.length ? parts : [{ type: "text", value: text }];
}

export function stripWhatsAppFormatting(text: string): string {
  return splitWhatsAppFormatting(text)
    .map((part) => part.value)
    .join("");
}

/**
 * 从 bridge 生成的 contact/chat id 里抠回 jid / LID / 号码。
 * id 形如：bridge-contact-baileys%3A123%40lid 或 bridge-chat-bridge-contact-...
 */
export function jidFromBridgeEntityId(id?: string | null): string {
  if (!id || typeof id !== "string") return "";
  let s = id.trim();
  // 剥掉 chat 前缀，落到 contact id
  if (s.startsWith("bridge-chat-")) s = s.slice("bridge-chat-".length);
  const prefix = "bridge-contact-";
  if (!s.startsWith(prefix)) return "";
  let rest = s.slice(prefix.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    /* keep raw */
  }
  // deviceId:key 或仅 key
  const colon = rest.indexOf(":");
  const key = (colon >= 0 ? rest.slice(colon + 1) : rest).trim();
  if (!key || key.startsWith("tmp-")) return "";
  if (
    key.includes("@lid") ||
    key.includes("@s.whatsapp.net") ||
    key.includes("@c.us") ||
    key.includes("@g.us")
  )
    return key;
  if (/^\+\d{7,15}$/.test(key) || /^\d{7,15}$/.test(key)) return key;
  return "";
}

/**
 * Baileys / 通道发送目标：优先可拨打 E.164，其次 @s.whatsapp.net / @c.us jid，
 * 最后才用 @lid（依赖 bridge 侧映射）。空字符串 = 不可发。
 */
export function resolveSendTarget(input: {
  phone?: string | null;
  channelAddress?: string | null;
  jid?: string | null;
  /** 可选：contact.id / chat.id，用于 channelAddress 丢失时恢复 */
  entityId?: string | null;
}): string {
  const fromId = jidFromBridgeEntityId(input.entityId);
  const candidates = [
    input.phone,
    input.channelAddress,
    input.jid,
    fromId,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  const groupJid = candidates.find((raw) => raw.endsWith("@g.us"));
  if (groupJid) return groupJid;

  for (const raw of candidates) {
    const e164 = displayPhone(raw);
    if (e164) return e164;
  }
  for (const raw of candidates) {
    if (raw.includes("@s.whatsapp.net") || raw.includes("@c.us")) {
      const user = raw.split("@")[0]?.split(":")[0] ?? "";
      if (user && /^\d{7,15}$/.test(user)) return `+${user}`;
      if (raw.includes("@")) return raw;
    }
  }
  for (const raw of candidates) {
    // 完整 LID，或纯数字段 + 补 @lid（少见）
    if (raw.includes("@lid")) return raw;
    if (/^\d{10,}$/.test(raw) && raw.length >= 14) {
      // 超长数字更像 LID 用户段
      return `${raw}@lid`;
    }
  }
  return "";
}

const PLACEHOLDER_NAMES = new Set([
  "未知联系人",
  "未知",
  "群成员",
  "unknown",
  "whatsapp 联系人",
  "whatsapp",
]);

/** 是否像 WhatsApp 内部 id / 占位名，不宜当显示名 */
export function looksLikeInternalId(raw?: string | null): boolean {
  if (!raw) return true;
  const s = raw.trim();
  if (!s) return true;
  if (PLACEHOLDER_NAMES.has(s.toLowerCase())) return true;
  if (s.includes("@lid") || s.includes("@s.whatsapp.net") || s.includes("@g.us"))
    return true;
  // 纯数字 ≥10 位多半是 LID，不是昵称
  if (/^\d{10,}$/.test(s)) return true;
  if (/^\+\d{16,}$/.test(s)) return true;
  return false;
}

/** 展示用电话：隐藏 WhatsApp @lid 等内部 id */
export function displayPhone(raw?: string | null): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.includes("@lid") || s.endsWith("@lid")) return "";
  if (s.includes("@s.whatsapp.net") || s.includes("@c.us")) {
    const d = s.split("@")[0].split(":")[0];
    return d && /^\d{7,15}$/.test(d) ? `+${d}` : "";
  }
  if (/^\d{7,15}$/.test(s)) return `+${s.replace(/^\+/, "")}`;
  if (s.startsWith("+") && /^\+\d{7,15}$/.test(s)) return s;
  // 过长的纯数字内部 id 不展示
  if (/^\d{16,}$/.test(s.replace(/\D/g, "")) && !s.startsWith("+")) return "";
  return "";
}

/**
 * 是否像把整段聊天内容误当成了私聊备注名。
 * 注意：群名可以很长、带标点/开场词，不能用同一套严规则，否则会全显示成「群聊」。
 */
export function looksLikeMessageAsName(raw?: string | null): boolean {
  if (!raw) return false;
  const s = raw.replace(/\s+/g, " ").trim();
  // 极长才像粘贴的消息；群名 40～80 字很常见
  if (s.length > 80) return true;
  if (/https?:\/\//i.test(s)) return true;
  // 多句结尾更像正文，不像标题
  if ((s.match(/[?!。.!?]/g) || []).length >= 2 && s.length > 24) return true;
  // 开场白 + 明显长句
  if (
    /^(salut|bonjour|bonsoir|hello|hi|merci)\b/i.test(s) &&
    s.length > 28 &&
    /\s/.test(s)
  )
    return true;
  return false;
}

/**
 * 会话/客户列表标题：
 * 1) WhatsApp 名字 / 群名 / 推送名
 * 2) 手机号
 * 3) 未备注联系人 / 群聊
 * 注意：不要用消息正文当标题（会和气泡重复、也无法当身份）
 */
export function displayContactLabel(
  name?: string | null,
  phone?: string | null,
  channelAddress?: string | null,
  _lastMessage?: string | null,
  opts?: { isGroup?: boolean }
): string {
  const n = (name || "").trim();
  const isGroup =
    opts?.isGroup ||
    (channelAddress || "").includes("@g.us") ||
    n.endsWith("@g.us");
  const p = isGroup ? "" : displayPhone(phone) || displayPhone(n);

  // 群：优先展示 subject；占位「群聊」仅在无真名时用
  if (isGroup) {
    if (
      n &&
      n !== "群聊" &&
      !looksLikeInternalId(n) &&
      !n.includes("@g.us")
    ) {
      return n;
    }
    return "群聊";
  }

  if (
    n &&
    n !== "群聊" &&
    !looksLikeInternalId(n) &&
    !looksLikeMessageAsName(n) &&
    n !== p &&
    !/^\+\d{7,15}$/.test(n)
  ) {
    return n;
  }
  if (p) return p;
  return "未备注联系人";
}

/** 头像字母：取姓名/号码可见字符（跳过 +、@、空格、emoji 等前缀） */
export function avatarInitials(name?: string | null, fallback = "?"): string {
  const t = (name || "").trim();
  if (!t) return fallback;
  // 去掉 emoji 与常见电话/账号前缀后再取字
  const stripped = t
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, "")
    .replace(/^[+\s@#._-]+/, "")
    .trim();
  const base = stripped || t;
  if (!base) return fallback;

  // 纯数字/电话：取首个有效数字（跳过前导 0）
  const digits = base.replace(/\D/g, "");
  if (digits.length >= 3 && /^[\d\s().+-]+$/.test(base)) {
    const significant = digits.replace(/^0+/, "") || digits;
    return significant.slice(0, 1);
  }

  const chars = [...base];
  if (/^[\u4e00-\u9fff]/.test(base)) {
    return chars.slice(0, 1).join("");
  }

  const parts = base.split(/\s+/).filter(Boolean);
  const firstLetter = (s: string) =>
    [...s].find((c) => /[\p{L}\p{N}]/u.test(c)) || "";

  if (parts.length >= 2) {
    const a = firstLetter(parts[0]!);
    const b = firstLetter(parts[1]!);
    const pair = `${a}${b}`.toUpperCase();
    if (pair) return pair;
  }

  const letters = chars.filter((c) => /[\p{L}\p{N}]/u.test(c));
  const pick = letters.length ? letters : chars;
  return pick.slice(0, Math.min(2, pick.length)).join("").toUpperCase() || fallback;
}

const AVATAR_COLORS = [
  "bg-emerald-600/35 text-emerald-100",
  "bg-sky-600/35 text-sky-100",
  "bg-violet-600/35 text-violet-100",
  "bg-amber-600/35 text-amber-100",
  "bg-rose-600/35 text-rose-100",
  "bg-teal-600/35 text-teal-100",
  "bg-indigo-600/35 text-indigo-100",
  "bg-orange-600/35 text-orange-100",
];

export function avatarColorClass(seed?: string | null): string {
  const s = seed || "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 跨号同一自然人：优先 E.164 数字，其次稳定 channel/jid */
export function buildPersonKey(input: {
  phone?: string | null;
  channelAddress?: string | null;
  jid?: string | null;
  isGroup?: boolean;
}): string | undefined {
  if (input.isGroup) {
    const g = (input.jid || input.channelAddress || "").trim();
    return g ? `group:${g}` : undefined;
  }
  const phone = (input.phone || "").replace(/\D/g, "");
  if (phone.length >= 7 && phone.length <= 15) return `tel:${phone}`;
  const ch = (input.channelAddress || input.jid || "").trim();
  if (!ch) return undefined;
  if (ch.includes("@lid")) return `lid:${ch}`;
  if (ch.includes("@s.whatsapp.net") || ch.includes("@c.us")) {
    const d = ch.split("@")[0].split(":")[0] || "";
    if (/^\d{7,15}$/.test(d)) return `tel:${d}`;
  }
  return `ch:${ch}`;
}
