import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { enqueueGatedIngest } from "@/lib/ingestGate";
import {
  connectBridge,
  drainBridgeEvents,
  getBridgeStatus,
  isTauri,
  type BridgeEvent,
  type BridgeStatus,
} from "@/lib/bridge";

/** 状态兜底轮询：事件推送为主，避免 3s 空转 */
const STATUS_POLL_MS = 12_000;

/**
 * 订阅 Bridge 推送；低频轮询状态作兜底；可选自动连接；断线 toast。
 */
export function BridgeWatcher() {
  const setBridgeRuntime = useAppStore((s) => s.setBridgeRuntime);
  const ingestBridgeEvents = useAppStore((s) => s.ingestBridgeEvents);
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useAppStore((s) => s.settings);
  const wasConnected = useRef(false);
  const booted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unlistenEvent: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    const apply = (s: BridgeStatus, fromAuto = false) => {
      if (s && "mock" in s && s.mock) {
        setBridgeRuntime({
          connected: false,
          host: settings.bridgeHost,
          port: settings.bridgePort,
          tauriUnavailable: true,
          deviceName: null,
          transport: null,
          lastError: null,
        });
        return;
      }

      const connected = !!s.connected;
      const deviceName = s.devices?.[0]?.name ?? null;
      const transport = s.devices?.[0]?.transport ?? null;

      setBridgeRuntime({
        connected,
        host: s.host || settings.bridgeHost,
        port: s.port || settings.bridgePort,
        deviceName,
        transport,
        lastError: s.last_error ?? null,
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
            setBridgeRuntime({
              connected: false,
              host: settings.bridgeHost,
              port: settings.bridgePort,
              lastError: "自动连接失败，正在重试",
            });
            return;
          }
          if (cancelled) return;
        }
        apply(s, fromAuto);
      } catch (e) {
        if (cancelled) return;
        setBridgeRuntime({
          connected: false,
          host: settings.bridgeHost,
          port: settings.bridgePort,
          lastError: e instanceof Error ? e.message : String(e),
          tauriUnavailable: false,
        });
        if (booted.current && wasConnected.current) {
          pushToast("Bridge 状态异常", "error");
          wasConnected.current = false;
        }
        booted.current = true;
      }
    };

    /** 推送可能与队列竞态时，启动时 drain 一次捞遗留 */
    const drainOnce = async () => {
      if (!isTauri() || cancelled) return;
      try {
        const events = await drainBridgeEvents();
        if (!cancelled && events.length) ingestBridgeEvents(events);
      } catch {
        /* ignore */
      }
    };

    const setupListeners = async () => {
      if (!isTauri()) {
        await tickStatus(false);
        return;
      }

      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      unlistenEvent = await listen<BridgeEvent>("bridge://event", (ev) => {
        if (cancelled || !ev.payload) return;
        // 走打字让路队列：输入框聚焦打字时先入队，空闲片再入库，避免同步抢占主线程
        enqueueGatedIngest([ev.payload], ingestBridgeEvents);
      });

      unlistenStatus = await listen<BridgeStatus>("bridge://status", (ev) => {
        if (cancelled || !ev.payload) return;
        apply(ev.payload, false);
      });

      await tickStatus(true);
      await drainOnce();
    };

    void setupListeners();

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
      document.removeEventListener("visibilitychange", onResume);
      unlistenEvent?.();
      unlistenStatus?.();
    };
  }, [
    setBridgeRuntime,
    ingestBridgeEvents,
    pushToast,
    settings.bridgeHost,
    settings.bridgePort,
    settings.bridgeToken,
    settings.autoConnectBridge,
  ]);

  return null;
}
