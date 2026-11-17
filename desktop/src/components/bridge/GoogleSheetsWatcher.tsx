import { useEffect } from "react";
import { initializeSheets, refreshAllSheets } from "@/lib/googleSheets";
import { activeFolderSheetIds } from "@/lib/folderSheetBinding";
import { useAppStore } from "@/store/appStore";
import { resumePendingQuickReplySheetSync } from "@/lib/quickReplySheetSync";
import { useI18n } from "@/i18n";
export function GoogleSheetsWatcher() {
  const {t} = useI18n();
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped) { const {settings,chats}=useAppStore.getState(); const active=activeFolderSheetIds(settings,chats.filter(chat=>!chat.isGroup&&!chat.localOnly).map(chat=>chat.id)); void refreshAllSheets(active); resumePendingQuickReplySheetSync(t); } };
    void initializeSheets().then(tick);
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("online", tick);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("online", tick); };
  }, [t]);
  return null;
}
