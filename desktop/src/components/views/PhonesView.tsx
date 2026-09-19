import {
  Plus,
  QrCode,
  Smartphone,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import {
  isWaAccountConnected,
  resolveWaAccountConnection,
} from "@/lib/accountConnection";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import {
  adbForward,
  bridgeInvoke,
  connectBridge,
  disconnectBridge,
  getBridgeStatus,
  isTauri,
  type BridgeStatus,
} from "@/lib/bridge";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  OnlineDot,
} from "@/components/ui/primitives";
import { BaileysConnectCard } from "@/components/settings/BaileysConnectCard";
import { AccountSlotCard } from "./AccountSlotCard";
import { AndroidBridgePanel } from "./AndroidBridgePanel";
import { applyAccountWarmup } from "@/lib/accountWarmup";
import { DEFAULT_RATE_LIMITS } from "@/channels";
import { useI18n } from "@/i18n";
import {
  formatAccountDisplay,
  nextAccountLabel,
  reorderAccountSorts,
} from "@/lib/accountLabels";
import {
  createAccountSlot,
  ensureAccounts,
  pruneGhostDefaultAccounts,
} from "@/lib/accounts";
import { baileysStopAccount } from "@/lib/baileys";
import {
  dedupePhones,
  isAndroidBridgePhone,
} from "@/store/deviceIngest";

type DeviceTab = "web" | "android";

/**
 * 设备页：WhatsApp 账号（日常）与真机 Bridge（可选）分区，不混排。
 */
