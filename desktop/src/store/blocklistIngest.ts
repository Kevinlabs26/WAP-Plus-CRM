/**
 * blocklist.sync / update → 设置项缓存。
 */

export function mergeBlocklistJids(
  prev: string[] | undefined,
  next: string[] | undefined
): string[] {
  if (!Array.isArray(next)) return prev || [];
  return [...new Set(next.map((j) => String(j || "").trim()).filter(Boolean))].sort();
}

export function applyBlocklistUpdate(
  prev: string[] | undefined,
  jids: string[] | undefined,
  type: string
): string[] {
  const set = new Set(prev || []);
  for (const j of jids || []) {
    const id = String(j || "").trim();
    if (!id) continue;
    if (type === "add") set.add(id);
    else set.delete(id);
  }
  return [...set].sort();
}
