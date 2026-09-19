/**
 * 按 WhatsApp 账号槽缓存的元数据（黑名单、历史同步文案）。
 * 与全局 settings 字段解耦，避免多号串数据。
 */

export function resolveWaMetaAccountId(
  explicit?: string | null,
  fallbacks?: {
    liveBaileysAccountId?: string | null;
    activeAccountId?: string | null;
    deviceId?: string | null;
  }
): string {
  const cands = [
    explicit,
    fallbacks?.deviceId,
    fallbacks?.liveBaileysAccountId,
    fallbacks?.activeAccountId,
  ];
  for (const c of cands) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "wa-default";
}

export function getAccountBlocklist(
  map: Record<string, string[]> | undefined,
  accountId: string,
  legacyGlobal?: string[]
): string[] {
  const id = String(accountId || "").trim();
  if (id && map && Array.isArray(map[id])) {
    return [...map[id]];
  }
  // 兼容旧版全局字段
  if (Array.isArray(legacyGlobal) && legacyGlobal.length) {
    return [...legacyGlobal];
  }
  return [];
}

export function setAccountBlocklist(
  map: Record<string, string[]> | undefined,
  accountId: string,
  jids: string[]
): Record<string, string[]> {
  const id = String(accountId || "").trim() || "wa-default";
  const next = { ...(map || {}) };
  next[id] = [
    ...new Set(jids.map((j) => String(j || "").trim()).filter(Boolean)),
  ].sort();
  return next;
}

export function getAccountHistoryNote(
  map: Record<string, string> | undefined,
  accountId: string,
  legacyGlobal?: string
): string {
  const id = String(accountId || "").trim();
  if (id && map && typeof map[id] === "string" && map[id]) return map[id];
  if (typeof legacyGlobal === "string" && legacyGlobal) return legacyGlobal;
  return "";
}

export function setAccountHistoryNote(
  map: Record<string, string> | undefined,
  accountId: string,
  note: string
): Record<string, string> {
  const id = String(accountId || "").trim() || "wa-default";
  const next = { ...(map || {}) };
  const n = String(note || "").trim();
  if (n) next[id] = n;
  else delete next[id];
  return next;
}

export function isJidBlocked(
  blocklist: string[],
  target: string | null | undefined
): boolean {
  const t = String(target || "").trim();
  if (!t || !blocklist?.length) return false;
  const td = t.replace(/\D/g, "");
  return blocklist.some((j) => {
    const jj = String(j || "").trim();
    if (!jj) return false;
    if (jj === t) return true;
    if (t.includes(jj) || jj.includes(t)) return true;
    const jd = jj.replace(/@.+$/, "").replace(/\D/g, "");
    return Boolean(td && jd && (td === jd || td.endsWith(jd) || jd.endsWith(td)));
  });
}
