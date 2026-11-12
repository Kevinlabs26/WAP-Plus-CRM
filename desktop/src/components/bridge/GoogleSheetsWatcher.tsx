import { useEffect } from "react";
import { initializeSheets, refreshAllSheets } from "@/lib/googleSheets";
import { resumePendingQuickReplySheetSync } from "@/lib/quickReplySheetSync";
import { useI18n } from "@/i18n";
export function GoogleSheetsWatcher() {
  const {t} = useI18n();
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped) { void refreshAllSheets(); resumePendingQuickReplySheetSync(t); } };
    void initializeSheets().then(tick);
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("online", tick);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("online", tick); };
  }, [t]);
  return null;
}
