import {
  DEFAULT_ACCOUNT_ID,
  type AccountViewMode,
  type FolderScope,
  type WaAccount,
} from "@/types/account";

/** 技术默认 id（兼容旧数据）；展示名绝不用「主账号」 */
export function createAccountSlot(
  partial?: Partial<WaAccount>
): WaAccount {
  const now = new Date().toISOString();
  const id = partial?.id || `wa-${Date.now().toString(36)}`;
  const base: WaAccount = {
    id,
    label: "未命名",
    status: "disconnected",
    color: "brand",
    sort: 0,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...base,
    ...partial,
    id,
    label: String(partial?.label ?? base.label).slice(0, 40),
  };
}

/** @deprecated 使用 createAccountSlot；保留别名避免大面积改名 */
export function createDefaultAccount(
  partial?: Partial<WaAccount>
): WaAccount {
  return createAccountSlot({
    id: DEFAULT_ACCOUNT_ID,
    label: "WhatsApp",
    ...partial,
  });
}

function isGhostPlaceholderLabel(label: string, userName?: string): boolean {
  const l = (label || "").trim();
  if (userName && userName.trim()) return false;
  return l === "主账号" || l === "主帐户" || l === "默认账号";
}

/**
 * 规范化账号列表：
 * - 去掉文案「主账号」占位（无 userName 时改成 WhatsApp / 未登录）
 * - 若存在已连接槽，删除无数据的幽灵默认槽
 * - 允许空列表（未登录）
 */
