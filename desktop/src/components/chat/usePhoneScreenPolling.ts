import { useEffect, useState } from "react";
import { bridgeInvoke, isTauri } from "@/lib/bridge";
import { useAppStore } from "@/store/appStore";
import { translateCurrent } from "@/i18n";

/**
 * 手机屏幕实时预览：showScreen 开启后定时拉取截屏，
 * 页面隐藏时暂停、恢复时延迟再取。清理时释放旧 URL。
 */
export function usePhoneScreenPolling(deviceId: string | null) {
  const [showScreen, setShowScreen] = useState(false);
  const [screen, setScreen] = useState<{ deviceId: string; url: string } | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const connectedDeviceId = useAppStore((state) => state.bridge.connected ? state.bridge.deviceId : null);

  useEffect(() => {
    setScreen(null);
    setScreenError(null);
    if (!showScreen) return;
    if (!isTauri() || !connectedDeviceId) {
      setScreenError(translateCurrent("runtime.phoneBridgeUnavailable"));
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let currentUrl: string | null = null;
    let resumeBlockedUntil = 0;
    /** 500ms 截屏会打满 IPC；2s + 防重叠更稳，画面仍够用 */
    const SCREEN_INTERVAL_MS = 2000;

    const refresh = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (Date.now() < resumeBlockedUntil) return;
      inFlight = true;
      try {
        const bytes = await bridgeInvoke<number[]>("phone_screenshot", { deviceId: deviceId ?? connectedDeviceId });
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "image/png" })
        );
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
        setScreen({ deviceId: connectedDeviceId, url: nextUrl });
        setScreenError(null);
      } catch (error) {
        if (!cancelled) {
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          currentUrl = null;
          setScreen(null);
          setScreenError(String(error));
        }
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const id = window.setInterval(() => void refresh(), SCREEN_INTERVAL_MS);
    let resumeTimer: number | null = null;
    const onResume = () => {
      if (document.hidden) return;
      resumeBlockedUntil = Date.now() + 2500;
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => void refresh(), 2500);
    };
    document.addEventListener("visibilitychange", onResume);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      document.removeEventListener("visibilitychange", onResume);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [showScreen, deviceId, connectedDeviceId]);

  const screenUrl = showScreen && screen && screen.deviceId === connectedDeviceId && (!deviceId || deviceId === connectedDeviceId)
    ? screen.url
    : null;
  return { showScreen, setShowScreen, screenUrl, screenError };
}
