import { Ban, ChevronDown, ChevronUp, Loader2, MonitorSmartphone, Search } from "lucide-react";
import type { MutableRefObject } from "react";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { getAccountBlocklist, isJidBlocked } from "@/lib/accountWaMeta";
import { resolveSalesStageLabel } from "@/lib/contactWorkflow";
import { cn, displayContactLabel } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/primitives";
import type { AppSettings, AppState } from "@/store/appStore";
import type { WaAccount } from "@/types/account";
import type { ChatPreview, Contact, FollowUp, PhoneDevice } from "@/types/crm";
import { formatFollowDueLabel } from "./chatPanelHelpers";
import { ChatHeaderMoreMenu } from "./ChatHeaderMoreMenu";
import { useI18n } from "@/i18n";

type Props = {
  activeChat: ChatPreview | null;
  activeContact?: Contact;
  activePeerOnline: boolean;
  peerTypingLabel: string | null;
  peerPresenceSubtitle: string | null;
  localOnlyChat: boolean;
  isBaileys: boolean;
  chatConnected: boolean;
  chatAccount?: WaAccount;
  chatAccountId?: string;
  settings: Pick<
    AppSettings,
    | "liveBaileysAccountId"
    | "activeAccountId"
    | "waAccounts"
    | "salesStageLabels"
    | "blocklistByAccountId"
    | "blocklistJids"
  >;
  baileysUi: Pick<AppState["baileysUi"], "connection" | "hasQr" | "userName">;
  activePhone?: PhoneDevice;
  activeFollowUp?: FollowUp;
  followUpTitle?: string;
  menuOpen: boolean;
  exportingChat: boolean;
  searchingContact: boolean;
  needsNameSearch: boolean;
  showScreen: boolean;
  headerMenuRef: MutableRefObject<HTMLDivElement | null>;
  onToggleSearch: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpenGroupInfo: () => void;
  onOpenCrmProfile: () => void;
  onSaveContact: () => void;
  onOpenSearch: () => void;
  onExportChat: () => void;
  onMarkUnread: () => void;
  onTogglePin: () => void;
  onMute: (durationMs: number) => void;
  onUnmute: () => void;
  onCreateFollowUp: () => void;
  onScheduleMessage: () => void;
  onOpenMedia: () => void;
  onOpenNote: () => void;
  onToggleBlock: () => void;
  onSearchContact: () => void;
  onToggleScreen: () => void;
};