export function PhonesView() {
  const { t } = useI18n();
  const phonesRaw = useAppStore((s) => s.phones);
  const contacts = useAppStore((s) => s.contacts);
  const {
    bridgeHost,
    bridgePort,
    bridgeToken,
    liveBaileysAccountId,
    activeAccountId,
    waAccounts,
    accountViewMode,
    sendChannel,
    ratePerHour,
    ratePerMinute,
    rateMinIntervalSec,
    sendPausedAccountIds,
    blocklistByAccountId,
    historySyncNoteByAccountId,
    personPrimaryAccountByKey,
  } = useAppStore(
    useShallow((s) => ({
      bridgeHost: s.settings.bridgeHost,
      bridgePort: s.settings.bridgePort,
      bridgeToken: s.settings.bridgeToken,
      liveBaileysAccountId: s.settings.liveBaileysAccountId,
      activeAccountId: s.settings.activeAccountId,
      waAccounts: s.settings.waAccounts,
      accountViewMode: s.settings.accountViewMode,
      sendChannel: s.settings.sendChannel,
      ratePerHour: s.settings.ratePerHour,
      ratePerMinute: s.settings.ratePerMinute,
      rateMinIntervalSec: s.settings.rateMinIntervalSec,
      sendPausedAccountIds: s.settings.sendPausedAccountIds,
      blocklistByAccountId: s.settings.blocklistByAccountId,
      historySyncNoteByAccountId: s.settings.historySyncNoteByAccountId,
      personPrimaryAccountByKey: s.settings.personPrimaryAccountByKey,
    }))
  );
  const updateSettings = useAppStore((s) => s.updateSettings);
  const baileysUi = useAppStore((s) => s.baileysUi);
  const setBaileysUi = useAppStore((s) => s.setBaileysUi);

  const selectedPhoneId = useAppStore((s) => s.selectedPhoneId);
  const setSelectedPhone = useAppStore((s) => s.setSelectedPhone);
  const setBridgeRuntime = useAppStore((s) => s.setBridgeRuntime);
  const pushToast = useAppStore((s) => s.pushToast);
  const bridgeRt = useAppStore((s) => s.bridge);

  const [deviceTab, setDeviceTab] = useState<DeviceTab>("web");
  const [visitedDeviceTabs, setVisitedDeviceTabs] = useState(
    () => new Set<DeviceTab>(["web"])
  );
  const selectDeviceTab = (tab: DeviceTab) => {
    setVisitedDeviceTabs((current) => {
      if (current.has(tab)) return current;
      return new Set(current).add(tab);
    });
    setDeviceTab(tab);
  };
  const [adb, setAdb] = useState(() => t("phonesBridge.adbNotScanned"));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return;
    const onPointer = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-account-slot-menu]")) return;
      setMenuId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuId(null);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  const applyStatus = (s: BridgeStatus) => {
    if (s && "mock" in s && s.mock) {
      setBridgeRuntime({
        connected: false,
        tauriUnavailable: true,
        host: bridgeHost,
        port: bridgePort,
        lastError: null,
      });
      return;
    }
    setBridgeRuntime({
      connected: !!s.connected,
      host: s.host || bridgeHost,
      port: s.port || bridgePort,
      deviceName: s.devices?.[0]?.name ?? null,
      transport: s.devices?.[0]?.transport ?? null,
      lastError: s.last_error ?? null,
      tauriUnavailable: false,
    });
  };

  const scanAdb = async () => {
    setAdb(t("phonesBridge.scanning"));
    try {
      const res = await bridgeInvoke<unknown>("list_adb_devices");
      setAdb(JSON.stringify(res, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAdb(msg);
      pushToast(msg, "error");
    }
  };

  const doConnect = async () => {
    if (busy) return;
    if (!bridgeToken.trim()) {
      const message = t("phonesBridge.tokenRequired");
      setLog(message);
      pushToast(message, "error");
      return;
    }
    setBusy(true);
    setLog(t("phonesBridge.connectingLog", { host: bridgeHost, port: bridgePort }));
    const started = Date.now();
    try {
      const s = await Promise.race([
        connectBridge(bridgeHost, bridgePort, bridgeToken),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () =>
              reject(
                new Error(
                  t("phonesBridge.timeout")
                )
              ),
            12_000
          )
        ),
      ]);
      applyStatus(s);
      const ms = Date.now() - started;
      if (s.connected) {
        const name = s.devices?.[0]?.name;
        setLog(
          t("phonesBridge.connectedLog", { host: s.host, port: s.port, name: name ? ` · ${name}` : "", ms })
        );
        pushToast(t("phonesBridge.connectedToast"), "success");
        updateSettings({ sendChannel: "android_bridge" });
      } else if (s.mock) {
        setLog(t("phonesBridge.browserPreview"));
        pushToast(t("phonesBridge.desktopRequired"), "info");
      } else {
        const err = s.last_error || t("phonesBridge.connectFailed");
        setLog(err);
        pushToast(err, "error");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLog(msg);
      setBridgeRuntime({
        connected: false,
        lastError: msg,
        host: bridgeHost,
        port: bridgePort,
      });
      pushToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const doDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setLog(t("phonesBridge.disconnecting"));
    try {
      await disconnectBridge();
      applyStatus(await getBridgeStatus());
      setLog(t("phonesBridge.disconnected"));
      pushToast(t("phonesBridge.disconnectedToast"), "info");
      updateSettings({ sendChannel: "baileys" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLog(msg);
      pushToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const doForward = async () => {
    if (busy) return;
    setBusy(true);
    setLog(t("phonesBridge.forwarding", { port: bridgePort }));
    try {
      const msg = String(await adbForward(bridgePort));
      setLog(msg);
      pushToast(t("phonesBridge.forwarded"), "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLog(msg);
      pushToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const connected = bridgeRt.connected;
  const baileysOk = baileysUi.connection === "connected";
  const liveId = liveBaileysAccountId || "";

  const phones = useMemo(() => dedupePhones(phonesRaw), [phonesRaw]);
  const androidPhones = useMemo(
    () => phones.filter(isAndroidBridgePhone),
    [phones]
  );

  // 启动时清掉历史堆出来的多张 Baileys 假设备
  useEffect(() => {
    if (phonesRaw.length === phones.length) {
      const same = phonesRaw.every((p, i) => p.id === phones[i]?.id);
      if (same) return;
    }
    useAppStore.setState({ phones });
  }, [phones, phonesRaw]);

  const accounts = useMemo(
    () =>
      ensureAccounts(
        pruneGhostDefaultAccounts(waAccounts || [], {
          preferKeepId: liveId || undefined,
        })
      ),
    [waAccounts, liveId]
  );
  const baseLimits = useMemo(
    () => ({
      ...DEFAULT_RATE_LIMITS,
      perPhonePerHour: ratePerHour,
      perPhonePerMinute: ratePerMinute,
      minIntervalSec: rateMinIntervalSec,
    }),
    [ratePerHour, ratePerMinute, rateMinIntervalSec]
  );

  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const persistOrder = (orderedIds: string[], renumber = true) => {
    const next = reorderAccountSorts(accounts, orderedIds, renumber);
    updateSettings({ waAccounts: next });
  };

  const onDropReorder = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const ids = accounts.map((a) => a.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    persistOrder(next, true);
    setDragId(null);
  };

  const addAccountSlot = () => {
    if (accounts.length >= 5) {
      pushToast(t("phones.accountLimit", { count: 5 }), "info");
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
    // 不要抢当前 live：已登录号卡片应保持完整（同步/重连），新槽只多一张待登录小卡
    const keepLive =
      liveBaileysAccountId ||
      (baileysOk ? liveId : "") ||
      "";
    const keepDefault = accounts.some((a) => a.id === activeAccountId);
    updateSettings({
      waAccounts: [...accounts, slot],
      activeAccountId: keepDefault ? activeAccountId : id,
      // 仅在完全没有 live 时才把新槽设为 live
      ...(keepLive ? {} : { liveBaileysAccountId: id }),
      accountViewMode: { type: "account", accountId: id },
    });
    pushToast(
      keepLive
        ? t("phones.accountAddedKeepConnection", { label: slot.label })
        : t("phones.accountCreated", { label: slot.label }),
      "info"
    );
  };

  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const retireAccountMessaging = useAppStore((s) => s.retireAccountMessaging);

  const removeAccount = async (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    const label = formatAccountDisplay({
      label: acc.label,
      userName: acc.userName,
    });
    const isLast = accounts.length <= 1;
    const ok = await requestConfirm({
      title: t(isLast ? "phones.removeLastTitle" : "phones.removeTitle", { label }),
      description: isLast
        ? t("phones.removeLastDescription")
        : t("phones.removeDescription"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      // 删除任何槽位都先停掉对应进程，不能只处理当前 live 账号。
      await baileysStopAccount(id);
    } catch (e) {
      pushToast(
        t("phones.removeError", {
          error: e instanceof Error ? e.message : String(e),
        }),
        "error"
      );
      return;
    }
    retireAccountMessaging(id);
    const remaining = accounts.filter((a) => a.id !== id);
    const next = remaining.length
      ? reorderAccountSorts(
          remaining,
          remaining.map((a) => a.id),
          true
        )
      : [];
    const fallback = next[0]?.id || "";
    if (!fallback) {
      // 删除最后一个账号后清掉旧的全局在线状态，避免账号切换器自动把它重新收养回来。
      setBaileysUi({ connection: "disconnected", userName: null, hasQr: false });
    }
    updateSettings({
      waAccounts: next,
      activeAccountId:
        !fallback || activeAccountId === id
          ? fallback
          : activeAccountId,
      liveBaileysAccountId:
        !fallback || liveBaileysAccountId === id
          ? fallback
          : liveBaileysAccountId,
      accountViewMode: fallback
        ? accountViewMode?.type === "account" &&
          accountViewMode.accountId === id
          ? { type: "account", accountId: fallback }
          : accountViewMode
        : { type: "all" },
      sendPausedAccountIds: (sendPausedAccountIds || []).filter(
        (accountId) => accountId !== id
      ),
      blocklistByAccountId: Object.fromEntries(
        Object.entries(blocklistByAccountId || {}).filter(([accountId]) => accountId !== id)
      ),
      historySyncNoteByAccountId: Object.fromEntries(
        Object.entries(historySyncNoteByAccountId || {}).filter(([accountId]) => accountId !== id)
      ),
      personPrimaryAccountByKey: Object.fromEntries(
        Object.entries(personPrimaryAccountByKey || {}).filter(([, accountId]) => accountId !== id)
      ),
    });
    pushToast(
      t(isLast ? "phones.accountListCleared" : "phones.accountRemoved"),
      "info"
    );
  };

  const commitRename = (id: string) => {
    const name = editDraft.trim().slice(0, 40);
    setEditingId(null);
    if (!name) return;
    updateSettings({
      waAccounts: accounts.map((a) =>
        a.id === id
          ? { ...a, label: name, updatedAt: new Date().toISOString() }
          : a
      ),
    });
  };

  /** 默认发送：无会话归属时的后备号；「全部」顶栏展示的默认身份 */
  const setDefaultSendAccount = (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    updateSettings({
      activeAccountId: id,
      // 不强制改浏览范围，用户可继续停在「全部」
    });
    const idx =
      Math.max(
        0,
        accounts.findIndex((a) => a.id === id)
      ) + 1 || 1;
    pushToast(
      t("phones.defaultSet", {
        account: formatAccountDisplay({
          label: acc?.label,
          userName: acc?.userName,
          index1: idx,
        }),
      }),
      "success"
    );
  };

  const toggleWarmupExempt = async (id: string) => {
    const account = accounts.find((a) => a.id === id);
    if (!account) return;
    const nextValue = !account.warmupExempt;
    if (nextValue) {
      const ok = await requestConfirm({
        title: t("phones.markMatureTitle", { label: account.label }),
        description: t("phones.markMatureDescription"),
        confirmLabel: t("phones.markMature"),
        cancelLabel: t("common.cancel"),
        tone: "danger",
      });
      if (!ok) return;
    }
    updateSettings({
      waAccounts: accounts.map((a) =>
        a.id === id
          ? {
              ...a,
              warmupExempt: nextValue,
              updatedAt: new Date().toISOString(),
            }
          : a
      ),
    });
    pushToast(
      nextValue ? t("phones.matureMarked") : t("phones.protectionRestored"),
      nextValue ? "success" : "info"
    );
  };

  const accountStatusText = (id: string) => {
    const connection = resolveWaAccountConnection(
      accounts,
      id,
      liveId,
      baileysUi.connection
    );
    if (connection === "connected") return "connected";
    if (
      connection === "connecting" ||
      connection === "reconnecting" ||
      connection === "starting" ||
      connection === "close"
    )
      return "reconnecting";
    if (connection === "qr" || (id === liveId && baileysUi.hasQr))
      return "qr";
    if (connection === "error") return "error";
    return "loggedOut";
  };

  /**
   * 为某槽扫码/接管连接：
   * - 不踢其它已在线号（多进程并行）
   * - 仅把 live/active 指到此槽，便于顶栏与默认发送身份
   */
  const beginLoginOnSlot = (id: string) => {
    const nextAccounts = accounts.map((a) =>
      a.id === id
        ? {
            ...a,
            status:
              a.status === "connected"
                ? ("connected" as const)
                : ("qr" as const),
            // 未真正连上前不要挂着上一号的推送名
            userName:
              a.status === "connected" ? a.userName : undefined,
            updatedAt: new Date().toISOString(),
          }
        : a
    );
    updateSettings({
      waAccounts: nextAccounts,
      liveBaileysAccountId: id,
      accountViewMode: { type: "account", accountId: id },
    });
    const othersOnline = accounts.filter(
      (a) => a.id !== id && a.status === "connected"
    ).length;
    pushToast(
      othersOnline > 0
        ? t("phones.connectingKeepOthers")
        : t("phones.preparingConnection"),
      "info"
    );
  };

  const androidOnline =
    androidPhones.some((p) => p.online) || connected;
  const accountName = (id: string) => {
    const index = accounts.findIndex((a) => a.id === id);
    const account = accounts[index];
    return account
      ? formatAccountDisplay({
          label: account.label,
          userName: account.userName,
          index1: index + 1,
        })
      : t("phones.unset");
  };
  const browsingLabel =
    accountViewMode?.type === "all"
      ? t("phones.allAccounts")
      : accountName(accountViewMode.accountId);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-950">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/90 px-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("phones.pageTitle")}</div>
          <div className="truncate text-2xs text-zinc-500">
            {deviceTab === "web"
              ? t("phones.webHint")
              : t("phones.androidHint")}
            {!isTauri() && ` · ${t("phonesBridge.desktopRequiredShort")}`}
          </div>
        </div>
        {deviceTab === "web" ? (
          <Badge
            tone={
              accounts.some((a) =>
                isWaAccountConnected(
                  accounts,
                  a.id,
                  liveId,
                  baileysUi.connection
                )
              ) ||
              (!accounts.length && baileysOk)
                ? "brand"
                : "muted"
            }
          >
            {(() => {
              const onlineN = accounts.filter(
                (a) =>
                  isWaAccountConnected(
                    accounts,
                    a.id,
                    liveId,
                    baileysUi.connection
                  )
              ).length;
              const total = accounts.length;
              if (!total) {
                return baileysOk ? t("common.connected") : t("phonesBridge.noAccount");
              }
              if (onlineN > 0) {
                return total === 1
                  ? t("phonesBridge.oneAccountOnline")
                  : t("phonesBridge.accountsOnline", { online: onlineN, total });
              }
              if (accounts.some((a) => a.status === "qr" || a.status === "connecting")) {
                return t("phonesBridge.waitingLogin");
              }
              return t("phonesBridge.allOffline", { total });
            })()}
          </Badge>
        ) : (
          <Badge tone={androidOnline ? "brand" : "muted"}>
            {androidOnline
              ? bridgeRt.deviceName || t("phonesBridge.deviceConnected")
              : t("phonesBridge.deviceDisconnected")}
          </Badge>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        {sendChannel === "android_bridge" && deviceTab === "web" && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/85">
            {t("phonesBridge.channelWarning")}
            <button
              type="button"
              className="ml-1 text-brand hover:underline"
              onClick={() => updateSettings({ sendChannel: "baileys" })}
            >
              {t("phonesBridge.switchToQr")}
            </button>
          </div>
        )}

        {/* 二级：主路径扫码 · 真机为备用 */}
        <div
          className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/50 p-1"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={deviceTab === "web"}
            onClick={() => selectDeviceTab("web")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              deviceTab === "web"
                ? "bg-zinc-800 text-zinc-50 shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <QrCode className="h-3.5 w-3.5" />
            {t("phones.webScan")}
            {(accounts.some((account) =>
              isWaAccountConnected(
                accounts,
                account.id,
                liveId,
                baileysUi.connection
              )
            ) || (!accounts.length && baileysOk)) && (
              <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-brand" />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deviceTab === "android"}
            onClick={() => selectDeviceTab("android")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              deviceTab === "android"
                ? "bg-zinc-800 text-zinc-50 shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <Smartphone className="h-3.5 w-3.5" />
            {t("phones.android")}
            {androidOnline && (
              <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-brand" />
            )}
          </button>
        </div>

        {(visitedDeviceTabs.has("web") || deviceTab === "web") && (
          <div hidden={deviceTab !== "web"} className="space-y-4">
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold text-zinc-100">
                  {t("phones.whatsappAccounts")}
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-600">
                  {t("phones.webAccountsHint")}
                </p>
              </div>
              <Button
                variant="secondary"
                className="!min-h-8 gap-1 !px-2.5 text-2xs"
                onClick={addAccountSlot}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("phones.addAccount")}
              </Button>
            </div>

            {accounts.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <AccountRole
                  label={t("phones.defaultSend")}
                  value={accountName(activeAccountId)}
                  note={t("phones.defaultSendNote")}
                />
                <AccountRole
                  label={t("phones.currentView")}
                  value={browsingLabel}
                  note={t("phones.currentViewNote")}
                />
                <AccountRole
                  label={t("phones.connectionManagement")}
                  value={accountName(liveId)}
                  note={t("phones.connectionManagementNote")}
                />
              </div>
            )}

            {accounts.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-4 py-6 text-center">
                  <p className="text-[13px] font-medium text-zinc-300">
                    {t("phones.noAccountSlots")}
                  </p>
                  <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-zinc-600">
                    {t("phones.noAccountSlotsHint")}
                  </p>
                </div>
                <BaileysConnectCard />
              </div>
            ) : (
              <div className="grid gap-3">
                {accounts.map((a, idx) => {
                  const isConnectionFocus = a.id === liveId;
                  const isDefaultSend = a.id === activeAccountId;
                  const isViewing =
                    accountViewMode?.type === "account" &&
                    accountViewMode.accountId === a.id;
                  const st = accountStatusText(a.id);
                  const online = st === "connected";
                  // 仅本槽已连接才显示推送名；待扫码绝不用 live 槽 baileysUi.userName
                  const name = online
                    ? a.userName ||
                      (isConnectionFocus ? baileysUi.userName : null) ||
                      null
                    : null;
                  const title = formatAccountDisplay({
                    label: a.label,
                    userName: name,
                    index1: idx + 1,
                  });
                  const warmup = applyAccountWarmup(
                    baseLimits,
                    a.warmupExempt ? undefined : a.createdAt
                  );
                  const needsLogin = st === "loggedOut" || st === "error";
                  return (
                    <AccountSlotCard
                      key={a.id}
                      account={a}
                      idx={idx}
                      isDefaultSend={isDefaultSend}
                      isConnectionFocus={isConnectionFocus}
                      isViewing={isViewing}
                      liveUserName={
                        isConnectionFocus ? baileysUi.userName ?? null : null
                      }
                      statusText={st}
                      online={online}
                      title={title}
                      warmupActive={warmup.active}
                      panelOpen
                      needsLogin={needsLogin}
                      dragActive={dragId === a.id}
                      editing={editingId === a.id}
                      editDraft={editDraft}
                      menuOpen={menuId === a.id}
                      onEditDraftChange={setEditDraft}
                      onDragStart={() => setDragId(a.id)}
                      onDragEnd={() => setDragId(null)}
                      onDrop={() => onDropReorder(a.id)}
                      onStartEdit={() => {
                        setMenuId(null);
                        setEditingId(a.id);
                        setEditDraft(a.label);
                      }}
                      onCommitRename={() => commitRename(a.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onToggleMenu={() =>
                        setMenuId((id) => (id === a.id ? null : a.id))
                      }
                      onCloseMenu={() => setMenuId(null)}
                      onSetDefault={() => setDefaultSendAccount(a.id)}
                      onToggleWarmupExempt={() =>
                        void toggleWarmupExempt(a.id)
                      }
                      onRemove={() => void removeAccount(a.id)}
                      onLogin={() => beginLoginOnSlot(a.id)}
                    />
                  );
                })}
              </div>
            )}
          </>
          </div>
        )}
        {(visitedDeviceTabs.has("android") || deviceTab === "android") && (
          <div hidden={deviceTab !== "android"} className="space-y-4">
            <div>
              <div className="text-[13px] font-semibold text-zinc-100">{t("phonesBridge.title")}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">
                {t("phonesBridge.description")}
              </p>
              <button
                type="button"
                className="mt-1 text-[11px] text-brand hover:underline"
                onClick={() => {
                  /* navigate via store — setActiveNav not in scope; use window hash-free */
                  useAppStore.getState().setActiveNav("monitor");
                }}
              >
                {t("phonesBridge.monitorLink")}
              </button>
            </div>

            {androidPhones.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {androidPhones.map((p) => {
                  const bound = contacts.filter(
                    (c) => c.boundPhoneId === p.id
                  ).length;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPhone(p.id)}
                      className={cn(
                        "rounded-2xl border p-3.5 text-left transition-colors",
                        selectedPhoneId === p.id
                          ? "border-brand/40 bg-brand/10"
                          : "border-zinc-800/90 bg-zinc-900/50 hover:border-zinc-700"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300">
                            <Smartphone className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold">
                              {p.name}
                            </div>
                            <div className="mt-0.5 text-2xs text-zinc-500">
                              {p.model}
                            </div>
                          </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-2xs text-zinc-500">
                          <OnlineDot online={p.online} />
                          {p.online ? t("phonesBridge.online") : t("phonesBridge.offline")}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                        <div className="rounded-lg bg-zinc-950/60 px-1 py-1.5">
                          <div className="text-2xs text-zinc-600">{t("phonesBridge.battery")}</div>
                          <div className="mt-0.5 text-[12px] tabular-nums text-zinc-200">
                            {p.battery}%
                          </div>
                        </div>
                        <div className="rounded-lg bg-zinc-950/60 px-1 py-1.5">
                          <div className="text-2xs text-zinc-600">{t("phonesBridge.bound")}</div>
                          <div className="mt-0.5 text-[12px] tabular-nums text-zinc-200">
                            {bound}
                          </div>
                        </div>
                        <div className="rounded-lg bg-zinc-950/60 px-1 py-1.5">
                          <div className="text-2xs text-zinc-600">WA</div>
                          <div className="mt-0.5 text-[12px] text-zinc-200">
                            {p.whatsappInstalled ? t("phonesBridge.yes") : t("phonesBridge.no")}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-2xs text-zinc-600">
                        {t("phonesBridge.accessibility", { state: p.accessibilityEnabled ? t("phonesBridge.on") : t("phonesBridge.off") })}
                        {" · "}{t("phonesBridge.overlay", { state: p.overlayEnabled ? t("phonesBridge.on") : t("phonesBridge.off") })}
                        {p.charging ? ` · ${t("phonesBridge.charging")}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-4 py-8 text-center">
                <Smartphone className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-2 text-[12px] text-zinc-400">
                  {t("phonesBridge.noDevices")}
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  {t("phonesBridge.noDevicesHint")}
                </p>
              </div>
            )}

            <AndroidBridgePanel
              host={bridgeHost}
              port={bridgePort}
              lastError={bridgeRt.lastError}
              busy={busy}
              connected={connected}
              log={log}
              adb={adb}
              onHostChange={(v) => updateSettings({ bridgeHost: v })}
              onPortChange={(v) =>
                updateSettings({ bridgePort: v })
              }
              onConnect={() => void doConnect()}
              onDisconnect={() => void doDisconnect()}
              onScanAdb={() => void scanAdb()}
              onForward={() => void doForward()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function AccountRole({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800/90 bg-zinc-900/35 px-3 py-2.5">
      <div className="text-2xs text-zinc-600">{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-medium text-zinc-200">
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-zinc-600">{note}</div>
    </div>
  );
}
