import { useMemo } from "react";
import { Search, Users, Smartphone, RefreshCw } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { chatInView } from "@/store/accountScope";
import { SAVED_MESSAGES_CHAT_ID } from "@/types/crm";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

export function ChatWelcome() {
  const { t } = useI18n();
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setBaileysLoginOpen = useAppStore((s) => s.setBaileysLoginOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const connection = useAppStore((s) => s.baileysUi.connection);
  const bridgeConnected = useAppStore((s) => s.bridge.connected);
  const sendChannel = useAppStore((s) => s.settings.sendChannel);
  const waAccounts = useAppStore((s) => s.settings.waAccounts);
  const view = useAppStore((s) => s.settings.accountViewMode);
  const liveAccountId = useAppStore(
    (s) => s.settings.liveBaileysAccountId || s.settings.activeAccountId
  );
  const chats = useAppStore((s) => s.chats);
  const hasChats = useMemo(() => chats.some(
    (chat) => chat.id !== SAVED_MESSAGES_CHAT_ID && chatInView(chat, view || { type: "all" }, undefined, liveAccountId)
  ), [chats, view, liveAccountId]);
  const isBaileys = sendChannel !== "android_bridge";
  const connected = isBaileys
    ? view?.type === "account"
      ? isWaAccountConnected(waAccounts, view.accountId, liveAccountId, connection)
      : waAccounts.length > 0
        ? waAccounts.some((account) => isWaAccountConnected(waAccounts, account.id, liveAccountId, connection))
        : connection === "connected"
    : bridgeConnected;
  const waitingForPhone = connected && !isBaileys && !hasChats;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-zinc-950 px-6 py-8">
      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <WapPlusMark sizeClassName="mb-6 h-16 w-16 rounded-2xl" />
        <h2 className="text-[22px] font-semibold text-zinc-100">
          {t(!connected ? "welcome.connectTitle" : hasChats ? "welcome.selectTitle" : waitingForPhone ? "welcome.bridgeEmptyTitle" : "welcome.emptyTitle")}
        </h2>
        <p className="mt-3 max-w-md text-[14px] leading-6 text-zinc-400">
          {t(!connected ? "welcome.offlineDescription" : hasChats ? "welcome.description" : waitingForPhone ? "welcome.bridgeEmptyDescription" : "welcome.emptyDescription")}
        </p>
        <Button
          variant="primary"
          className="mt-6 min-h-10 gap-2 px-5"
          onClick={() => {
            if (!connected && isBaileys) setBaileysLoginOpen(true);
            else if (waitingForPhone) setActiveNav("crm");
            else if (!connected || !hasChats) setSettingsOpen(true, "connection");
            else setCommandOpen(true);
          }}
        >
          {!connected ? <Smartphone className="h-4 w-4" /> : hasChats ? <Search className="h-4 w-4" /> : waitingForPhone ? <Users className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          {t(!connected ? "welcome.connectWhatsApp" : hasChats ? "welcome.search" : waitingForPhone ? "welcome.crm" : "welcome.manageConnection")}
        </Button>
        {!waitingForPhone && <button type="button" onClick={() => setActiveNav("crm")}
          className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-[13px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
          <Users className="h-4 w-4" />
          {t("welcome.crm")}
        </button>}
      </div>
    </div>
  );
}
