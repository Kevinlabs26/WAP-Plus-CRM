export function prioritizePinned(ids: string[], pinnedIds: ReadonlySet<string>) {
  return [...ids].sort((a, b) => {
    const aPinned = pinnedIds.has(a) ? 1 : 0;
    const bPinned = pinnedIds.has(b) ? 1 : 0;
    return bPinned - aPinned;
  });
}
