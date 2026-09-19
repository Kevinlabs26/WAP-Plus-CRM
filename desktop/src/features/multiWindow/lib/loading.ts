export function selectVisibleLoadIds(
  visibleIds: string[],
  activeMemberChatByWindow: Record<string, string>,
  collapsedWindowIds: ReadonlySet<string>
) {
  const ids = new Set<string>();
  for (const windowId of visibleIds) {
    if (collapsedWindowIds.has(windowId)) continue;
    ids.add(windowId);
    const activeId = activeMemberChatByWindow[windowId];
    if (activeId) ids.add(activeId);
  }
  return [...ids];
}
