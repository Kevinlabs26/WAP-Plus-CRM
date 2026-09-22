import { useEffect, useRef, useState } from "react";
import {
  baileysLogout,
  baileysPairingCode,
  baileysRestart,
  baileysStatus,
  baileysSync,
  baileysUpdateProfile,
  type BaileysStatus,
} from "@/lib/baileys";
import { isTauri } from "@/lib/bridge";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";
import { cn, displayPhone } from "@/lib/utils";
import {
  extractAccountHumanName,
} from "@/lib/accountLabels";
import { useI18n, type TranslationKey } from "@/i18n";
import { BaileysPrivacyPanel } from "./BaileysPrivacyPanel";

type Props = {
  className?: string;
  /** 打开时若无码自动 restart（弹窗用） */
  autoStart?: boolean;
  /** 更紧凑的说明文案 */
  compact?: boolean;
  /**
   * embedded：嵌在账号卡内，已连接时只渲染操作区（不再重复头像/名字）。
   * full：完整卡片（默认，弹窗/独立区用）。
   */
  variant?: "full" | "embedded";
  /** 绑定到指定账号槽（多号同时在线时必传） */
  accountId?: string | null;
};

function statusHint(status: BaileysStatus | undefined, t: (key: TranslationKey, params?: Record<string, string | number>) => string, error?: string) {
  if (error) return error;
  if (!status) return t("baileysConnect.connectingBackend");
  if (status.qrDataUrl) return "";
  if (status.connection === "connected") return "";
  if (status.connection === "qr") return t("baileysConnect.waitingQr");
  if (status.connection === "starting") return t("baileysConnect.startingSession");
  if (status.connection === "reconnecting") {
    const n = status.reconnectAttempts ?? 0;
    if (status.lastError) {
      return t("baileysConnect.interrupted", { error: status.lastError });
    }
    if (n >= 5) {
      return t("baileysConnect.retriesFailed", { count: n });
    }
    return t("baileysConnect.restoringSession");
  }
  if (status.connection === "logged_out")
    return t("baileysConnect.loggedOutPreparing");
  if (status.connection === "error")
    return status.lastError || t("baileysConnect.errorQr");
  return status.lastError || t("baileysConnect.waitingQrShort");
}

