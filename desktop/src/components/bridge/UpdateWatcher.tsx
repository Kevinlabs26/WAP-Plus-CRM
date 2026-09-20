import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { checkForAppUpdate } from "@/lib/appUpdate";
import { useI18n } from "@/i18n";

const UPDATE_CHECK_DELAY_MS = 12_000;

/** 启动后静默检查一次；下载和安装必须由用户主动确认。 */
export function UpdateWatcher() {
  const pushToast = useAppStore((state) => state.pushToast);
  const setUpdateAvailableVersion = useAppStore((state) => state.setUpdateAvailableVersion);
  const { t } = useI18n();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForAppUpdate()
        .then((update) => {
          setUpdateAvailableVersion(update?.version || null);
          if (update) {
            pushToast(t("updates.found", { version: update.version }), "info");
          }
        })
        .catch((error) => {
          console.warn("[updater] automatic check failed", error);
        });
    }, UPDATE_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pushToast, setUpdateAvailableVersion, t]);

  return null;
}
