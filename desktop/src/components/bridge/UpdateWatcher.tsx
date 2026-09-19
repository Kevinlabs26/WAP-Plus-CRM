import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { checkForAppUpdate } from "@/lib/appUpdate";

const UPDATE_CHECK_DELAY_MS = 12_000;

/** 启动后静默检查一次；下载和安装必须由用户主动确认。 */
export function UpdateWatcher() {
  const pushToast = useAppStore((state) => state.pushToast);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForAppUpdate()
        .then((update) => {
          if (update) {
            pushToast(
              `发现新版本 v${update.version}，请到「设置 → 关于与更新」安装`,
              "info"
            );
          }
        })
        .catch((error) => {
          console.warn("[updater] automatic check failed", error);
        });
    }, UPDATE_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pushToast]);

  return null;
}
