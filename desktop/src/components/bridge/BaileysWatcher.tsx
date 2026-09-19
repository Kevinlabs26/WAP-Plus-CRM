import { useEffect, useRef } from "react";
import {
  baileysEvents,
  baileysFetchAvatar,
  baileysLabels,
  baileysStatus,
  baileysSync,
} from "@/lib/baileys";
import { notifyGroupJoinRequests } from "@/lib/groupJoinNotify";
import { syncLog } from "@/lib/syncDebug";
import { isComposerTypingBusy } from "@/lib/composerActivity";
import { useAppStore } from "@/store/appStore";
import { persist } from "@/store/persist";
import type { BridgeEvent } from "@/lib/bridge";
import {
  extractAccountHumanName,
} from "@/lib/accountLabels";

const cursorKey = (accountId: string) =>
  `wap.baileys.eventCursor.${accountId}`;
/**
 * 大联系人快照按账号节流：稳态下桥接每 ~10s 全量重发一遍联系人（几百条），
 * 即使数据没变也要逐条处理占主线程。60s 内只处理一次，小增量（≤10 条）正常放行。
 */
const CONTACT_SYNC_MIN_MS = 60_000;
const CONTACT_SYNC_DELTA_MAX = 10;
const contactSyncThrottle = new Map<string, number>();
/**
 * 多号并行时过勤会卡 UI。
 * 外层 tick 只负责调度；各账号有自己的最小间隔。
 */
/**
 * 调度节拍：真正拉 events 仍受各账号 minInterval 限制。
 * 多号：对方发来 / 另一号回声，若号不是 live 且间隔过大，会「好几秒才到」。
 * live / 当前会话所属号较快；其它在线号中等；未连接槽很慢。
 */
/** 外层调度；真正拉 events 仍受各账号 minInterval 限制 */
const TICK_MS = 2500;
/** 默认发送号 / 扫码中 */
const INTERVAL_LIVE_MS = 2800;
const INTERVAL_BUSY_MS = 3500;
/** 当前打开会话所属号（即使用户 live 在别的槽） */
const INTERVAL_FOCUSED_MS = 3200;
/** 其它已在线号 */
const INTERVAL_ONLINE_MS = 9000;
/** 仅有名字、未必在线的槽 */
const INTERVAL_IDLE_MS = 30_000;
/** 后台账号单次拉取超过该时长，短暂降频，避免慢 IPC 反复占用轮询队列 */
const SLOW_POLL_MS = 4_000;
const SLOW_BACKOFF_MS = 15_000;
const LABELS_REFRESH_MS = 300_000;
/** 单 tick 最多串行轮询的账号数（live/focused 优先，其余轮转） */
const MAX_ACCOUNTS_PER_TICK = 2;
/** 连续失败这么多次才把 UI 标成断开 */
const FAIL_DEMOTE_AFTER = 3;