export function ensureAccounts(list: unknown): WaAccount[] {
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }
  const now = new Date().toISOString();
  const out: WaAccount[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] as Partial<WaAccount>;
    const id = String(raw?.id || "").trim() || `wa-${i}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let label = String(raw?.label || "").slice(0, 40);
    const userName = raw?.userName
      ? String(raw.userName).slice(0, 80)
      : undefined;
    if (!label || isGhostPlaceholderLabel(label, userName)) {
      label = userName || "WhatsApp";
    }
    const avatarUrl = raw?.avatarUrl
      ? String(raw.avatarUrl).slice(0, 3_500_000)
      : undefined;
    out.push({
      id,
      label,
      userName,
      phoneE164: raw?.phoneE164
        ? String(raw.phoneE164).slice(0, 24)
        : undefined,
      avatarUrl: avatarUrl || undefined,
      status: normalizeStatus(raw?.status),
      color: raw?.color ? String(raw.color).slice(0, 24) : "brand",
      sort: Number.isFinite(Number(raw?.sort)) ? Number(raw.sort) : i,
      createdAt: String(raw?.createdAt || now),
      updatedAt: String(raw?.updatedAt || now),
      lastSyncAt: raw?.lastSyncAt ? String(raw.lastSyncAt) : undefined,
      warmupExempt: raw?.warmupExempt === true,
    });
  }
  return out.sort(
    (a, b) => a.sort - b.sort || a.label.localeCompare(b.label, "zh")
  );
}

/**
 * 若有真实在线/已命名槽，剔除空的「主账号/wa-default」幽灵槽
 */
export function pruneGhostDefaultAccounts(
  accounts: WaAccount[],
  opts?: { preferKeepId?: string }
): WaAccount[] {
  if (accounts.length <= 1) {
    return accounts.map((a) =>
      isGhostPlaceholderLabel(a.label, a.userName)
        ? { ...a, label: a.userName || "WhatsApp" }
        : a
    );
  }
  const prefer = opts?.preferKeepId;
  const hasReal = accounts.some(
    (a) =>
      a.id !== DEFAULT_ACCOUNT_ID &&
      (a.status === "connected" ||
        !!(a.userName && a.userName.trim()) ||
        (a.label && !isGhostPlaceholderLabel(a.label, a.userName)))
  );
  if (!hasReal && !prefer) return accounts;

  return accounts.filter((a) => {
    if (prefer && a.id === prefer) return true;
    const ghostDefault =
      a.id === DEFAULT_ACCOUNT_ID ||
      isGhostPlaceholderLabel(a.label, a.userName);
    const empty =
      a.status !== "connected" && !(a.userName && a.userName.trim());
    // 丢掉：默认 id 且空、或文案是主账号且空
    if (ghostDefault && empty) {
      // 若 prefer 就是它则保留
      if (prefer === a.id) return true;
      return false;
    }
    return true;
  });
}

function normalizeStatus(s: unknown): WaAccount["status"] {
  const v = String(s || "");
  if (
    v === "disconnected" ||
    v === "connecting" ||
    v === "qr" ||
    v === "connected" ||
    v === "error"
  ) {
    return v;
  }
  return "disconnected";
}

export function ensureActiveAccountId(
  activeId: unknown,
  accounts: WaAccount[]
): string {
  const id = String(activeId || "").trim();
  if (id && accounts.some((a) => a.id === id)) return id;
  return accounts[0]?.id || DEFAULT_ACCOUNT_ID;
}

export function parseViewMode(
  raw: unknown,
  fallbackAccountId = DEFAULT_ACCOUNT_ID
): AccountViewMode {
  if (!raw || typeof raw !== "object") {
    return { type: "account", accountId: fallbackAccountId };
  }
  const t = (raw as { type?: string }).type;
  if (t === "all") return { type: "all" };
  if (t === "account") {
    const accountId = String(
      (raw as { accountId?: string }).accountId || ""
    ).trim();
    if (accountId) return { type: "account", accountId };
  }
  return { type: "account", accountId: fallbackAccountId };
}

export function folderScopeKey(scope: FolderScope): string {
  return scope.type === "all" ? "all" : `account:${scope.accountId}`;
}

export function folderMatchesView(
  scope: FolderScope | undefined,
  view: AccountViewMode,
  fallbackAccountId: string
): boolean {
  const s: FolderScope =
    scope ||
    ({ type: "account", accountId: fallbackAccountId } as FolderScope);
  if (view.type === "all") {
    return s.type === "all";
  }
  return s.type === "account" && s.accountId === view.accountId;
}

export function accountBadgeColor(color?: string): string {
  switch (color) {
    case "sky":
      return "bg-sky-500/20 text-sky-300";
    case "violet":
      return "bg-violet-500/20 text-violet-300";
    case "amber":
      return "bg-amber-500/20 text-amber-200";
    case "rose":
      return "bg-rose-500/20 text-rose-300";
    default:
      return "bg-brand/15 text-brand";
  }
}

type FolderLike = {
  scope?: { type: "all" } | { type: "account"; accountId: string };
};

/**
 * 数据归属纠偏（多槽兼容）：
 * - 仅把「无 accountId / 无效槽孤儿」归到直播槽
 * - 绝不改写其它已存在槽的数据
 * - 绝不强制 active/view 跳回直播槽（否则无法添加/选中新号）
 */
export function healSingleSessionOwnership<
  C extends { accountId?: string },
  H extends { accountId?: string },
  F extends FolderLike,
>(opts: {
  contacts: C[];
  chats: H[];
  folders: F[];
  accounts: WaAccount[];
  liveAccountId: string;
  activeAccountId: string;
}): {
  contacts: C[];
  chats: H[];
  folders: F[];
  accounts: WaAccount[];
  liveAccountId: string;
  activeAccountId: string;
  viewAccountId: string;
  changed: boolean;
} {
  let accounts = ensureAccounts(opts.accounts);
  let liveId = (opts.liveAccountId || "").trim();
  let changed = false;

  // 允许空列表（新装 / 用户删光）——不要偷偷塞回「WhatsApp」占位槽
  if (accounts.length && liveId && !accounts.some((a) => a.id === liveId)) {
    const connected = accounts.find((a) => a.status === "connected");
    liveId = connected?.id || accounts[0]!.id;
    changed = true;
  }
  if (!accounts.length) {
    liveId = "";
  } else if (!liveId) {
    const connected = accounts.find((a) => a.status === "connected");
    liveId = connected?.id || accounts[0]!.id;
    changed = true;
  }

  const knownIds = new Set(accounts.map((a) => a.id));
  // 无槽时不迁移归属（保持原 accountId），有槽才把孤儿归到 live
  const migrateOwner = (idRaw?: string) => {
    if (!accounts.length) {
      return { next: (idRaw || "").trim(), move: false };
    }
    const id = (idRaw || "").trim();
    if (!id) return { next: liveId, move: true };
    if (id === liveId) return { next: id, move: false };
    // 其它真实槽：保留
    if (knownIds.has(id) && id !== DEFAULT_ACCOUNT_ID) {
      return { next: id, move: false };
    }
    // wa-default 且 default 槽已不存在 → 归 live
    if (id === DEFAULT_ACCOUNT_ID && !knownIds.has(DEFAULT_ACCOUNT_ID)) {
      return { next: liveId, move: true };
    }
    // 指向已删除槽
    if (!knownIds.has(id)) return { next: liveId, move: true };
    return { next: id, move: false };
  };

  const contacts = opts.contacts.map((c) => {
    const { next, move } = migrateOwner(c.accountId);
    if (!move) return c;
    changed = true;
    return { ...c, accountId: next };
  });

  const chats = opts.chats.map((c) => {
    const { next, move } = migrateOwner(c.accountId);
    if (!move) return c;
    changed = true;
    return { ...c, accountId: next };
  });

  const folders = opts.folders.map((f) => {
    if (f.scope?.type === "all") return f;
    const aid = f.scope?.type === "account" ? f.scope.accountId : "";
    const { next, move } = migrateOwner(aid || undefined);
    if (!aid) {
      changed = true;
      return {
        ...f,
        scope: { type: "account" as const, accountId: liveId },
      };
    }
    if (!move) return f;
    changed = true;
    return {
      ...f,
      scope: { type: "account" as const, accountId: next },
    };
  });

  const before = accounts.length;
  accounts = pruneGhostDefaultAccounts(accounts, { preferKeepId: liveId });
  if (!accounts.some((a) => a.id === liveId)) {
    const keep = opts.accounts.find((a) => a.id === liveId);
    if (keep) {
      accounts = [
        {
          ...keep,
          label: isGhostPlaceholderLabel(keep.label, keep.userName)
            ? keep.userName || "WhatsApp"
            : keep.label,
        },
        ...accounts,
      ];
    }
  }
  accounts = accounts.map((a) => {
    if (isGhostPlaceholderLabel(a.label, a.userName)) {
      changed = true;
      return { ...a, label: a.userName || "WhatsApp" };
    }
    // 清空：空槽不得挂着直播号的 userName
    if (
      a.id !== liveId &&
      a.status !== "connected" &&
      a.userName &&
      accounts.find((x) => x.id === liveId)?.userName === a.userName
    ) {
      changed = true;
      return { ...a, userName: undefined, status: "disconnected" as const };
    }
    return a;
  });
  if (accounts.length !== before) changed = true;

  const known2 = new Set(accounts.map((a) => a.id));
  const activeAccountId = known2.has(opts.activeAccountId)
    ? opts.activeAccountId
    : liveId;

  return {
    contacts,
    chats,
    folders,
    accounts,
    liveAccountId: liveId,
    activeAccountId,
    viewAccountId: activeAccountId,
    changed,
  };
}
