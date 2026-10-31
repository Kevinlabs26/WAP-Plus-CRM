import { X, Zap } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { emitQuickReplyMedia } from "@/lib/quickReplyMedia";
import { QuickReplyBrowser } from "@/components/chat/QuickReplyBrowser";
import { resolveWaSendAccountId } from "@/lib/accountConnection";
import { formatAccountDisplay } from "@/lib/accountLabels";

export function MultiWindowQuickReplies({ chatId, onPick, onClose, variant = "popover", title }: {
  chatId: string;
  onPick: (text: string) => void;
  onClose?: () => void;
  variant?: "popover" | "panel";
  title?: string;
}) {
  const { t } = useI18n();
  const settings = useAppStore(s => s.settings);
  const chat = useAppStore(s => s.chats.find(item => item.id === chatId));
  const contact = useAppStore(s => s.contacts.find(item => item.id === chat?.contactId));
  const device = useAppStore(s => s.phones.find(item => item.id === chat?.phoneId));
  const connection = useAppStore(s => s.baileysUi.connection);
  const togglePin = useAppStore(s => s.toggleQuickReplyPin);
  const recordUsage = useAppStore(s => s.recordQuickReplyUsage);
  const accountId = resolveWaSendAccountId(settings.waAccounts, chat?.accountId || contact?.accountId || settings.liveBaileysAccountId || settings.activeAccountId, settings.liveBaileysAccountId, connection)
    || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default";
  const account = settings.waAccounts?.find(item => item.id === accountId);
  const identity = settings.sendChannel === "android_bridge"
    ? t("quickShelf.device", { device: device?.name || chat?.phoneId || t("quickShelf.unknownAccount") })
    : account ? formatAccountDisplay(account) : accountId;
  const isPanel = variant === "panel";
  return <div className={isPanel ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-zinc-950" : "absolute bottom-full left-0 z-30 mb-1.5 flex h-[420px] max-h-[70vh] w-72 flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-xl"}>
    <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
      <Zap aria-hidden="true" className="h-4 w-4 shrink-0 text-brand" />
      <div className="min-w-0 flex-1"><h3 className="text-xs font-medium text-zinc-200">{t("multi.quickReplies")}</h3>{title && <p className="truncate text-2xs text-zinc-500">{t("multi.appendTo", { title })}</p>}</div>
      {onClose && <button type="button" onClick={onClose} aria-label={t("multi.closeQuickReplies")} className="rounded p-1 text-zinc-500 hover:bg-zinc-800"><X aria-hidden="true" className="h-4 w-4" /></button>}
    </header>
    <QuickReplyBrowser replies={settings.quickReplies || []} categories={settings.quickReplyCustomCategories || []}
      contextKey={["multi", chatId, accountId, settings.sendChannel, chat?.phoneId].join(":")} compact={!isPanel} disabled={!chat}
      target={chat ? { title: title || chat.contactName || contact?.name || chat.id, account: identity } : undefined}
      pinnedIds={settings.quickReplyPinnedIds} recentIds={settings.quickReplyRecentIds} onTogglePin={togglePin} onUsed={recordUsage}
      onInsert={reply => {
        if (!useAppStore.getState().chats.some(item => item.id === chatId)) return false;
        if (reply.media) {
          const accepted = emitQuickReplyMedia({ ...reply.media, caption: reply.body,
            token: reply.id + "-" + Date.now(), target: "multi", chatId });
          if (!accepted) { useAppStore.getState().pushToast(t("quickShelf.insertUnavailable"), "info"); return false; }
          onPick("");
        } else onPick(reply.body);
      }} />
  </div>;
}
