import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { enqueueGatedIngest } from "@/lib/ingestGate";
import {
  attachBridgeEventListener,
  connectBridge,
  detachBridgeEventListener,
  getBridgeStatus,
  isTauri,
  type BridgeEvent,
  type BridgeStatus,
} from "@/lib/bridge";

/** 状态兜底轮询：事件推送为主，避免 3s 空转 */
const STATUS_POLL_MS = 12_000;
const LISTENER_RETRY_MAX_MS = 30_000;
let bridgeEventListenerGeneration = Date.now() * 1000;

function nextBridgeEventListenerGeneration() {
  bridgeEventListenerGeneration += 1;
  return bridgeEventListenerGeneration;
}

function bridgeEventKey(event: BridgeEvent): string | undefined {
  if (event.id) return `id:${event.id}`;
  if (event.seq !== undefined) return `seq:${event.deviceId || ""}:${event.seq}`;
  return undefined;
}

function listenerRetryDelay(attempt: number) {
  return Math.min(LISTENER_RETRY_MAX_MS, 1000 * 2 ** Math.min(attempt, 5));
}

/**
 * 订阅 Bridge 推送；低频轮询状态作兜底；可选自动连接；断线 toast。
 */
export function BridgeWatcher() {
  const setBridgeRuntime = useAppStore((s) => s.setBridgeRuntime);
  const ingestBridgeEvents = useAppStore((s) => s.ingestBridgeEvents);
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useAppStore((s) => s.settings);
  const { t } = useI18n();
  const wasConnected = useRef(false);
  const booted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unlistenEvent: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let eventListenerGeneration: number | null = null;
    let eventRetryTimer: number | null = null;
    let statusRetryTimer: number | null = null;
    let eventRetryAttempt = 0;
    let statusRetryAttempt = 0;
    let bridgeError: string | null = null;
    let eventListenerWarning: string | null = null;
    let statusListenerWarning: string | null = null;
    let overflowWarning: string | null = null;

    const runtimeError = () =>
      [bridgeError, eventListenerWarning, statusListenerWarning, overflowWarning]
        .filter(Boolean)
        .join(" · ") || null;
    const publishRuntimeError = () =>
      setBridgeRuntime({ lastError: runtimeError() });

    const apply = (s: BridgeStatus, fromAuto = false) => {
      if (s && "mock" in s && s.mock) {
        bridgeError = null;
        setBridgeRuntime({
          connected: false,
          host: settings.bridgeHost,
          port: settings.bridgePort,
          tauriUnavailable: true,
          deviceName: null,
          transport: null,
          lastError: runtimeError(),
        });
        return;
      }

      const connected = !!s.connected;
      const deviceName = s.devices?.[0]?.name ?? null;
      const transport = s.devices?.[0]?.transport ?? null;
      bridgeError = s.last_error ?? null;

      setBridgeRuntime({
        connected,
        host: s.host || settings.bridgeHost,
        port: s.port || settings.bridgePort,
        deviceName,
        transport,
        lastError: runtimeError(),
        tauriUnavailable: false,
      });

      if (booted.current) {
        if (wasConnected.current && !connected) {
          pushToast("手机 Bridge 已断开", "error");
        } else if (!wasConnected.current && connected) {
          pushToast(
            fromAuto
              ? `已自动连接${deviceName ? ` · ${deviceName}` : ""}`
              : deviceName
                ? `Bridge 已连接 · ${deviceName}`
                : "Bridge 已连接",
            "success"
          );
        }
      }
      wasConnected.current = connected;
      booted.current = true;
    };

    const tickStatus = async (allowAuto = true) => {
      if (cancelled) return;

      if (!isTauri()) {
        setBridgeRuntime({
          connected: false,
          host: settings.bridgeHost,
          port: settings.bridgePort,
          deviceName: null,
          transport: null,
          lastError: null,
          tauriUnavailable: true,
        });
        return;
      }

      try {
        let s = await getBridgeStatus();
        if (cancelled) return;
        let fromAuto = false;
        if (
          allowAuto &&
          settings.autoConnectBridge &&
          settings.bridgeToken.trim() &&
          !s.connected &&
          !(s && "mock" in s && s.mock)
        ) {
          fromAuto = true;
          try {
            s = await connectBridge(
              settings.bridgeHost,
              settings.bridgePort,
              settings.bridgeToken,
            );
          } catch {
            booted.current = true;
            bridgeError = "自动连接失败，正在重试";
            setBridgeRuntime({
              connected: false,
              host: settings.bridgeHost,
              port: settings.bridgePort,
              lastError: runtimeError(),
            });
            return;
          }
          if (cancelled) return;
        }
        apply(s, fromAuto);
      } catch (e) {
        if (cancelled) return;
        bridgeError = e instanceof Error ? e.message : String(e);
        setBridgeRuntime({
          connected: false,
          host: settings.bridgeHost,
          port: settings.bridgePort,
          lastError: runtimeError(),
          tauriUnavailable: false,
        });
        if (booted.current && wasConnected.current) {
          pushToast("Bridge 状态异常", "error");
          wasConnected.current = false;
        }
        booted.current = true;
      }
    };

    let setupEventListener: () => Promise<void>;
    const scheduleEventRetry = () => {
      if (cancelled || eventRetryTimer !== null) return;
      const delay = listenerRetryDelay(eventRetryAttempt++);
      eventListenerWarning = t("androidBridge.eventListenerRetry", {
        seconds: Math.ceil(delay / 1000),
      });
      publishRuntimeError();
      eventRetryTimer = window.setTimeout(() => {
        eventRetryTimer = null;
        void setupEventListener();
      }, delay);
    };

    setupEventListener = async () => {
      if (cancelled || unlistenEvent) return;
      let ready = false;
      const liveDuringSetup: BridgeEvent[] = [];
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;

        const generation = nextBridgeEventListenerGeneration();
        eventListenerGeneration = generation;
        const stop = await listen<BridgeEvent>("bridge://event", (ev) => {
          if (cancelled || !ev.payload) return;
          if (!ready) {
            liveDuringSetup.push(ev.payload);
            return;
          }
          // 走打字让路队列：输入框聚焦打字时先入队，空闲片再入库。
          enqueueGatedIngest([ev.payload], ingestBridgeEvents);
        });
        if (cancelled) {
          stop();
          return;
        }
        unlistenEvent = stop;

        const buffered = await attachBridgeEventListener(generation);
        if (cancelled) return;
        if (!buffered.active) throw new Error("事件监听注册已过期");

        const replayKeys = new Map<string, number>();
        for (const event of buffered.events) {
          const key = bridgeEventKey(event);
          if (key) replayKeys.set(key, (replayKeys.get(key) || 0) + 1);
        }
        const liveAfterReplay = liveDuringSetup.filter((event) => {
          const key = bridgeEventKey(event);
          if (!key) return true;
          const count = replayKeys.get(key) || 0;
          if (!count) return true;
          if (count === 1) replayKeys.delete(key);
          else replayKeys.set(key, count - 1);
          return false;
        });
        ready = true;

        const missed = [...buffered.events, ...liveAfterReplay];
        if (missed.length) enqueueGatedIngest(missed, ingestBridgeEvents);
        if (buffered.dropped_events > 0) {
          overflowWarning = t("androidBridge.eventBufferOverflow", {
            count: buffered.dropped_events,
          });
          publishRuntimeError();
          pushToast(overflowWarning, "error");
        }

        const wasRetrying = eventListenerWarning !== null;
        eventListenerWarning = null;
        eventRetryAttempt = 0;
        publishRuntimeError();
        if (wasRetrying) pushToast(t("androidBridge.eventListenerRecovered"), "success");
      } catch {
        if (cancelled) return;
        ready = false;
        const stop = unlistenEvent;
        const generation = eventListenerGeneration;
        unlistenEvent = undefined;
        eventListenerGeneration = null;
        if (stop && generation !== null) {
          void detachBridgeEventListener(generation)
            .catch(() => undefined)
            .finally(stop);
        } else {
          stop?.();
        }
        scheduleEventRetry();
      }
    };

    let setupStatusListener: () => Promise<void>;
    const scheduleStatusRetry = () => {
      if (cancelled || statusRetryTimer !== null) return;
      const delay = listenerRetryDelay(statusRetryAttempt++);
      statusListenerWarning = t("androidBridge.statusListenerRetry", {
        seconds: Math.ceil(delay / 1000),
      });
      publishRuntimeError();
      statusRetryTimer = window.setTimeout(() => {
        statusRetryTimer = null;
        void setupStatusListener();
      }, delay);
    };

    setupStatusListener = async () => {
      if (cancelled || unlistenStatus) return;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        const stop = await listen<BridgeStatus>("bridge://status", (ev) => {
          if (cancelled || !ev.payload) return;
          apply(ev.payload, false);
        });
        if (cancelled) {
          stop();
          return;
        }
        unlistenStatus = stop;
        const wasRetrying = statusListenerWarning !== null;
        statusListenerWarning = null;
        statusRetryAttempt = 0;
        publishRuntimeError();
        if (wasRetrying) pushToast(t("androidBridge.statusListenerRecovered"), "success");
      } catch {
        if (!cancelled) scheduleStatusRetry();
      }
    };

    void setupEventListener();
    void setupStatusListener();
    void tickStatus(true);

    let resumeBlockedUntil = 0;
    let resumeTimer: number | null = null;
    const pollId = window.setInterval(() => {
      if (Date.now() >= resumeBlockedUntil) void tickStatus(true);
    }, STATUS_POLL_MS);

    const onResume = () => {
      if (document.hidden) return;
      resumeBlockedUntil = Date.now() + 1800;
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => void tickStatus(false), 1800);
    };
    document.addEventListener("visibilitychange", onResume);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      if (eventRetryTimer !== null) window.clearTimeout(eventRetryTimer);
      if (statusRetryTimer !== null) window.clearTimeout(statusRetryTimer);
      document.removeEventListener("visibilitychange", onResume);
      unlistenStatus?.();
      const stop = unlistenEvent;
      const generation = eventListenerGeneration;
      if (stop && generation !== null) {
        void detachBridgeEventListener(generation)
          .catch(() => undefined)
          .finally(stop);
      } else {
        stop?.();
      }
    };
  }, [
    setBridgeRuntime,
    ingestBridgeEvents,
    pushToast,
    t,
    settings.bridgeHost,
    settings.bridgePort,
    settings.bridgeToken,
    settings.autoConnectBridge,
  ]);

  return null;
}
