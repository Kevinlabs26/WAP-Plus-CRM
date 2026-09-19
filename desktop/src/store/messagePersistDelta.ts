type MessageRow = { id: string };

/** SQLite 增量消息：新增/变化行 + 从内存明确删除的 id。 */
export function diffMessageRows<T extends MessageRow>(
  previous: T[],
  current: T[]
): { changedRows: T[]; deletedIds: string[] } {
  if (!previous.length) return { changedRows: current, deletedIds: [] };
  const previousById = new Map(previous.map((message) => [message.id, message]));
  const currentIds = new Set(current.map((message) => message.id));
  return {
    changedRows: current.filter(
      (message) => previousById.get(message.id) !== message
    ),
    deletedIds: previous
      .filter((message) => !currentIds.has(message.id))
      .map((message) => message.id),
  };
}
