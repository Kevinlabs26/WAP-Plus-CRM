/**
 * 账号槽位展示：统一用数字前缀 1 / 2 / 3 …
 * - 存储 label 也尽量用 "1""2"（兼容旧数据「账号N」「WhatsApp」）
 * - 展示：有推送名 →「1: Novainteractive」；无 →「1」
 */

/** 自动序号标签：纯数字，或旧版「账号N」 */
const AUTO_LABEL = /^(?:账号\s*)?(\d+)$/u;
const OLD_AUTO_PREFIX = /^账号\s*\d+\s*[:：]?\s*/u;
const OLD_WA_PREFIX = /^WhatsApp\s*[:：]?\s*/iu;

export function nextAccountLabel(labels: string[]): string {
  const used = new Set(
    labels.map((label) => {
      const n = parseAccountSlotNumber(label);
      return n > 0 ? String(n) : label.trim();
    })
  );
  for (let n = 1; ; n += 1) {
    const label = String(n);
    if (!used.has(label) && !used.has(`账号${n}`) && !used.has(`账号 ${n}`)) {
      return label;
    }
  }
}

/** 从 label 解析槽位序号，失败返回 0 */
export function parseAccountSlotNumber(label?: string | null): number {
  const raw = String(label || "").trim();
  if (!raw) return 0;
  const m = raw.match(AUTO_LABEL);
  if (m) return Number(m[1]) || 0;
  // 「WhatsApp」等占位不算序号
  return 0;
}

function cleanSegment(s: string) {
  return s
    .trim()
    .replace(/^[:：\s]+/u, "")
    .replace(/[:：\s]+$/u, "")
    .trim();
}

/** 去掉名字上误带的槽位/品牌前缀 */
function stripNamePrefixes(name: string): string {
  let userName = cleanSegment(name);
  // 「账号2：E」/「1: E」/「WhatsApp: E」
  const prefixed = userName.match(
    /^(?:账号\s*)?\d+\s*[:：]\s*(.+)$/u
  );
  if (prefixed?.[1]) userName = cleanSegment(prefixed[1]);
  userName = userName.replace(OLD_WA_PREFIX, "").trim();
  userName = userName.replace(OLD_AUTO_PREFIX, "").trim();
  return userName;
}

/** Do not expose WhatsApp JIDs as human-readable account names. */
export function extractAccountHumanName(raw?: string | null): string {
  const name = stripNamePrefixes(String(raw || ""));
  if (!name) return "";
  if (/^~+$/u.test(name) || /^WhatsApp$/iu.test(name)) return "";
  if (/@(?:s\.whatsapp\.net|c\.us)$/iu.test(name)) return "";
  if (/^\+?\d{7,15}$/u.test(name)) return "";
  return name;
}

export function normalizeAccountUserName(
  raw?: string | null,
  phoneE164?: string | null
): string {
  const name = stripNamePrefixes(String(raw || ""));
  const humanName = extractAccountHumanName(name);
  const phone = String(phoneE164 || "").trim();
  if (humanName) return humanName;
  if (/^\+?\d{7,15}$/u.test(phone)) {
    return phone.startsWith("+") ? phone : `+${phone}`;
  }
  if (name && /@(?:s\.whatsapp\.net|c\.us)$/iu.test(name)) {
    const left = name.split("@")[0]?.split(":")[0] || "";
    return /^\d{7,15}$/u.test(left) ? `+${left}` : "";
  }
  return name;
}

/**
 * 列表主文案：N: 名字
 * - index1（列表位序）优先，保证和排序一致
 * - 自动槽显示数字；自定义 label 仍可显示原样（非数字/非旧自动标签时）
 */
export function formatAccountDisplay(opts: {
  label?: string | null;
  userName?: string | null;
  phoneE164?: string | null;
  /** 列表中的 1-based 位序（按 sort 排序后）——有则优先 */
  index1?: number;
}): string {
  const label = cleanSegment(String(opts.label || ""));
  let userName = normalizeAccountUserName(opts.userName, opts.phoneE164);

  const fromIndex = opts.index1 && opts.index1 > 0 ? opts.index1 : 0;
  const fromLabel = parseAccountSlotNumber(label);
  const isPlaceholder =
    !label ||
    AUTO_LABEL.test(label) ||
    /^WhatsApp$/iu.test(label) ||
    label === "未命名" ||
    label === "未登录";

  // 自动/占位：一律用列表位序数字；自定义名保留 label
  const n = isPlaceholder
    ? fromIndex || fromLabel || 0
    : fromIndex || fromLabel || 0;

  const slot =
    isPlaceholder && n > 0
      ? String(n)
      : !isPlaceholder && label
        ? label
        : n > 0
          ? String(n)
          : "1";

  if (!userName || userName === label || userName === slot) return slot;
  // 名字本身又是「2」这类自动标签时，不拼成「1: 2」
  if (AUTO_LABEL.test(userName) || /^WhatsApp$/iu.test(userName)) return slot;
  return `${slot}: ${userName}`;
}

export function dedupeAccountLabels<T extends { label: string }>(
  accounts: T[]
): T[] {
  const used = new Set<string>();
  let nextNumber =
    Math.max(
      0,
      ...accounts.map((account) => parseAccountSlotNumber(account.label))
    ) + 1;

  return accounts.map((account) => {
    const label = account.label.trim();
    const key = parseAccountSlotNumber(label)
      ? String(parseAccountSlotNumber(label))
      : label;
    if (!used.has(key) && !used.has(label)) {
      used.add(key);
      used.add(label);
      // 旧「账号N」规范成纯数字存储
      if (AUTO_LABEL.test(label) && label !== key) {
        return { ...account, label: key };
      }
      if (/^WhatsApp$/iu.test(label) || label === "未命名") {
        const n = String(nextNumber++);
        used.add(n);
        return { ...account, label: n };
      }
      return account;
    }

    let replacement: string;
    if (AUTO_LABEL.test(label) || !label || /^WhatsApp$/iu.test(label)) {
      do replacement = String(nextNumber++);
      while (used.has(replacement));
    } else {
      let suffix = 2;
      do replacement = `${label} (${suffix++})`;
      while (used.has(replacement));
    }
    used.add(replacement);
    return { ...account, label: replacement };
  });
}

/** 按 sort 重排后写回连续 sort，并可选把自动标签同步成 1…N */
export function reorderAccountSorts<
  T extends { id: string; label: string; sort: number },
>(accounts: T[], orderedIds: string[], renumberLabels = false): T[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered: T[] = [];
  for (const id of orderedIds) {
    const a = byId.get(id);
    if (a) {
      ordered.push(a);
      byId.delete(id);
    }
  }
  for (const a of byId.values()) ordered.push(a);

  return ordered.map((a, i) => {
    const next: T = { ...a, sort: i };
    if (renumberLabels) {
      const lab = a.label.trim();
      const auto =
        !lab ||
        AUTO_LABEL.test(lab) ||
        /^WhatsApp$/iu.test(lab) ||
        lab === "未命名";
      if (auto) next.label = String(i + 1);
    }
    return next;
  });
}
