export function resolveWaAccountConnection(
  accounts: readonly { id: string; status?: string }[] | null | undefined,
  accountId: string | null | undefined,
  liveAccountId: string | null | undefined,
  liveConnection: string | null | undefined
): string {
  if (!accountId) return "disconnected";
  if (accountId === liveAccountId && liveConnection) return liveConnection;
  return (
    accounts?.find((account) => account.id === accountId)?.status ||
    "disconnected"
  );
}

export function isWaAccountConnected(
  accounts: readonly { id: string; status?: string }[] | null | undefined,
  accountId: string | null | undefined,
  liveAccountId: string | null | undefined,
  liveConnection: string | null | undefined
): boolean {
  return (
    resolveWaAccountConnection(
      accounts,
      accountId,
      liveAccountId,
      liveConnection
    ) === "connected"
  );
}

/**
 * 解析出站消息的实际账号：兼容旧数据里的别名，但不跨已知账号发送。
 * 只有请求账号不存在且当前恰好一个账号在线时，才自动修正到该账号。
 */
export function resolveWaSendAccountId(
  accounts: readonly { id: string; status?: string }[] | null | undefined,
  requestedAccountId: string | null | undefined,
  liveAccountId: string | null | undefined,
  liveConnection: string | null | undefined
): string | null {
  const requested = (requestedAccountId || "").trim();
  const live = (liveAccountId || "").trim();
  const known = Boolean(requested && accounts?.some((account) => account.id === requested));
  if (requested && (known || isWaAccountConnected(accounts, requested, live, liveConnection))) {
    return requested;
  }

  const connected = (accounts || []).filter((account) => account.status === "connected");
  if (connected.length === 1) return connected[0]!.id;
  if (!requested && live && liveConnection === "connected") return live;
  return requested || live || accounts?.[0]?.id || null;
}
