import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { checkForAppUpdate } from "@/lib/appUpdate";
import { useI18n } from "@/i18n";

const UPDATE_CHECK_DELAY_MS = 12_000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

/** 启动后静默检查一次；下载和安装必须由用户主动确认。 */
export function UpdateWatcher() {
  const pushToast = useAppStore((state) => state.pushToast);
  const setUpdateAvailableVersion = useAppStore((state) => state.setUpdateAvailableVersion);
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    const notifiedVersion = { current: "" };
    const check = () => {
      void checkForAppUpdate()
        .then((update) => {
          if (cancelled) return;
          setUpdateAvailableVersion(update?.version || null);
          if (update) {
            if (notifiedVersion.current !== update.version) {
              notifiedVersion.current = update.version;
              pushToast(t("updates.found", { version: update.version }), "info");
            }
          } else {
            notifiedVersion.current = "";
          }
        })
        .catch((error: unknown) => {
          console.warn("[updater] automatic check failed", error);
        });
    };
    const initialTimer = window.setTimeout(check, UPDATE_CHECK_DELAY_MS);
    const interval = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [pushToast, setUpdateAvailableVersion, t]);

  return null;
}