function readCursor(accountId: string): number {
  try {
    const n = Number(sessionStorage.getItem(cursorKey(accountId)) || "0");
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCursor(accountId: string, n: number) {
  try {
    sessionStorage.setItem(cursorKey(accountId), String(n));
  } catch {
    /* ignore */
  }
}

let accountsPersistTimer: ReturnType<typeof setTimeout> | null = null;
/** 槽状态变更后延迟落盘，避免多号轮询时每秒写 SQLite */
function scheduleAccountsPersist() {
  if (accountsPersistTimer) clearTimeout(accountsPersistTimer);
  accountsPersistTimer = setTimeout(() => {
    accountsPersistTimer = null;
    const s2 = useAppStore.getState();
    // hydrate 完成前绝不写盘，避免空初始状态覆盖 SQLite
    if (!s2.hydrated) return;
    // 必须走 canonical persist（strip 大体量 media），禁止直接 dump 内存 messages
    persist(() => useAppStore.getState());
  }, 18_000);
}

type AcctRuntime = {
  cursor: number;
  prevConnected: boolean;
  syncing: boolean;
  lastEventAt: number;
  lastCatchupAt: number;
  failStreak: number;
  lastConfirmedConnectedAt: number;
  labelsSyncing: boolean;
  lastLabelsAt: number;
  pollInFlight: boolean;
  lastPollAt: number;
  slowUntil: number;
};

function emptyRt(): AcctRuntime {
  return {
    cursor: 0,
    prevConnected: false,
    syncing: false,
    lastEventAt: Date.now(),
    lastCatchupAt: 0,
    failStreak: 0,
    lastConfirmedConnectedAt: 0,
    labelsSyncing: false,
    lastLabelsAt: 0,
    pollInFlight: false,
    lastPollAt: 0,
    slowUntil: 0,
  };
}

/**
 * 多账号 Baileys 轮询：每个账号槽独立 cursor / 同步。
 * baileysUi 仍展示「直播槽」状态（扫码 UI）；其它号在后台收事件入库。
 */
export function BaileysWatcher() {
  const enabled = useAppStore(
    (state) => state.settings.sendChannel !== "android_bridge"
  );
  const ingest = useAppStore((state) => state.ingestBridgeEvents);
  const pushToast = useAppStore((state) => state.pushToast);
  const setBaileysUi = useAppStore((state) => state.setBaileysUi);
  const setBaileysLoginOpen = useAppStore((state) => state.setBaileysLoginOpen);
  const syncWhatsAppLabels = useAppStore(
    (state) => state.syncWhatsAppLabels
  );

  const byAccount = useRef(new Map<string, AcctRuntime>());
  const toastedFail = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let pendingEvents: BridgeEvent[] = [];
    let eventFlushTimer: number | null = null;
    let ingestFrame: number | null = null;
    let ingestIdle: number | null = null;
    let ingestDelayTimer: number | null = null;
    let ingestQueue: BridgeEvent[][] = [];
    const INGEST_CHUNK_SIZE = 4;

    const hasPendingUserInput = () => {
      try {
        return (
          (navigator as unknown as {
            scheduling?: { isInputPending?: () => boolean };
          }).scheduling?.isInputPending?.() === true
        );
      } catch {
        return false;
      }
    };

    const pumpIngestQueue = (deadline?: IdleDeadline | number) => {
      ingestFrame = null;
      ingestIdle = null;
      if (cancelled) {
        ingestQueue = [];
        return;
      }
      if (isComposerTypingBusy() || hasPendingUserInput()) {
        scheduleIngestPump();
        return;
      }
      // 合并后排批次：每次 ingest 都要克隆全数组 + 通知订阅者 + 重渲，固定开销远大于
      // 逐条处理本身。联系人大同步会被拆成上百条 4-item 小批次，逐条入库会把主线程
      // 占满几十秒 → 打字卡顿。这里把队列里的小批次合并成少数几次 store 更新：
      //  - 总 item 数有硬顶（对齐 ingestBridgeEvents 内部的 500 切片），单次 set 有界
      //  - 合并过程中一有输入待处理（isInputPending）立即让路，不抢打字帧
      let merged: BridgeEvent[] = [];
      let mergedItems = 0;
      while (ingestQueue.length) {
        if (hasPendingUserInput()) break;
        const chunk = ingestQueue[0] as BridgeEvent[];
        let chunkItems = 0;
        for (const event of chunk) {
          const p =
            event.payload && typeof event.payload === "object"
              ? (event.payload as Record<string, unknown>)
              : null;
          chunkItems +=
            p && Array.isArray(p.items) ? p.items.length : 1;
        }
        if (merged.length && mergedItems + chunkItems > 480) break;
        merged.push(...(ingestQueue.shift() as BridgeEvent[]));
        mergedItems += chunkItems;
        // 一帧内别把预算全吃掉：合并本身也要留时间给新输入
        if (
          typeof deadline === "object" &&
          deadline !== null &&
          typeof deadline.timeRemaining === "function" &&
          deadline.timeRemaining() < 6
        ) {
          break;
        }
      }
      if (merged.length) {
        ingest(merged);
        // 合并过程中用户开始打字：剩余批次等下一个空闲片再处理
        if (isComposerTypingBusy()) {
          scheduleIngestPump();
          return;
        }
      }
      if (ingestQueue.length) scheduleIngestPump();
    };

    const scheduleIngestPump = () => {
      if (
        cancelled ||
        ingestFrame != null ||
        ingestIdle != null ||
        ingestDelayTimer != null
      )
        return;
      if (isComposerTypingBusy() || hasPendingUserInput()) {
        ingestDelayTimer = window.setTimeout(() => {
          ingestDelayTimer = null;
          scheduleIngestPump();
        }, 120);
        return;
      }
      if (typeof window.requestIdleCallback === "function") {
        ingestIdle = window.requestIdleCallback(pumpIngestQueue, {
          timeout: 500,
        });
      } else {
        ingestFrame = requestAnimationFrame(pumpIngestQueue);
      }
    };

    // History/snapshot can contain hundreds of items. Keep each store update
    // small enough to yield between frames so navigation and typing stay responsive.
    const queueIngestBatch = (events: BridgeEvent[]) => {
      if (!events.length || cancelled) return;
      // 大联系人快照节流：60s 内每个账号只放行一次，减少后台突发占用主线程
      const now = Date.now();
      const throttled = events.filter((event) => {
        if (event.type !== "contacts.sync") return true;
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : null;
        const items =
          payload && Array.isArray(payload.items) ? payload.items : [];
        if (items.length <= CONTACT_SYNC_DELTA_MAX) return true;
        const key = String(
          (event as { accountId?: string }).accountId ||
            event.deviceId ||
            "default"
        );
        const last = contactSyncThrottle.get(key) || 0;
        if (now - last < CONTACT_SYNC_MIN_MS) return false;
        contactSyncThrottle.set(key, now);
        return true;
      });
      if (!throttled.length) return;
      const chunks: BridgeEvent[][] = [];
      let smallBatch: BridgeEvent[] = [];
      const flushSmallBatch = () => {
        if (!smallBatch.length) return;
        chunks.push(smallBatch);
        smallBatch = [];
      };

      for (const event of throttled) {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : null;
        const items = payload && Array.isArray(payload.items) ? payload.items : null;
        const isLargeSync =
          (event.type === "contacts.sync" || event.type === "messages.sync") &&
          !!items &&
          items.length > INGEST_CHUNK_SIZE;
        if (!isLargeSync || !items) {
          smallBatch.push(event);
          continue;
        }

        flushSmallBatch();
        for (let i = 0; i < items.length; i += INGEST_CHUNK_SIZE) {
          const end = Math.min(i + INGEST_CHUNK_SIZE, items.length);
          chunks.push([
            {
              ...event,
              payload: {
                ...payload,
                items: items.slice(i, end),
                syncBatchFinal: end === items.length,
              } as BridgeEvent["payload"],
            },
          ]);
        }
      }
      flushSmallBatch();

      ingestQueue.push(...chunks);
      scheduleIngestPump();
    };

    const queueEvents = (events: BridgeEvent[]) => {
      if (!events.length || cancelled) return;
      pendingEvents.push(...events);
      if (eventFlushTimer != null) return;
      eventFlushTimer = window.setTimeout(() => {
        eventFlushTimer = null;
        const batch = pendingEvents;
        pendingEvents = [];
        if (batch.length && !cancelled) queueIngestBatch(batch);
      }, 40);
    };

    const liveId = () => {
      const s = useAppStore.getState().settings;
      return s.liveBaileysAccountId || s.activeAccountId || "wa-default";
    };

    const accountIdsToPoll = (): string[] => {
      const s = useAppStore.getState().settings;
      const ids = new Set<string>();
      const live = s.liveBaileysAccountId || s.activeAccountId || "";
      if (live) ids.add(live);
      for (const a of s.waAccounts || []) {
        // 多号同时在线：已保存 auth / 连接中 / 待扫码 的槽都起进程并轮询
        if (
          a.id === live ||
          a.status === "connected" ||
          a.status === "connecting" ||
          a.status === "qr" ||
          !!(a.userName && a.userName.trim())
        ) {
          ids.add(a.id);
        }
      }
      // 至少轮询一个，避免空列表
      if (!ids.size && (s.waAccounts || []).length) {
        ids.add(s.waAccounts![0]!.id);
      }
      const list = [...ids];
      // 降噪：每 15s 打一次 poll 名单
      const k = "__wap_poll_log_at";
      const w = window as unknown as Record<string, number>;
      const now = Date.now();
      if (!w[k] || now - w[k] > 15_000) {
        w[k] = now;
        syncLog("watcher", "poll accounts", {
          live,
          ids: list,
          slots: (s.waAccounts || []).map((a) => ({
            id: a.id,
            status: a.status,
            userName: a.userName,
          })),
        }, "debug");
      }
      return list;
    };

    const rt = (accountId: string) => {
      let r = byAccount.current.get(accountId);
      if (!r) {
        r = emptyRt();
        r.cursor = readCursor(accountId);
        byAccount.current.set(accountId, r);
      }
      return r;
    };

    const tagAccount = <T extends Record<string, unknown>>(
      ev: T,
      accountId: string
    ): T => {
      const payload =
        ev.payload && typeof ev.payload === "object"
          ? { ...(ev.payload as object), accountId }
          : { accountId };
      return {
        ...ev,
        deviceId: accountId,
        accountId,
        payload,
      } as T;
    };

    const ingestSyncSnapshot = (
      accountId: string,
      result: { contacts?: unknown[]; messages?: unknown[] },
      source: string
    ) => {
      const stampItems = (items: unknown[]) =>
        (items || []).map((it) =>
          it && typeof it === "object"
            ? { ...(it as object), accountId }
            : it
        );
      queueIngestBatch([
        tagAccount(
          {
            type: "contacts.sync",
            deviceId: accountId,
            payload: {
              items: stampItems(result.contacts ?? []),
              source,
            },
          },
          accountId
        ),
        tagAccount(
          {
            type: "messages.sync",
            deviceId: accountId,
            payload: {
              items: stampItems(result.messages ?? []),
              source,
              live: false,
            },
          },
          accountId
        ),
      ] as BridgeEvent[]);
    };

    const runAutoSync = async (
      accountId: string,
      userLabel: string | null,
      opts?: { quiet?: boolean }
    ) => {
      const r = rt(accountId);
      if (r.syncing || cancelled) return;
      r.syncing = true;
      try {
        await new Promise((res) =>
          window.setTimeout(res, opts?.quiet ? 400 : 1500)
        );
        if (cancelled) return;
        const result = await baileysSync(accountId);
        if (cancelled) return;
        // 空快照也算一次完整尝试；历史数据会通过 events 主动到达，禁止首分钟循环 /sync。
        r.lastCatchupAt = Date.now();
        const n = result.contacts?.length ?? 0;
        const m = result.messages?.length ?? 0;
        if (n > 0 || m > 0) {
          ingestSyncSnapshot(accountId, result, "snapshot");
          r.lastEventAt = Date.now();
          if (!opts?.quiet) {
            pushToast(
              `已连接${userLabel ? ` · ${userLabel}` : ""}，同步 ${n} 联系人 / ${m} 消息`,
              "success"
            );
          }
        } else if (!opts?.quiet) {
          pushToast(
            `已连接${userLabel ? ` · ${userLabel}` : ""}，正在拉取历史会话…`,
            "info"
          );
        }
        if (
          accountId === liveId() &&
          useAppStore.getState().baileysLoginOpen
        ) {
          setBaileysLoginOpen(false);
        }
      } catch (e) {
        if (!cancelled && !opts?.quiet) {
          const msg = e instanceof Error ? e.message : String(e);
          pushToast(
            `已连接，但自动同步失败：${msg.slice(0, 80)}。可在侧栏手动同步。`,
            "error"
          );
        }
      } finally {
        r.syncing = false;
      }
    };

    const runLabelsSync = async (accountId: string) => {
      const r = rt(accountId);
      if (r.labelsSyncing || cancelled) return;
      r.labelsSyncing = true;
      try {
        const result = await baileysLabels(accountId);
        if (!cancelled && accountId === liveId()) {
          syncWhatsAppLabels(
            result.labels || [],
            result.chatLabelIds || {},
            accountId
          );
          r.lastLabelsAt = Date.now();
        }
      } catch {
        /* Business 标签可选 */
      } finally {
        r.labelsSyncing = false;
      }
    };

    const applyUiFromStatus = (
      accountId: string,
      status: {
        connection: string;
        user?: {
          name?: string;
          notify?: string;
          verifiedName?: string;
          id?: string;
        } | null;
        qrDataUrl?: string;
        hasQr?: boolean;
        signedIn?: boolean;
      }
    ) => {
      const r = rt(accountId);
      const raw = status.connection;
      const now = Date.now();
      const stickyMs = 90_000;
      const recentlyConnected = now - r.lastConfirmedConnectedAt < stickyMs;
      // 只信本槽 bridge 回报的 user；绝不用全局 baileysUi.userName 回填其它槽
      const statusPhoneE164 =
        typeof status.user?.id === "string"
          ? (() => {
              const digits = status.user.id.split("@")[0]?.split(":")[0] || "";
              return /^\d{7,15}$/u.test(digits) ? `+${digits}` : "";
            })()
          : "";
      const statusHumanName =
        extractAccountHumanName(status.user?.name) ||
        extractAccountHumanName(status.user?.notify) ||
        extractAccountHumanName(status.user?.verifiedName) || "";
      const needScan =
        raw === "qr" ||
        raw === "logged_out" ||
        (raw === "error" && !recentlyConnected);

      const isLive = accountId === liveId();
      const connectedNow = raw === "connected";
      if (connectedNow) r.lastConfirmedConnectedAt = now;

      // 更新 settings 里对应槽状态（非直播也写）
      try {
        const st = useAppStore.getState();
        const accounts = st.settings.waAccounts || [];
        const idx = accounts.findIndex((a) => a.id === accountId);
        if (idx >= 0) {
          const prev = accounts[idx]!;
          // 多号：每个槽跟自己的 bridge 状态；reconnecting 保持 connecting
          const nextStatus =
            raw === "connected"
              ? "connected"
              : needScan
                ? raw === "qr"
                  ? "qr"
                  : "disconnected"
                : raw === "reconnecting" || raw === "starting"
                  ? "connecting"
                  : raw === "close"
                    ? prev.status === "connected" || prev.status === "connecting"
                      ? "connecting"
                      : prev.status
                    : raw === "error"
                      ? "error"
                      : prev.status;
          // 出码/登出：清掉继承名；已连接：status 优先，否则保留本槽旧名
          const nextName = statusHumanName
            ? statusHumanName
            : needScan || raw === "starting" || raw === "qr"
              ? undefined
              : extractAccountHumanName(prev.userName) ||
                prev.userName ||
                statusPhoneE164 ||
                undefined;
          const nextPhoneE164 = prev.phoneE164 || statusPhoneE164 || undefined;
          // 出码/登出清掉头像；已连接保留
          const nextAvatar =
            needScan || raw === "logged_out"
              ? undefined
              : prev.avatarUrl;
          if (
            prev.status !== nextStatus ||
            prev.userName !== nextName ||
            prev.phoneE164 !== nextPhoneE164 ||
            prev.avatarUrl !== nextAvatar
          ) {
            const next = accounts.map((a, i) =>
              i === idx
                ? {
                    ...a,
                    status: nextStatus as typeof a.status,
                    userName: nextName,
                    phoneE164: nextPhoneE164,
                    avatarUrl: nextAvatar,
                    // 仅状态变化时戳时间，避免无意义对象抖动
                    updatedAt: new Date().toISOString(),
                  }
                : a
            );
            // 只改内存；落盘合并防抖（多号轮询切勿每 tick 写盘）
            useAppStore.setState({
              settings: { ...st.settings, waAccounts: next },
            });
            if (
              nextStatus === "connected" ||
              nextStatus === "disconnected" ||
              nextStatus === "qr" ||
              nextStatus === "error"
            ) {
              scheduleAccountsPersist();
            }
          }
          // 已连接：无头像则拉本人头像（self=1；节流避免每轮 status 狂打 /avatar）
          if (connectedNow && !prev.avatarUrl && !needScan) {
            const w = window as unknown as {
              __wapSelfAvatarAt?: Record<string, number>;
            };
            const stamp = w.__wapSelfAvatarAt || (w.__wapSelfAvatarAt = {});
            const lastAt = stamp[accountId] || 0;
            if (Date.now() - lastAt > 45_000) {
              stamp[accountId] = Date.now();
              const bare =
                typeof status.user?.id === "string"
                  ? status.user.id.replace(/:\d+@/, "@")
                  : undefined;
              void baileysFetchAvatar({
                jid: bare || status.user?.id,
                self: true,
                quality: "preview",
                force: true,
                accountId,
              })
                .then((res) => {
                  const url = res?.avatarUrl || res?.avatarFullUrl || "";
                  if (!url || !String(url).startsWith("data:")) return;
                  const cur = useAppStore.getState();
                  const list = cur.settings.waAccounts || [];
                  const at = list.findIndex((a) => a.id === accountId);
                  if (at < 0 || list[at]?.avatarUrl === url) return;
                  const patched = list.map((a, i) =>
                    i === at
                      ? {
                          ...a,
                          avatarUrl: url,
                          phoneE164:
                            a.phoneE164 ||
                            (typeof status.user?.id === "string"
                              ? (() => {
                                  const d = status
                                    .user!.id!.split("@")[0]
                                    ?.split(":")[0];
                                  return d && /^\d{7,15}$/.test(d)
                                    ? `+${d}`
                                    : a.phoneE164;
                                })()
                              : a.phoneE164),
                          updatedAt: new Date().toISOString(),
                        }
                      : a
                  );
                  useAppStore.setState({
                    settings: { ...cur.settings, waAccounts: patched },
                  });
                  scheduleAccountsPersist();
                })
                .catch(() => undefined);
            }
          }
        }
      } catch {
        /* ignore */
      }

      // 非 live 槽：照常入库/同步，但不改全局 baileysUi
      if (!isLive) {
        return connectedNow || (recentlyConnected && !needScan);
      }

      // —— 以下仅「当前浏览槽」更新 baileysUi（顶栏/弹窗）——
      // 顶栏名字也只用本槽 status，避免扫码中顶栏仍挂旧号名
      const userName = statusHumanName || statusPhoneE164 || null;
      const ui = useAppStore.getState().baileysUi;
      const patchUi = (
        connection: string,
        name: string | null,
        hasQr: boolean
      ) => {
        if (
          ui.connection === connection &&
          ui.userName === name &&
          ui.hasQr === hasQr
        ) {
          return;
        }
        setBaileysUi({ connection, userName: name, hasQr });
      };

      if (raw === "connected") {
        patchUi("connected", userName || null, false);
        return true;
      }

      if (
        (recentlyConnected || status.signedIn || r.prevConnected) &&
        (raw === "reconnecting" || raw === "starting" || raw === "close")
      ) {
        patchUi("connected", userName || null, false);
        return true;
      }

      const nextConn = needScan ? raw : raw === "error" ? "error" : raw;
      const nextQr =
        Boolean(status.hasQr ?? status.qrDataUrl) && needScan;
      patchUi(nextConn, userName || null, nextQr);
      return raw === "connected";
    };

    const focusedAccountId = (): string => {
      const st = useAppStore.getState();
      const chat = st.chats.find((c) => c.id === st.selectedChatId);
      const contact = st.contacts.find((c) => c.id === st.selectedContactId);
      return (
        chat?.accountId ||
        contact?.accountId ||
        contact?.boundPhoneId ||
        ""
      );
    };

    const minIntervalFor = (accountId: string): number => {
      const live = liveId();
      if (accountId === live) return INTERVAL_LIVE_MS;
      const focused = focusedAccountId();
      if (focused && accountId === focused) return INTERVAL_FOCUSED_MS;
      const a = (useAppStore.getState().settings.waAccounts || []).find(
        (x) => x.id === accountId
      );
      if (!a) return INTERVAL_IDLE_MS;
      if (a.status === "qr" || a.status === "connecting") return INTERVAL_BUSY_MS;
      if (a.status === "connected") return INTERVAL_ONLINE_MS;
      if (a.userName?.trim()) return INTERVAL_ONLINE_MS;
      return INTERVAL_IDLE_MS;
    };

    const pollOne = async (accountId: string, force = false) => {
      const r = rt(accountId);
      if (r.pollInFlight || cancelled) return;
      const now = Date.now();
      const priority = accountId === liveId() || accountId === focusedAccountId();
      if (!force && !priority && r.slowUntil > now) return;
      if (!force && r.lastPollAt && now - r.lastPollAt < minIntervalFor(accountId)) {
        return;
      }
      r.pollInFlight = true;
      r.lastPollAt = now;
      const startedAt = performance.now();
      let eventCount = 0;
      try {
        const isLive = accountId === liveId();
        // live：每次 status；其它号：约一半次数拉 status
        const pullStatus =
          isLive || !r.prevConnected || Math.floor(now / 8000) % 2 === 0;

        const result = await baileysEvents(r.cursor, accountId);
        const status = pullStatus
          ? await baileysStatus(accountId)
          : null;
        if (cancelled) return;

        r.failStreak = 0;
        if (isLive) toastedFail.current = false;

        if (typeof result.cursor === "number") {
          if (result.cursor < r.cursor && result.events.length === 0) {
            r.cursor = 0;
          } else {
            r.cursor = result.cursor;
          }
          writeCursor(accountId, r.cursor);
        }

        if (result.events.length) {
          eventCount = result.events.length;
          const tagged = result.events.map((ev) =>
            tagAccount(
              {
                ...(ev as object),
              } as Record<string, unknown>,
              accountId
            )
          );
          const stSettings = useAppStore.getState().settings;
          const groupNotifyOn =
            stSettings.desktopNotifyEnabled !== false &&
            stSettings.notifyGroupJoinEnabled !== false;
          if (groupNotifyOn) {
            notifyGroupJoinRequests(
              tagged as { type?: string; payload?: Record<string, unknown>; deviceId?: string }[],
              {
                pushToast,
                openGroup: (groupJid) => {
                  try {
                    const st = useAppStore.getState();
                    const chat = st.chats.find(
                      (c) =>
                        c.isGroup &&
                        (c.id.includes(encodeURIComponent(groupJid)) ||
                          c.id.includes(groupJid) ||
                          String(c.contactId || "").includes(groupJid))
                    );
                    if (chat) st.setSelectedChat(chat.id);
                  } catch {
                    /* ignore */
                  }
                },
              }
            );
          }
          // 历史同步状态 toast（节流在 note 变化时）
          for (const ev of tagged) {
            if ((ev as { type?: string }).type === "history.sync_status") {
              const p = (ev as { payload?: { status?: string } }).payload || {};
              const st = String(p.status || "");
              if (st === "complete") pushToast("历史同步完成", "success");
              else if (st === "paused")
                pushToast("历史同步暂停，可稍后点同步", "info");
            }
          }
          queueEvents(tagged as BridgeEvent[]);
          r.lastEventAt = Date.now();
        }

        let connected = r.prevConnected;
        let userName: string | null = null;
        if (status) {
          connected = applyUiFromStatus(accountId, status);
          userName =
            extractAccountHumanName(status.user?.name) ||
            extractAccountHumanName(status.user?.notify) ||
            extractAccountHumanName(status.user?.verifiedName) ||
            status.user?.id ||
            null;
        } else {
          // 无 status 时沿用槽状态
          const slot = (useAppStore.getState().settings.waAccounts || []).find(
            (a) => a.id === accountId
          );
          connected = slot?.status === "connected" || r.prevConnected;
          userName = slot?.userName || null;
        }

        if (connected && !r.prevConnected) {
          void runAutoSync(accountId, userName);
        }
        if (
          connected &&
          isLive &&
          Date.now() - r.lastLabelsAt > LABELS_REFRESH_MS
        ) {
          void runLabelsSync(accountId);
        }

        if (result.gap && result.gap.count > 0) {
          pushToast(
            `Baileys 事件缓冲已溢出，缺少 ${result.gap.count} 条，正在全量同步`,
            "info"
          );
          void runAutoSync(accountId, userName);
        }

        // 空闲全量 /sync 过频会重复灌库导致列表抖；拉长间隔，cursor 正常推进时不必常补
        if (
          connected &&
          r.prevConnected &&
          !r.syncing &&
          Date.now() - r.lastEventAt > 180_000 &&
          Date.now() - r.lastCatchupAt > 300_000
        ) {
          void runAutoSync(accountId, userName, { quiet: true });
        }

        r.prevConnected = connected;
      } catch (e) {
        r.failStreak += 1;
        if (r.failStreak >= FAIL_DEMOTE_AFTER) {
          r.prevConnected = false;
          const age = Date.now() - r.lastConfirmedConnectedAt;
          if (age > 15_000 && accountId === liveId()) {
            setBaileysUi({
              connection: "error",
              hasQr: false,
            });
          }
        }
        if (
          !toastedFail.current &&
          !cancelled &&
          accountId === liveId() &&
          useAppStore.getState().baileysLoginOpen
        ) {
          toastedFail.current = true;
          const msg = e instanceof Error ? e.message : String(e);
          pushToast(
            msg.includes("Failed to fetch") || msg.includes("无法连接")
              ? "Baileys 后台未就绪（请用 tauri dev 并重试扫码）"
              : msg.slice(0, 120),
            "error"
          );
        }
      } finally {
        r.pollInFlight = false;
        const durationMs = Math.round(performance.now() - startedAt);
        if (!priority && durationMs >= SLOW_POLL_MS) {
          r.slowUntil = Date.now() + SLOW_BACKOFF_MS;
        } else if (durationMs < SLOW_POLL_MS) {
          r.slowUntil = 0;
        }
        syncLog(
          "watcher",
          "poll account",
          { accountId, durationMs, events: eventCount, slowBackoff: !priority && durationMs >= SLOW_POLL_MS },
          durationMs >= SLOW_POLL_MS ? "warn" : "debug"
        );
      }
    };

    let tickInFlight = false;
    let resumedAt = 0;
    let resumeTimer: number | null = null;
    /** 非 live/focused 槽的轮转游标，避免每 tick 扫完全部号 */
    let backgroundRotate = 0;
    const pollAll = async (force = false) => {
      if (tickInFlight) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!force && Date.now() - resumedAt < 1200) return;
      // 输入尚未开放时不轮询（DeferredWatchers 也应未挂载；双保险）
      if (!useAppStore.getState().uiReady) return;
      if (isComposerTypingBusy()) return;
      // 启动暖机窗口内只拉 live 号，其它号延后，避免与打字抢主线程
      const bootUntil =
        (window as unknown as { __wapBootUntil?: number }).__wapBootUntil || 0;
      const inBoot = bootUntil > Date.now();
      tickInFlight = true;
      try {
        const ids = accountIdsToPoll();
        const live = liveId();
        const focused = focusedAccountId();
        const primary = [
          ...ids.filter((id) => id === live),
          ...ids.filter((id) => id === focused && id !== live),
        ];
        const background = ids.filter(
          (id) => id !== live && id !== focused
        );
        let ordered = force ? ids : primary;
        if (!force && inBoot) {
          ordered = primary.length ? primary : live ? [live] : [];
        } else if (!force && background.length) {
          // 每 tick 最多再带 1 个后台号轮转，控制串行 IPC
          const pick =
            background[backgroundRotate % background.length] || background[0];
          backgroundRotate =
            (backgroundRotate + 1) % Math.max(1, background.length);
          const room = Math.max(0, MAX_ACCOUNTS_PER_TICK - ordered.length);
          if (room > 0 && pick) ordered = [...ordered, pick];
        }
        // 硬顶：即使 live+focused 也限制在 MAX+1（双号同时前台）
        if (!force && ordered.length > MAX_ACCOUNTS_PER_TICK + 1) {
          ordered = ordered.slice(0, MAX_ACCOUNTS_PER_TICK + 1);
        }
        await Promise.all(ordered.map((id) => pollOne(id, force)));
      } finally {
        tickInFlight = false;
      }
    };

    const onStatusRefresh = () => void pollAll(true);
    window.addEventListener("wap:refresh-account-status", onStatusRefresh);

    // 挂载时输入通常已 ready 数秒；首轮再让 1.5s，避免刚能打字就灌事件
    const first = window.setTimeout(
      () => void pollAll(useAppStore.getState().activeNav === "phones"),
      1500
    );
    const id = window.setInterval(() => void pollAll(), TICK_MS);

    const onResume = () => {
      if (document.hidden) return;
      resumedAt = Date.now();
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => void pollAll(true), 1200);
    };
    document.addEventListener("visibilitychange", onResume);

    return () => {
      cancelled = true;
      if (eventFlushTimer != null) window.clearTimeout(eventFlushTimer);
      if (ingestFrame != null) cancelAnimationFrame(ingestFrame);
      if (ingestIdle != null) window.cancelIdleCallback(ingestIdle);
      if (ingestDelayTimer != null) window.clearTimeout(ingestDelayTimer);
      pendingEvents = [];
      ingestQueue = [];
      window.clearTimeout(first);
      window.clearInterval(id);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      if (accountsPersistTimer) {
        clearTimeout(accountsPersistTimer);
        accountsPersistTimer = null;
      }
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("wap:refresh-account-status", onStatusRefresh);
    };
  }, [
    enabled,
    ingest,
    pushToast,
    setBaileysUi,
    setBaileysLoginOpen,
    syncWhatsAppLabels,
  ]);

  return null;
}
