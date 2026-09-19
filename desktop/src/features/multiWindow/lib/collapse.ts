export function updateCollapsedWindowIds(
  current: string[],
  windowIds: string[],
  collapsed: boolean
) {
  const visibleIds = new Set(windowIds);
  if (!collapsed) return current.filter((id) => !visibleIds.has(id));
  return [...new Set([...current, ...windowIds])];
}