export function ChatPanelHeader({
  activeChat,
  activeContact,
  activePeerOnline,
  peerTypingLabel,
  peerPresenceSubtitle,
  localOnlyChat,
  isBaileys,
  chatConnected,
  chatAccount,
  chatAccountId,
  settings,
  baileysUi,
  activePhone,
  activeFollowUp,
  followUpTitle,
  menuOpen,
  exportingChat,
  searchingContact,
  needsNameSearch,
  showScreen,
  headerMenuRef,
  onToggleSearch,
  onToggleMenu,
  onCloseMenu,
  onOpenGroupInfo,
  onOpenCrmProfile,
  onSaveContact,
  onOpenSearch,
  onExportChat,
  onMarkUnread,
  onTogglePin,
  onMute,
  onUnmute,
  onCreateFollowUp,
  onScheduleMessage,
  onOpenMedia,
  onOpenNote,
  onToggleBlock,
  onSearchContact,
  onToggleScreen,
}: Props) {
  const { t } = useI18n();
  const blocked = (() => {
    if (!activeContact || activeContact.isGroup) return false;
    if (activeChat?.isGroup) return false;
    return isJidBlocked(
      getAccountBlocklist(
        settings.blocklistByAccountId,
        chatAccountId ||
          settings.liveBaileysAccountId ||
          settings.activeAccountId ||
          "",
        settings.blocklistJids
      ),
      activeContact.channelAddress || activeContact.phone
    );
  })();

  return (
    <div className="border-b border-zinc-800/90 px-4 py-2">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {activeChat && (
            <Avatar
              name={displayContactLabel(
                activeContact?.name || activeChat.contactName,
                activeContact?.phone,
                activeContact?.channelAddress,
                activeChat.lastMessage,
                { isGroup: !!(activeContact?.isGroup || activeChat.isGroup) }
              )}
              seed={activeContact?.phone || activeChat.contactId}
              src={activeContact?.avatarUrl}
              size="md"
              variant={localOnlyChat ? "saved" : "default"}
              online={activePeerOnline}
              onlineTitle={t("common.online")}
            />
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate text-[13px] font-semibold">
                {activeChat
                  ? displayContactLabel(
                      activeContact?.name || activeChat.contactName,
                      activeContact?.phone,
                      activeContact?.channelAddress,
                      activeChat.lastMessage,
                      {
                        isGroup: !!(activeContact?.isGroup || activeChat.isGroup),
                      }
                    )
                  : t("chat.select")}
              </div>
              {blocked && (
                <button
                  type="button"
                  onClick={onToggleBlock}
                  title={t("chat.blockedHint")}
                  aria-label={t("chat.unblock")}
                  className="flex shrink-0 items-center gap-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-rose-300 transition-colors hover:border-rose-500/60 hover:bg-rose-500/20"
                >
                  <Ban className="h-2.5 w-2.5" />
                  {t("chat.blocked")}
                </button>
              )}
            </div>
            <div
              className={cn(
                "truncate text-2xs",
                peerTypingLabel
                  ? "font-medium text-brand"
                  : peerPresenceSubtitle === "在线"
                    ? "font-medium text-emerald-400/90"
                    : "text-zinc-500"
              )}
            >
              {peerTypingLabel
                ? peerTypingLabel
                : peerPresenceSubtitle
                  ? peerPresenceSubtitle
                  : localOnlyChat
                    ? t("chat.localOnly")
                    : isBaileys
                      ? chatConnected
                        ? t("chat.connectedVia", { account: formatAccountDisplay({
                            label: chatAccount?.label,
                            userName:
                              chatAccount?.userName ||
                              (chatAccountId ===
                              settings.liveBaileysAccountId
                                ? baileysUi.userName
                                : null),
                            index1:
                              Math.max(
                                0,
                                (settings.waAccounts || []).findIndex(
                                  (a) => a.id === chatAccountId
                                )
                              ) + 1 || 1,
                        }) })
                        : t("chat.notScanned")
                      : activePhone
                        ? `${activePhone.name} · ${activePhone.remark}`
                        : t("chat.noBoundPhone")}
              {!peerPresenceSubtitle &&
              !peerTypingLabel &&
              activeContact?.company
                ? ` · ${activeContact.company}`
                : ""}
            </div>
          </div>
        </div>
        {activeContact && (
          <div className="hidden min-w-0 flex-1 items-center gap-1.5 self-center overflow-hidden lg:flex">
            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-50 dark:border-amber-400/35 dark:bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300 shadow-2xs">
              {t("chat.stage")} · {resolveSalesStageLabel(activeContact.stage, settings.salesStageLabels)}
            </span>
            {activeFollowUp && (
              <span
                className="max-w-56 truncate rounded-full border border-sky-500/30 bg-sky-50 dark:border-sky-400/35 dark:bg-sky-950/60 px-2.5 py-0.5 text-[11px] font-bold text-sky-800 dark:text-sky-300 shadow-2xs"
                title={
                  activeFollowUp.note
                    ? `${activeFollowUp.note}\n${formatFollowDueLabel(activeFollowUp.dueAt)}`
                    : formatFollowDueLabel(activeFollowUp.dueAt)
                }
              >
                {followUpTitle || t("chat.followUp")} ·{" "}
                {formatFollowDueLabel(activeFollowUp.dueAt)}
              </span>
            )}
            {activeContact.tags[0] && (
              <span className="max-w-32 truncate rounded-full border border-emerald-500/30 bg-emerald-50 dark:border-emerald-400/35 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 shadow-2xs">
                {activeContact.tags[0]}
              </span>
            )}
          </div>
        )}
        {localOnlyChat && <div className="min-w-0 flex-1" />}
        <div className="flex shrink-0 items-center gap-1.5">
          {activeChat && (
            <Button
              variant="secondary"
              className="!min-h-7 !w-7 shrink-0 !px-0"
              onClick={onToggleSearch}
              title={t("chat.searchCurrent")}
              aria-label={t("chat.searchCurrent")}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* 对齐官方：次要操作收进 ⋯ 菜单，避免「拉黑」常驻顶栏 */}
          {activeChat && (
            <ChatHeaderMoreMenu
              chat={activeChat}
              contact={activeContact}
              localOnlyChat={localOnlyChat}
              isBaileys={isBaileys}
              chatAccountId={chatAccountId}
              settings={settings}
              open={menuOpen}
              exporting={exportingChat}
              menuRef={headerMenuRef}
              onToggle={onToggleMenu}
              onClose={onCloseMenu}
              onOpenGroupInfo={onOpenGroupInfo}
              onOpenCrmProfile={onOpenCrmProfile}
              onSaveContact={onSaveContact}
              onOpenSearch={onOpenSearch}
              onMarkUnread={onMarkUnread}
              onTogglePin={onTogglePin}
              onMute={onMute}
              onUnmute={onUnmute}
              onExport={onExportChat}
              onCreateFollowUp={onCreateFollowUp}
              onScheduleMessage={onScheduleMessage}
              onOpenMedia={onOpenMedia}
              onOpenNote={onOpenNote}
              onToggleBlock={onToggleBlock}
            />
          )}
          {needsNameSearch && (
            <Button
              variant="secondary"
              className="!min-h-7 shrink-0 gap-1 !px-2 text-2xs"
              disabled={searchingContact}
              onClick={onSearchContact}
              title={t("chat.searchNameTitle")}
            >
              {searchingContact ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" />
              )}
              {t("chat.searchName")}
            </Button>
          )}
          {!isBaileys && (
            <Button
              variant="secondary"
              className="!min-h-7 shrink-0 gap-1 !px-2 text-2xs"
              onClick={onToggleScreen}
            >
              <MonitorSmartphone className="h-3 w-3" />
              {showScreen ? t("chat.collapseScreen") : t("chat.phoneScreen")}
              {showScreen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