export function BaileysConnectCard({
  className = "",
  autoStart = false,
  compact = false,
  variant = "full",
  accountId: accountIdProp = null,
}: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BaileysStatus>();
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<"qr" | "sync" | "reconnect" | "logout" | "profile" | "pairing" | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date>();
  const tauri = isTauri();
  const setBaileysUi = useAppStore((s) => s.setBaileysUi);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const ingestBridgeEvents = useAppStore((s) => s.ingestBridgeEvents);
  const pushToast = useAppStore((s) => s.pushToast);
  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const fallbackSlotId = useAppStore(
    (s) => s.settings.liveBaileysAccountId || s.settings.activeAccountId
  );
  const slotAccountId = accountIdProp || fallbackSlotId;
  const popupAutoStartKey = `wap-baileys-popup-autostart:${slotAccountId || "default"}`;
  const busy = busyAction !== null;
  const statusUserId = status?.user?.id || "";
  const accountPhone = displayPhone(`+${statusUserId.split(":")[0].split("@")[0] || ""}`);

  const applyStatus = (next: BaileysStatus) => {
    const slotStatus =
      next.connection === "connected"
        ? "connected"
        : next.connection === "starting" || next.connection === "reconnecting"
          ? "connecting"
          : next.connection === "qr"
            ? "qr"
            : next.connection === "error"
              ? "error"
              : "disconnected";
    if (slotAccountId) {
      const settings = useAppStore.getState().settings;
      const accounts = settings.waAccounts || [];
      const index = accounts.findIndex((account) => account.id === slotAccountId);
      if (index >= 0 && accounts[index]?.status !== slotStatus) {
        updateSettings({
          waAccounts: accounts.map((account, accountIndex) =>
            accountIndex === index
              ? { ...account, status: slotStatus, updatedAt: new Date().toISOString() }
              : account
          ),
        });
      }
    }
    // 状态未变则跳过 setState，多卡轮询时少触发 React 重渲染
    setStatus((prev) => {
      if (
        prev &&
        prev.connection === next.connection &&
        prev.qrDataUrl === next.qrDataUrl &&
        prev.lastError === next.lastError &&
        (prev.user?.id || "") === (next.user?.id || "") &&
        (prev.user?.name || "") === (next.user?.name || "") &&
        (prev.reconnectAttempts ?? 0) === (next.reconnectAttempts ?? 0)
      ) {
        return prev;
      }
      return next;
    });
    // 仅「当前浏览/直播槽」回写全局 baileysUi，避免多号互相抢顶栏
    const live =
      useAppStore.getState().settings.liveBaileysAccountId ||
      useAppStore.getState().settings.activeAccountId;
    if (next.connection === "connected" && slotAccountId === live) {
      const ui = useAppStore.getState().baileysUi;
      const statusPhoneE164 =
        typeof next.user?.id === "string"
          ? (() => {
              const digits = next.user.id.split("@")[0]?.split(":")[0] || "";
              return /^\d{7,15}$/u.test(digits) ? `+${digits}` : "";
            })()
          : "";
      const name =
        extractAccountHumanName(next.user?.name) ||
        extractAccountHumanName(next.user?.notify) ||
        extractAccountHumanName(next.user?.verifiedName) ||
        statusPhoneE164 ||
        null;
      if (ui.connection !== "connected" || ui.userName !== name || ui.hasQr) {
        setBaileysUi({
          connection: "connected",
          userName: name,
          hasQr: false,
        });
      }
    }
    if (next.qrDataUrl) {
      setError("");
      setHint("");
      return;
    }
    if (next.connection === "connected") {
      setError("");
      setHint("");
      return;
    }
    if (next.lastError && next.connection !== "starting") {
      setError("");
      setHint(statusHint(next, t));
    } else {
      setHint(statusHint(next, t));
    }
  };

  const pollOnce = async () => {
    if (!tauri) {
      setError(t("baileysConnect.desktopRequired"));
      return;
    }
    const next = await baileysStatus(slotAccountId);
    applyStatus(next);
  };

  const requestNewQr = async () => {
    if (!tauri) {
      setError(t("baileysConnect.desktopRequiredShort"));
      return;
    }
    setBusyAction("qr");
    setHint(t("baileysConnect.generatingNewQr"));
    setError("");
    setStatus((s) =>
      s
        ? { ...s, qrDataUrl: undefined, connection: "starting", lastError: "" }
        : s
    );
    try {
      await baileysRestart(true, slotAccountId);
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await new Promise((r) => window.setTimeout(r, 800));
        const next = await baileysStatus(slotAccountId);
        applyStatus(next);
        if (next.qrDataUrl || next.connection === "connected") break;
      }
      const final = await baileysStatus(slotAccountId);
      applyStatus(final);
      if (!final.qrDataUrl && final.connection !== "connected") {
        setHint(
          final.lastError
            ? t("baileysConnect.noQrError", { error: final.lastError })
            : t("baileysConnect.noQr")
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  };

  const requestPairing = async () => {
    if (!tauri) {
      setError("配对码只能在桌面端使用");
      return;
    }
    setBusyAction("pairing");
    setError("");
    try {
      const result = await baileysPairingCode(pairingPhone, slotAccountId);
      setPairingCode(result.code);
      setHint("请在手机 WhatsApp：设置 → 已连接的设备 → 连接设备 → 使用电话号码连接中输入此配对码");
    } catch (reason) {
      setPairingCode("");
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  };

  const syncNow = async () => {
    setBusyAction("sync");
    try {
      const aid = slotAccountId || "wa-default";
      const result = await baileysSync(aid, {
        hydrateGroups: true,
        requestHistory: true,
      });
      ingestBridgeEvents([
        {
          type: "contacts.sync",
          deviceId: aid,
          payload: {
            items: result.contacts,
            source: "snapshot",
            accountId: aid,
          } as Record<string, unknown>,
        },
        {
          type: "messages.sync",
          deviceId: aid,
          payload: {
            items: result.messages,
            source: "snapshot",
            live: false,
            accountId: aid,
          } as Record<string, unknown>,
        },
      ] as Parameters<typeof ingestBridgeEvents>[0]);
      setLastSyncedAt(new Date());
      pushToast(
        result.historyRequest?.requested
          ? t("baileysConnect.historySyncStarted", { count: result.messages.length })
          : t("baileysConnect.syncDone", { contacts: result.contacts.length, messages: result.messages.length }),
        result.historyRequest?.requested ? "info" : "success"
      );
    } catch (reason) {
      pushToast(reason instanceof Error ? reason.message : String(reason), "error");
    } finally {
      setBusyAction(null);
    }
  };

  const reconnect = async () => {
    setBusyAction("reconnect");
    try {
      setHint(t("baileysConnect.safeReconnectHint"));
      await baileysRestart(false, slotAccountId);
      await pollOnce();
      pushToast(t("baileysConnect.reconnectingToast"), "info");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    // 账号列表为空时不要自动查询默认 runtime；否则删除最后一个账号后会重新启动旧会话。
    // 用户主动点击「获取二维码」仍会走 requestNewQr，允许创建新账号。
    if (!slotAccountId && !autoStart) return;
    let cancelled = false;
    const tick = async () => {
      if (!tauri) {
        if (!cancelled) {
          setError(
            t("baileysConnect.desktopRequired")
          );
        }
        return;
      }
      try {
        const next = await baileysStatus(slotAccountId);
        if (!cancelled) applyStatus(next);
      } catch (reason) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void tick();
    // 设备页多卡同时挂载时，状态轮询再放慢；详情靠 Watcher + 手动刷新
    const id = window.setInterval(
      () => void tick(),
      document.hidden ? 12_000 : 6000
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, slotAccountId]);

  // 弹窗/连接页：仅「确实没会话」时要码；已连接/重连中绝不 clearAuth
  useEffect(() => {
    if (!autoStart || !tauri || busy) return;
    let cancelled = false;
    (async () => {
      try {
        const cur = await baileysStatus(slotAccountId);
        if (cancelled) return;
        applyStatus(cur);
        if (cur.connection === "connected") return;
        // 重连中：等 bridge 自己恢复，不要 restart 清掉登录
        if (
          cur.connection === "reconnecting" ||
          cur.connection === "starting"
        ) {
          return;
        }
        if (cur.qrDataUrl) return;
        // 仅 logged_out / error / 无码 qr 时出新码
        if (
          cur.connection === "logged_out" ||
          cur.connection === "error" ||
          cur.connection === "qr" ||
          !cur.connection
        ) {
          if (sessionStorage.getItem(popupAutoStartKey) === "1") return;
          sessionStorage.setItem(popupAutoStartKey, "1");
          await requestNewQr();
        }
      } catch {
        /* Watcher 会提示 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, tauri]);

  // 禁止：状态一变就 baileysRestart(true) —— 会把已登录会话清掉并导致顶栏闪烁

  const connectedUi = status?.connection === "connected";
  const embedded = variant === "embedded";

  const doLogout = () =>
    void (async () => {
      const ok = await requestConfirm({
        title: t("baileysConnect.logoutTitle"),
        description: t("baileysConnect.logoutDescription"),
        confirmLabel: t("baileysConnect.logout"),
        cancelLabel: t("common.cancel"),
        tone: "danger",
      });
      if (!ok) return;
      setBusyAction("logout");
      try {
        await baileysLogout(slotAccountId);
        sessionStorage.removeItem("wap-baileys-auto-restart");
        sessionStorage.removeItem(popupAutoStartKey);
        await pollOnce();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusyAction(null);
      }
    })();

  const handleSaveProfile = async (patch: {
    name?: string;
    status?: string;
    avatarDataUrl?: string;
  }) => {
    setBusyAction("profile");
    try {
      const res = await baileysUpdateProfile(patch, slotAccountId);
      pushToast(
        res.name
          ? t("baileysConnect.nameUpdated")
          : res.status
            ? t("baileysConnect.statusUpdated")
            : res.avatar
              ? t("baileysConnect.avatarUpdated")
              : t("baileysConnect.profileUpdated"),
        "success"
      );
      setProfileOpen(false);
      await pollOnce();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      pushToast(
        reason instanceof Error ? reason.message : t("baileysConnect.profileUpdateFailed"),
        "error"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const actionRow = (
    <div
      className={cn(
        "grid w-full grid-cols-4 gap-2",
        !embedded && "shrink-0"
      )}
    >
      <Button
        variant="secondary"
        size={embedded ? "sm" : "md"}
        className={cn(
          "min-w-0 w-full justify-center text-2xs",
          !embedded && "text-[12px]"
        )}
        disabled={busy}
        onClick={() => setProfileOpen(true)}
      >
        {busyAction === "profile" ? (embedded ? t("common.saving") : "…") : t("baileysConnect.profile")}
      </Button>
      <Button
        variant="secondary"
        size={embedded ? "sm" : "md"}
        className={cn(
          "min-w-0 w-full justify-center text-2xs",
          !embedded && "text-[12px]"
        )}
        disabled={busy}
        onClick={() => void syncNow()}
      >
        {busyAction === "sync" ? (embedded ? t("common.syncing") : "…") : t("common.sync")}
      </Button>
      <Button
        variant="secondary"
        size={embedded ? "sm" : "md"}
        className={cn(
          "min-w-0 w-full justify-center text-2xs",
          !embedded && "text-[12px]"
        )}
        disabled={busy}
        onClick={() => void reconnect()}
      >
        {busyAction === "reconnect" ? (embedded ? t("baileysConnect.reconnecting") : "…") : t("baileysConnect.reconnect")}
      </Button>
      <Button
        variant="secondary"
        size={embedded ? "sm" : "md"}
        className={cn(
          "min-w-0 w-full justify-center border-red-500/30 text-2xs text-red-300 hover:bg-red-500/10",
          !embedded && "text-[12px]"
        )}
        disabled={busy}
        onClick={doLogout}
      >
        {busyAction === "logout" ? (embedded ? t("baileysConnect.loggingOut") : "…") : t("baileysConnect.logoutShort")}
      </Button>
    </div>
  );

  const connectedActions = (
    <>
      {(accountPhone || statusUserId) && embedded && (
        <div className="mb-2 flex items-center gap-1.5 text-left text-2xs text-zinc-500">
          <span className="truncate">{accountPhone || statusUserId}</span>
          <button
            type="button"
            className="shrink-0 text-2xs text-zinc-600 hover:text-zinc-300"
            onClick={() =>
              void navigator.clipboard
                .writeText(accountPhone || statusUserId)
                .then(() => pushToast(t("baileysConnect.accountCopied"), "success"))
                .catch(() => pushToast(t("common.copyFailed"), "error"))
            }
          >
            {t("common.copy")}
          </button>
          <span className="text-zinc-600">·</span>
          <span className="truncate text-zinc-600">
            {lastSyncedAt
              ? t("baileysConnect.syncedAt", { time: lastSyncedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }) })
              : t("baileysConnect.autoSync")}
          </span>
        </div>
      )}

      {!embedded && (
        <div className="space-y-3 text-left">
          <div className="flex items-center gap-3">
            <Avatar
              name={status?.user?.name || status?.user?.notify || "WhatsApp"}
              seed={status?.user?.id || "whatsapp"}
              size="md"
              online
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-zinc-100">
                  {status?.user?.name ||
                    status?.user?.notify ||
                    t("baileysConnect.whatsappAccount")}
                </span>
                <span className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-2xs text-brand">
                  {t("common.connected")}
                </span>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-zinc-500">
                <span className="truncate">
                  {accountPhone || statusUserId || t("baileysConnect.loggedIn")}
                </span>
                {(accountPhone || statusUserId) && (
                  <button
                    type="button"
                    className="shrink-0 text-2xs text-zinc-600 hover:text-zinc-300"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(accountPhone || statusUserId)
                        .then(() => pushToast(t("baileysConnect.accountCopied"), "success"))
                        .catch(() => pushToast(t("common.copyFailed"), "error"))
                    }
                  >
                    {t("common.copy")}
                  </button>
                )}
                <span className="text-zinc-600">·</span>
                <span className="truncate text-zinc-600">
                  {lastSyncedAt
                    ? t("baileysConnect.syncedAt", { time: lastSyncedAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }) })
                    : t("baileysConnect.autoSync")}
                </span>
              </div>
            </div>
          </div>
          {actionRow}
        </div>
      )}

      {embedded && actionRow}

      {status?.lastError && (
        <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-left text-2xs text-amber-200">
          {t("baileysConnect.lastError", { error: status.lastError })}
        </p>
      )}
    </>
  );

  const profileEditor = profileOpen ? (
    <ProfileEditModal
      name={status?.user?.name || ""}
      onClose={() => setProfileOpen(false)}
      busy={busyAction === "profile"}
      onSave={handleSaveProfile}
    />
  ) : null;

  // 嵌在账号卡：无外框，避免双重边框
  if (embedded) {
    if (connectedUi) {
      return (
        <div className={className}>
          {connectedActions}
          <BaileysPrivacyPanel accountId={slotAccountId} />
          {profileEditor}
        </div>
      );
    }
    // 未连接：紧凑扫码区
    return (
      <div className={className}>
        {status?.qrDataUrl ? (
          <div className="text-center">
            <img
              src={status.qrDataUrl}
              alt={t("baileysConnect.qrAlt")}
              className="mx-auto h-44 w-44 rounded bg-white p-2"
            />
            <Button
              variant="secondary"
              size="sm" className="mt-2 text-2xs"
              disabled={busy || !tauri}
              onClick={() => {
                sessionStorage.removeItem("wap-baileys-auto-restart");
                sessionStorage.removeItem(popupAutoStartKey);
                void requestNewQr();
              }}
            >
              {busyAction === "qr" ? t("baileysConnect.generating") : t("baileysConnect.refreshQr")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 py-2 text-center">
            <p className="text-[11px] leading-relaxed text-zinc-400">
              {busy
                ? busyAction === "reconnect"
                  ? t("baileysConnect.safeReconnecting")
                  : t("baileysConnect.generating")
                : error || hint || t("baileysConnect.waitingQrShort")}
            </p>
            {(status?.connection === "reconnecting" ||
              status?.connection === "starting") && (
              <Button
                variant="secondary"
                size="sm" className="w-full text-2xs"
                disabled={busy || !tauri}
                onClick={() => void reconnect()}
              >
                {busyAction === "reconnect" ? t("baileysConnect.reconnecting") : t("baileysConnect.safeReconnect")}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm" className="w-full text-2xs"
              disabled={busy || !tauri}
              onClick={() => {
                sessionStorage.removeItem("wap-baileys-auto-restart");
                sessionStorage.removeItem(popupAutoStartKey);
                void requestNewQr();
              }}
            >
              {busyAction === "qr" ? t("baileysConnect.generating") : t("baileysConnect.getQr")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-center ${className}`}
    >
      {/* 已连接时不显示大标题，省纵向空间；未登录才显示扫码说明 */}
      {!connectedUi && !compact && (
        <div className="mb-2 text-left">
          <div className="text-[12px] font-semibold text-zinc-200">
            {t("baileysConnect.qrLogin")}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            {t("baileysConnect.scanInstructions")}
          </p>
        </div>
      )}
      {!connectedUi && compact && (
        <p className="mb-2 text-left text-[11px] leading-relaxed text-zinc-500">
          {t("baileysConnect.scanInstructionsCompact")}
        </p>
      )}

      {connectedUi ? (
        <>
          {connectedActions}
          <BaileysPrivacyPanel accountId={slotAccountId} />
        </>
      ) : status?.qrDataUrl ? (
        <>
          <div className="mb-2 text-xs text-zinc-300">{t("baileysConnect.scanToConnect")}</div>
          <img
            src={status.qrDataUrl}
            alt={t("baileysConnect.qrAlt")}
            className="mx-auto h-52 w-52 rounded bg-white p-2"
          />
          <div className="mt-2 text-2xs text-zinc-600">
            {t("baileysConnect.status", { status: status.connection || "qr" })}
          </div>
          <Button
            variant="secondary"
            size="sm" className="mt-2 text-2xs"
            disabled={busy || !tauri}
            onClick={() => {
              sessionStorage.removeItem("wap-baileys-auto-restart");
              sessionStorage.removeItem(popupAutoStartKey);
              void requestNewQr();
            }}
          >
            {busyAction === "qr" ? t("baileysConnect.generating") : t("baileysConnect.refreshQr")}
          </Button>
          <div className="mt-3 border-t border-zinc-800 pt-3 text-left">
            <div className="mb-1 text-2xs text-zinc-500">也可以使用手机号配对（包含国家码）</div>
            <div className="flex gap-2">
              <input
                value={pairingPhone}
                onChange={(event) => setPairingPhone(event.target.value)}
                placeholder="例如 8613812345678"
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand"
                inputMode="tel"
              />
              <Button
                variant="secondary"
                size="sm"
                className="text-2xs"
                disabled={busy || !tauri || pairingPhone.replace(/\D/g, "").length < 7}
                onClick={() => void requestPairing()}
              >
                {busyAction === "pairing" ? "生成中…" : "获取配对码"}
              </Button>
            </div>
            {pairingCode && (
              <div className="mt-2 rounded bg-emerald-500/10 px-3 py-2 text-center text-lg font-semibold tracking-[0.25em] text-emerald-200">
                {pairingCode}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2 py-5">
          <div className="px-2 text-xs leading-relaxed text-zinc-400">
            {busy
              ? busyAction === "reconnect"
                ? t("baileysConnect.safeReconnecting")
                : t("baileysConnect.generatingNewQrWait")
              : error || hint || t("baileysConnect.startingWaitQr")}
          </div>
          {(status?.connection === "reconnecting" ||
            status?.connection === "starting") && (
            <Button
              variant="secondary"
              size="sm" className="text-2xs"
              disabled={busy || !tauri}
              onClick={() => void reconnect()}
            >
              {busyAction === "reconnect" ? t("baileysConnect.reconnecting") : t("baileysConnect.safeReconnectKeepLogin")}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm" className="text-2xs"
            disabled={busy || !tauri}
            onClick={() => {
              sessionStorage.removeItem("wap-baileys-auto-restart");
              sessionStorage.removeItem(popupAutoStartKey);
              void requestNewQr();
            }}
          >
            {busyAction === "qr" ? t("baileysConnect.generating") : t("baileysConnect.getNewQr")}
          </Button>
          <div className="mt-3 border-t border-zinc-800 pt-3 text-left">
            <div className="mb-1 text-2xs text-zinc-500">或使用手机号配对（需包含国家码）</div>
            <div className="flex gap-2">
              <input
                value={pairingPhone}
                onChange={(event) => setPairingPhone(event.target.value)}
                placeholder="例如 8613812345678"
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-brand"
                inputMode="tel"
              />
              <Button
                variant="secondary"
                size="sm"
                className="text-2xs"
                disabled={busy || !tauri || pairingPhone.replace(/\D/g, "").length < 7}
                onClick={() => void requestPairing()}
              >
                {busyAction === "pairing" ? "生成中…" : "获取配对码"}
              </Button>
            </div>
            {pairingCode && (
              <div className="mt-2 rounded bg-emerald-500/10 px-3 py-2 text-center text-lg font-semibold tracking-[0.25em] text-emerald-200">
                {pairingCode}
              </div>
            )}
          </div>
          {!compact && (
            <button
              type="button"
              className="block w-full text-2xs text-zinc-600 underline-offset-2 hover:text-zinc-400 hover:underline"
              disabled={busy}
              onClick={() => void pollOnce()}
            >
              {t("baileysConnect.refreshStatus")}
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-2xs text-zinc-600">
        {t("baileysConnect.unofficialWarning")}
      </p>

      {profileEditor}
    </div>
  );
}

function ProfileEditModal({
  name,
  onClose,
  busy,
  onSave,
}: {
  name: string;
  onClose: () => void;
  busy: boolean;
  onSave: (patch: {
    name?: string;
    status?: string;
    avatarDataUrl?: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(name);
  const [statusText, setStatusText] = useState("");
  const [avatar, setAvatar] = useState<{
    dataUrl: string;
    fileName: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[min(92vw,26rem)] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
          {t("baileysConnect.editProfile")}
        </div>
        <div className="space-y-3 px-4 py-4">
          <label className="block text-2xs text-zinc-500">
            {t("baileysConnect.nickname")}
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("baileysConnect.nicknamePlaceholder")}
              className="ui-control mt-1 w-full px-2.5 text-[13px]"
            />
          </label>
          <label className="block text-2xs text-zinc-500">
            {t("baileysConnect.about")}
            <input
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              placeholder={t("baileysConnect.aboutPlaceholder")}
              className="ui-control mt-1 w-full px-2.5 text-[13px]"
            />
          </label>
          <div>
            <span className="text-2xs text-zinc-500">{t("baileysConnect.avatarOptional")}</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () =>
                    setAvatar({
                      dataUrl: String(reader.result || ""),
                      fileName: f.name,
                    });
                  reader.readAsDataURL(f);
                }}
              />
              <button
                type="button"
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-2xs text-zinc-300 hover:bg-zinc-800"
                onClick={() => fileRef.current?.click()}
              >
                {avatar ? t("baileysConnect.chooseAnotherImage") : t("baileysConnect.chooseImage")}
              </button>
              {avatar && (
                <span className="text-2xs text-zinc-500">
                  {avatar.fileName}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-2xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({
                ...(displayName.trim() ? { name: displayName.trim() } : {}),
                ...(statusText.trim()
                  ? { status: statusText.trim() }
                  : {}),
                ...(avatar ? { avatarDataUrl: avatar.dataUrl } : {}),
              })
            }
            className="rounded-lg bg-brand px-4 py-1.5 text-2xs font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
