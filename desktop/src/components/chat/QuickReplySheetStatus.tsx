import type { SettingsQuickReply } from "@/store/settingsDefaults";
import { scheduleQuickReplySheetSync } from "@/lib/quickReplySheetSync";
import { useI18n } from "@/i18n";

export function QuickReplySheetStatus({reply}: {reply: SettingsQuickReply}) {
  const {t} = useI18n();
  if (!reply.sheetLink?.syncPending && !reply.sheetLink?.syncError) return null;
  return <button type="button" className="shrink-0 text-[10px] text-amber-500" title={reply.sheetLink.syncError}
    onClick={event => { event.stopPropagation(); scheduleQuickReplySheetSync(reply.id, t); }}>
    {t(reply.sheetLink.syncError ? "quickLibrary.sheetRetry" : "quickLibrary.sheetPending")}
  </button>;
}
