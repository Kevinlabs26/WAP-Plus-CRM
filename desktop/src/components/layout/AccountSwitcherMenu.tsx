/**
 * 左上角 WhatsApp 账号菜单（独立文件，避免塞进 PhoneSidebar）
 * - 切换：全部 / 单号
 * - 同步会话 · 账号与设备 · 添加账号 · 退出
 */
import {
  Check,
  ChevronDown,
  LogOut,
  Plus,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { baileysLogout } from "@/lib/baileys";
import {
  isWaAccountConnected,
  resolveWaAccountConnection,
} from "@/lib/accountConnection";
import {
  dedupeAccountLabels,
  formatAccountDisplay,
  nextAccountLabel,
} from "@/lib/accountLabels";
import {
  createAccountSlot,
  ensureAccounts,
  healSingleSessionOwnership,
  pruneGhostDefaultAccounts,
} from "@/lib/accounts";
import type { AccountViewMode, WaAccount } from "@/types/account";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import { useI18n } from "@/i18n";

type Props = {
  syncing?: boolean;
  onSync?: () => void;
  /**
   * compact：顶栏横向芯片（当前账号 + 状态 + 下拉）
   * sidebar：侧栏全宽卡片（兼容旧布局）
   */
  variant?: "compact" | "sidebar";
};

export function AccountSwitcherMenu({
  syncing,
  onSync,
  variant = "sidebar",
}: Props) {
  const compact = variant === "compact";
  const { t } = useI18n();
  const baileysUi = useAppStore((s) => s.baileysUi);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setBaileysLoginOpen = useAppStore((s) => s.setBaileysLoginOpen);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const pushToast = useAppStore((s) => s.pushToast);
  const requestConfirm = useAppStore((s) => s.requestConfirm);

  // 不预置「主账号」；仅展示真实槽。在线但列表空时运行时会补一个 WhatsApp 槽。
  // ensureAccounts 按 sort 排序，与设备页顺序一致
  const accounts = dedupeAccountLabels(
    ensureAccounts(
      pruneGhostDefaultAccounts(settings.waAccounts || [], {
        preferKeepId:
          settings.liveBaileysAccountId || settings.activeAccountId || undefined,
      })
    )
  );
  const activeId = settings.activeAccountId || DEFAULT_ACCOUNT_ID;
  /** 真正占着 Baileys 连接的槽，不是「当前点选浏览」 */
  const liveId =
    settings.liveBaileysAccountId || activeId || DEFAULT_ACCOUNT_ID;
  const view: AccountViewMode = settings.accountViewMode || {
    type: "account",
    accountId: activeId,
  };
  const liveAccount =
    accounts.find((a) => a.id === liveId) || accounts[0];
  const connectionOf = (accountId: string | null | undefined) =>
    resolveWaAccountConnection(
      accounts,
      accountId,
      liveId,
      baileysUi.connection
    );

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const connected =
    baileysUi.connection === "connected" ||
    baileysUi.connection === "reconnecting" ||
    baileysUi.connection === "starting";

  // 已连接但没有任何账号槽：用 WA 推送名建真实槽（绝不叫主账号）
  useEffect(() => {
    if (!connected) return;
    const list = settings.waAccounts || [];
    if (list.length > 0) return;
    const id = settings.liveBaileysAccountId || DEFAULT_ACCOUNT_ID;
    const slot = createAccountSlot({
      id,
      label: baileysUi.userName || "WhatsApp",
      userName: baileysUi.userName || undefined,
      status: "connected",
    });
    updateSettings({
      waAccounts: [slot],
      activeAccountId: id,
      liveBaileysAccountId: id,
      accountViewMode: { type: "account", accountId: id },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, baileysUi.userName, settings.waAccounts?.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-account-menu]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 运行时纠偏：只收拾孤儿数据 / 幽灵主账号，不抢浏览焦点（防抖，避免连接抖动连写盘）
  useEffect(() => {
    if (baileysUi.connection !== "connected") return;
    const t = window.setTimeout(() => {
      const state = useAppStore.getState();
      const s = state.settings;
      const live =
        s.liveBaileysAccountId || s.activeAccountId || DEFAULT_ACCOUNT_ID;
      const healed = healSingleSessionOwnership({
        contacts: state.contacts,
        chats: state.chats,
        folders: s.chatFolders || [],
        accounts: s.waAccounts || [],
        liveAccountId: live,
        activeAccountId: s.activeAccountId || live,
      });
      if (!healed.changed) return;
      useAppStore.setState({
        contacts: healed.contacts,
        chats: healed.chats,
      });
      // 保留用户当前 active / view，只更新 accounts 结构与 live 纠正
      updateSettings({
        chatFolders: healed.folders as typeof s.chatFolders,
        waAccounts: healed.accounts,
        liveBaileysAccountId: healed.liveAccountId,
      });
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baileysUi.connection, baileysUi.userName]);

  // 顶栏：单号浏览跟该号；「全部」标题固定「全部账号」，不钉死账号1
  const browsingAll = view.type === "all";
  const focusId =
    view.type === "account" && view.accountId
      ? view.accountId
      : liveId;
  const focusAccount =
    accounts.find((a) => a.id === focusId) || liveAccount || accounts[0];
  const focusIndex1 =
    Math.max(
      0,
      accounts.findIndex((a) => a.id === focusId)
    ) + 1 || 1;
  const focusIsLive = focusId === liveId;
  const connectedAccountCount = accounts.filter(
    (account) => connectionOf(account.id) === "connected"
  ).length;
  const anyOnline =
    connectedAccountCount > 0 ||
    (accounts.length === 0 && baileysUi.connection === "connected");
  const liveConnection = connectionOf(liveId);
  const anyRestoring =
    liveConnection === "reconnecting" || liveConnection === "starting";
  const focusConnection = connectionOf(focusId);
  const focusOnline =
    focusConnection === "connected" ||
    focusConnection === "reconnecting" ||
    focusConnection === "starting";
  const statusLabel = browsingAll
    ? anyOnline
      ? t("account.connected")
      : anyRestoring
        ? t("account.reconnecting")
        : t("account.disconnected")
    : focusOnline
      ? focusConnection === "reconnecting" || focusConnection === "starting"
        ? t("account.reconnecting")
        : t("account.connected")
      : focusConnection === "qr" || focusConnection === "connecting"
        ? focusConnection === "qr"
          ? t("account.waitingQr")
          : t("account.connecting")
        : connected && !focusAccount
          ? t("account.connected")
          : t("account.disconnected");

  const liveIndex1 =
    Math.max(
      0,
      accounts.findIndex((a) => a.id === liveId)
    ) + 1 || 1;
  const liveDisplayName = liveAccount
    ? formatAccountDisplay({
        label: liveAccount.label,
        userName: baileysUi.userName || liveAccount.userName || null,
        phoneE164: liveAccount.phoneE164,
        index1: liveIndex1,
      })
    : null;

  const displayName = browsingAll
    ? t("account.allAccounts")
    : focusAccount
      ? formatAccountDisplay({
          label: focusAccount.label,
          userName:
            focusIsLive
              ? baileysUi.userName || focusAccount.userName || null
              : focusAccount.userName || null,
          phoneE164: focusAccount.phoneE164,
          index1: focusIndex1,
        })
      : baileysUi.userName ||
        accounts.find((a) => a.id === activeId)?.label ||
        (connected ? "WhatsApp" : t("account.disconnected"));

  const liveDisplay =
    liveAccount && liveId && liveId !== focusId ? liveDisplayName : null;

  const accountTitle = (a: WaAccount, index1: number) => {
    // 只有直播槽才用当前 WA 推送名
    const liveName =
      a.id === liveId &&
      (["connected", "reconnecting", "starting"] as string[]).includes(
        connectionOf(a.id)
      )
        ? baileysUi.userName
        : null;
    // 空槽 / 未登录：强制 label，禁止显示抄来的 userName
    if (a.id !== liveId && a.status !== "connected") {
      return formatAccountDisplay({
        label: a.label,
        userName: null,
        index1,
      });
    }
    return formatAccountDisplay({
      label: a.label,
      userName: liveName || a.userName,
      phoneE164: a.phoneE164,
      index1,
    });
  };

  const statusSuffix = (a: WaAccount) => {
    const connection = connectionOf(a.id);
    if (connection === "connected") return ` · ${t("common.online")}`;
    if (
      connection === "connecting" ||
      connection === "reconnecting" ||
      connection === "starting" ||
      connection === "close"
    )
      return ` · ${t("account.reconnecting")}`;
    if (connection === "qr") return ` · ${t("account.waitingQr")}`;
    if (connection === "error") return ` · ${t("account.error")}`;
    return ` · ${t("account.disconnected")}`;
  };

  const actionAccountId = browsingAll ? liveId : focusId;
  const actionAccount = accounts.find((a) => a.id === actionAccountId);
  const actionAccountConnected = isWaAccountConnected(
    accounts,
    actionAccountId,
    liveId,
    baileysUi.connection
  );

  const triggerOnline = browsingAll
    ? anyOnline
    : focusOnline || (focusIsLive && connected);
  const statusNeedsAttention = browsingAll
    ? anyRestoring
    : ["qr", "connecting", "reconnecting", "starting", "close"].includes(
        focusConnection
      );
  const statusHasError = !browsingAll && focusConnection === "error";

  const subtitle = browsingAll
    ? `${t("account.mergedBrowse")} · ${t("account.defaultSend")} ${liveDisplayName || "—"}`
    : liveDisplay
      ? `${t("account.defaultSend")} ${liveDisplay} · ${t("account.clickSwitch")}`
      : focusOnline
        ? `${t("account.current")} · ${t("account.clickManage")}`
        : anyOnline
          ? t("account.notConnectedHere")
          : anyRestoring
            ? t("account.restoring")
            : t("account.clickLogin");

  return (
    <div
      className={cn("relative", compact && "min-w-0 max-w-[min(20rem,42vw)]")}
      data-account-menu
      ref={rootRef}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${displayName} · ${statusLabel}${subtitle ? ` · ${subtitle}` : ""}`}
        className={cn(
          "text-left transition-colors",
          compact
            ? cn(
                "flex h-8 max-w-full items-center gap-2 rounded-lg border px-2.5",
                open
                  ? "border-brand/45 bg-zinc-800/90 ring-1 ring-brand/25"
                  : "border-zinc-700/80 bg-zinc-950/60 hover:border-zinc-600 hover:bg-zinc-900"
              )
            : cn(
                "flex w-full flex-col items-stretch rounded-lg border bg-zinc-900/50 px-2.5 py-2",
                open
                  ? "border-brand/40 ring-1 ring-brand/20"
                  : "border-zinc-800/90 hover:border-zinc-700"
              )
        )}
      >
        {compact ? (
          <>
            <span className="relative shrink-0">
              <Avatar
                name={displayName}
                seed={focusAccount?.id || liveId || displayName}
                variant={browsingAll ? "accounts" : "default"}
                src={
                  browsingAll
                    ? undefined
                    : focusAccount?.avatarUrl ||
                      (focusIsLive ? liveAccount?.avatarUrl : undefined)
                }
                size="sm"
                className="!h-6 !w-6 translate-y-px !text-2xs"
                online={triggerOnline}
                onlineTitle={statusLabel}
              />
            </span>
            <span className="min-w-0 truncate text-[12px] font-medium text-zinc-100">
              {displayName}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-2xs tabular-nums",
                triggerOnline
                  ? "bg-brand/15 text-brand"
                  : statusNeedsAttention
                    ? "bg-amber-500/15 text-amber-300"
                    : statusHasError
                      ? "bg-rose-500/15 text-rose-300"
                      : "bg-zinc-800 text-zinc-500"
              )}
            >
              {statusLabel}
            </span>
            {accounts.length > 1 && (
              <span className="hidden shrink-0 text-2xs text-zinc-600 sm:inline">
                {connectedAccountCount}/{accounts.length}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform",
                open && "rotate-180"
              )}
            />
          </>
        ) : (
          <>
            <div className="flex w-full items-center justify-between gap-1">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar
                  name={displayName}
                  seed={focusAccount?.id || liveId || displayName}
                  variant={browsingAll ? "accounts" : "default"}
                  src={
                    browsingAll
                      ? undefined
                      : focusAccount?.avatarUrl ||
                        (focusIsLive ? liveAccount?.avatarUrl : undefined)
                  }
                  size="sm"
                  className="!h-6 !w-6 !text-2xs"
                  online={triggerOnline}
                />
                <span className="truncate text-[13px] font-medium">
                  {displayName}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-2xs text-zinc-500">
                {statusLabel}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-zinc-600 transition-transform",
                    open && "rotate-180"
                  )}
                />
              </span>
            </div>
            <div className="mt-0.5 break-words text-2xs text-zinc-500">
              {browsingAll
                ? `${t("account.mergedBrowse")} · ${t("account.defaultSend")} ${liveDisplayName || "—"}`
                : liveDisplay
                  ? `${t("account.defaultSend")} ${liveDisplay} · ${t("account.clickSwitch")}`
                  : focusOnline
                    ? `${t("account.current")} · ${t("account.clickManage")}`
                    : anyOnline
                      ? `${t("account.notConnectedHere")} · ${t("account.accountDevices")}`
                      : anyRestoring
                        ? `${t("account.restoring")}，无需扫码`
                        : `${t("account.clickLogin")} WhatsApp`}
            </div>
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "z-50 max-h-[min(60vh,18rem)] overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-0.5 shadow-xl shadow-black/50",
            compact
              ? "absolute left-0 top-[calc(100%+4px)] w-[min(14.5rem,calc(100vw-1.5rem))]"
              : "absolute left-0 right-0 top-[calc(100%+4px)]"
          )}
        >
          <div className="border-b border-zinc-800 px-1.5 py-1">
            <div className="px-1.5 pb-0.5 text-2xs font-medium uppercase tracking-wide text-zinc-600">
              {t("account.switchAccount")}
            </div>
            <button
              type="button"
              className={cn(
                "mt-0.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px]",
                view.type === "all"
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-300 hover:bg-zinc-800/80"
              )}
              onClick={() => {
                updateSettings({ accountViewMode: { type: "all" } });
                pushToast(t("account.listAll"), "info");
                setOpen(false);
              }}
            >
              <Users className="h-3 w-3 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate">{t("account.allAccountsMerged")}</span>
              {view.type === "all" && (
                <Check className="h-3 w-3 shrink-0 text-brand" />
              )}
            </button>
            {accounts.map((a, idx) => {
              const selected =
                view.type === "account" && view.accountId === a.id;
              const isLive = a.id === liveId;
              const title = accountTitle(a, idx + 1);
              // 多号：非 live 只要槽 status=connected 也算在线
              const onlineHere = connectionOf(a.id) === "connected";
              const rowName =
                (isLive && baileysUi.userName) ||
                a.userName ||
                a.label ||
                title;
              return (
                <button
                  key={a.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px]",
                    selected
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-300 hover:bg-zinc-800/80"
                  )}
                  onClick={() => {
                    // 浏览/发送焦点切到此号；仅当此号已在线才改 live（避免未登录槽顶掉真连接）
                    updateSettings({
                      activeAccountId: a.id,
                      accountViewMode: {
                        type: "account",
                        accountId: a.id,
                      },
                      ...(onlineHere || a.status === "connected"
                        ? { liveBaileysAccountId: a.id }
                        : {}),
                    });
                    // 切号时清掉上一号选中的会话/联系人，避免中间栏还显示串号聊天
                    useAppStore.setState({
                      selectedChatId: null,
                      selectedContactId: null,
                      focusMessageId: null,
                    });
                    const label = accountTitle(a, idx + 1);
                    pushToast(
                      onlineHere || a.status === "connected"
                        ? t("account.switched", { name: label })
                        : a.status === "qr" || a.status === "connecting"
                          ? t("account.switchedConnecting", { name: label })
                          : t("account.switchedDisconnected", { name: label }),
                      "info"
                    );
                    setOpen(false);
                  }}
                >
                  <Avatar
                    name={rowName}
                    seed={a.id}
                    src={a.avatarUrl}
                    size="sm"
                    className="!h-4.5 !w-4.5 !text-[8px] h-[18px] w-[18px]"
                    online={onlineHere}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {title}
                    {statusSuffix(a)}
                  </span>
                  {selected && (
                    <Check className="h-3 w-3 shrink-0 text-brand" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-zinc-800 py-0.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
              disabled={
                syncing ||
                !actionAccountConnected
              }
                title={
                !actionAccountConnected
                  ? t("account.currentNotConnected")
                  : t("account.syncLatest")
              }
              onClick={() => {
                setOpen(false);
                onSync?.();
              }}
            >
              <RefreshCw
                className={
                  syncing
                    ? "h-3 w-3 animate-spin text-zinc-400"
                    : "h-3 w-3 text-zinc-400"
                }
              />
              {syncing ? t("account.syncing") : t("account.syncChats")}
            </button>
            {activeId !== liveId &&
              accounts.find((a) => a.id === activeId)?.status !== "connected" && (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-brand hover:bg-zinc-800"
                  onClick={() => {
                    setOpen(false);
                    setActiveNav("phones");
                    pushToast(t("account.loginHint"), "info");
                  }}
                >
                  <Settings2 className="h-3 w-3" />
                  {t("account.loginThis")}
                </button>
              )}
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
              onClick={() => {
                setOpen(false);
                setActiveNav("phones");
              }}
            >
              <Settings2 className="h-3 w-3 text-zinc-400" />
              {t("account.accountDevices")}
            </button>
          </div>

          <div className="border-t border-zinc-800 py-0.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
              onClick={() => {
                if (accounts.length >= 5) {
                  pushToast(t("account.maxReached"), "info");
                  return;
                }
                const id = `wa-${Date.now().toString(36)}`;
                const slot = createAccountSlot({
                  id,
                  label: nextAccountLabel(accounts.map((a) => a.label)),
                  sort: accounts.length,
                  status: "disconnected",
                  userName: undefined,
                  color: ["sky", "violet", "amber", "rose"][accounts.length % 4],
                });
                const keepLive =
                  settings.liveBaileysAccountId ||
                  (connected ? liveId : "") ||
                  "";
                updateSettings({
                  waAccounts: [...accounts, slot],
                  activeAccountId: id,
                  ...(keepLive ? {} : { liveBaileysAccountId: id }),
                  accountViewMode: { type: "account", accountId: id },
                });
                setOpen(false);
                if (keepLive) {
                  pushToast(t("account.addedLogin", { name: slot.label }), "info");
                  setActiveNav("phones");
                } else {
                  pushToast(t("account.createdLogin", { name: slot.label }), "info");
                  window.setTimeout(() => setBaileysLoginOpen(true), 50);
                }
              }}
            >
              <Plus className="h-3 w-3 text-zinc-400" />
              {t("account.add")}
            </button>
          </div>

          <div className="border-t border-zinc-800 py-0.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!actionAccountConnected}
              onClick={() => {
                setOpen(false);
                void (async () => {
                  const index = accounts.findIndex(
                    (account) => account.id === actionAccountId
                  );
                  const label = actionAccount
                    ? accountTitle(actionAccount, Math.max(0, index) + 1)
                    : "当前账号";
                  const ok = await requestConfirm({
                    title: t("account.logoutConfirm", { name: label }),
                    description: t("account.logoutDescription"),
                    confirmLabel: t("account.logout"),
                    cancelLabel: t("account.cancel"),
                    tone: "danger",
                  });
                  if (!ok) return;
                  try {
                    await baileysLogout(actionAccountId);
                    // 退出只清目标槽资料，不动其它账号
                    updateSettings({
                      waAccounts: accounts.map((a) =>
                        a.id === actionAccountId
                          ? {
                              ...a,
                              status: "disconnected",
                              userName: undefined,
                              avatarUrl: undefined,
                              updatedAt: new Date().toISOString(),
                            }
                          : a
                      ),
                    });
                    pushToast(t("account.loggedOut"), "info");
                    setBaileysLoginOpen(true);
                  } catch (e) {
                    pushToast(
                      e instanceof Error ? e.message : t("account.logoutFailed"),
                      "error"
                    );
                  }
                })();
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
              {browsingAll ? t("account.logoutDefault") : t("account.logoutCurrent")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
