import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { runAutomaticBackup } from "@/lib/automaticBackup";
import { isComposerTypingBusy } from "@/lib/composerActivity";
import { useI18n } from "@/i18n";

export function AutomaticBackupWatcher() {
  const { t } = useI18n();
  useEffect(() => {
    let stopped = false;
    let lastErrorAt = 0;
    const run = async () => {
      if (stopped || isComposerTypingBusy()) return;
      try { await runAutomaticBackup(useAppStore.getState); }
      catch (error) {
        if (!stopped && Date.now() - lastErrorAt > 3600_000) {
          lastErrorAt = Date.now();
          useAppStore.getState().pushToast(`${t("backup.failed")}：${String(error)}`, "error");
        }
      }
    };
    void run();
    const timer = setInterval(() => void run(), 15 * 60_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [t]);
  return null;
}
