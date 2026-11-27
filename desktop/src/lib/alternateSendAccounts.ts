/** Keep FIFO within each account, visiting accounts in the order they entered the queue. */
export function alternateSendAccounts<T>(items: readonly T[], accountFor: (item: T) => string, previous?: string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const account = accountFor(item);
    const group = groups.get(account);
    if (group) group.push(item);
    else groups.set(account, [item]);
  }
  const accounts = [...groups.keys()];
  const start = previous === undefined ? 0 : accounts.indexOf(previous) + 1;
  const orderedGroups = [...accounts.slice(start), ...accounts.slice(0, start)].map(account => groups.get(account)!);
  const ordered: T[] = [];
  for (let index = 0; ordered.length < items.length; index++) {
    for (const group of orderedGroups) {
      if (index < group.length) ordered.push(group[index]);
    }
  }
  return ordered;
}
