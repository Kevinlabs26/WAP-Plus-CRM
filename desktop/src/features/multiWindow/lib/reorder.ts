export function moveId(ids: string[], sourceId: string, targetId: string) {
  if (sourceId === targetId) return ids;
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return ids;

  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(next.indexOf(targetId), 0, sourceId);
  return next;
}

export function moveByOffset(ids: string[], sourceId: string, offset: -1 | 1) {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0) return ids;
  const targetIndex = sourceIndex + offset;
  if (targetIndex < 0 || targetIndex >= ids.length) return ids;
  const next = [...ids];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}
