import {
  Ban,
  BellOff,
  BellRing,
  CalendarPlus,
  Clock3,
  ChevronRight,
  Download,
  Images,
  Loader2,
  Mail,
  MoreVertical,
  Pin,
  PinOff,
  Search,
  StickyNote,
  UserRound,
  UserPlus,
  Users,
} from "lucide-react";
import { useState, type MutableRefObject } from "react";
import { getAccountBlocklist, isJidBlocked } from "@/lib/accountWaMeta";
import { Button } from "@/components/ui/primitives";
import type { AppSettings } from "@/store/appStore";
import type { ChatPreview, Contact } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  chat: ChatPreview;
  contact?: Contact;
  localOnlyChat: boolean;
  isBaileys: boolean;
  chatAccountId?: string;
  settings: Pick<
    AppSettings,
    | "liveBaileysAccountId"
    | "activeAccountId"
    | "blocklistByAccountId"
    | "blocklistJids"
  >;
  open: boolean;
  exporting: boolean;
  menuRef: MutableRefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onOpenGroupInfo: () => void;
  onOpenCrmProfile: () => void;
  onSaveContact: () => void;
  onOpenSearch: () => void;
  onMarkUnread: () => void;
  onTogglePin: () => void;
  onMute: (durationMs: number) => void;
  onUnmute: () => void;
  onExport: () => void;
  onCreateFollowUp: () => void;
  onScheduleMessage: () => void;
  onOpenMedia: () => void;
  onOpenNote: () => void;
  onToggleBlock: () => void;
};

const itemClass =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50";

export function ChatHeaderMoreMenu(props: Props) {
  const { t } = useI18n();
  const [muteOpen, setMuteOpen] = useState(false);
  const { chat, contact } = props;
  const isGroup = Boolean(contact?.isGroup || chat.isGroup);
  const directContact = !isGroup ? contact : undefined;
  const muted = typeof chat.mutedUntil === "number" && chat.mutedUntil > Date.now();
  const fire = (action: () => void) => {
    props.onClose();
    action();
  };

  return (
    <div className="relative" ref={props.menuRef}>
      <Button
        variant="secondary"
        className="!min-h-7 !w-7 shrink-0 !px-0"
        onClick={props.onToggle}
        title={t("chat.more")}
        aria-label={t("chat.more")}
        aria-expanded={props.open}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </Button>
      {props.open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[80] mt-1 max-h-[min(70vh,28rem)] min-w-[12rem] overflow-y-auto rounded-xl border border-zinc-700/90 bg-zinc-900 py-1 shadow-xl shadow-black/50"
        >
          {isGroup && (
            <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onOpenGroupInfo)}>
              <Users className="h-3.5 w-3.5 text-zinc-400" />{t("chat.groupInfo")}
            </button>
          )}
          {directContact && (
            <>
              <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onSaveContact)}>
                <UserPlus className="h-3.5 w-3.5 text-zinc-400" />{t("chat.saveContact")}
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onOpenCrmProfile)}>
                <UserRound className="h-3.5 w-3.5 text-zinc-400" />{t("chat.customerDetails")}
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onCreateFollowUp)}>
                <CalendarPlus className="h-3.5 w-3.5 text-zinc-400" />{t("chat.createFollowUp")}
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onOpenNote)}>
                <StickyNote className="h-3.5 w-3.5 text-zinc-400" />{t("chat.customerNote")}
              </button>
            </>
          )}
          {!props.localOnlyChat && (
            <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onScheduleMessage)}>
              <Clock3 className="h-3.5 w-3.5 text-zinc-400" />{t("chat.schedule")}
            </button>
          )}
          <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onOpenSearch)}>
            <Search className="h-3.5 w-3.5 text-zinc-400" />{t("chat.searchMessages")}
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onOpenMedia)}>
            <Images className="h-3.5 w-3.5 text-zinc-400" />{t("chat.mediaFiles")}
          </button>
          {!props.localOnlyChat && (
            <>
              <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onMarkUnread)}>
                <Mail className="h-3.5 w-3.5 text-zinc-400" />{t("chat.markUnread")}
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onTogglePin)}>
                {chat.pinned ? <PinOff className="h-3.5 w-3.5 text-zinc-400" /> : <Pin className="h-3.5 w-3.5 text-zinc-400" />}
                {chat.pinned ? t("chat.unpin") : t("chat.pin")}
              </button>
              {muted ? (
                <button type="button" role="menuitem" className={itemClass} onClick={() => fire(props.onUnmute)}>
                  <BellRing className="h-3.5 w-3.5 text-zinc-400" />{t("chat.unmute")}
                </button>
              ) : (
                <>
                  <button type="button" role="menuitem" className={itemClass} onClick={() => setMuteOpen((open) => !open)}>
                    <BellOff className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="flex-1">{t("chat.mute")}</span>
                    <ChevronRight className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${muteOpen ? "rotate-90" : ""}`} />
                  </button>
                  {muteOpen && (
                    <div className="border-y border-zinc-800 bg-zinc-950/60 py-1 pl-5">
                      {[
                        [8 * 60 * 60 * 1000, t("chat.hours8")],
                        [7 * 24 * 60 * 60 * 1000, t("chat.days7")],
                        [100 * 365 * 24 * 60 * 60 * 1000, t("chat.forever")],
                      ].map(([duration, label]) => (
                        <button key={label} type="button" role="menuitem" className={itemClass} onClick={() => fire(() => props.onMute(Number(duration)))}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={props.exporting}
            onClick={() => fire(props.onExport)}
          >
            {props.exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
            ) : (
              <Download className="h-3.5 w-3.5 text-zinc-400" />
            )}
            {props.exporting ? t("chat.exporting") : t("chat.export")}
          </button>
          {props.isBaileys && directContact && (
            <>
              <div className="my-1 border-t border-zinc-800" />
              <button
                type="button"
                role="menuitem"
                className={`${itemClass} text-rose-300 hover:bg-rose-500/10`}
                onClick={() => fire(props.onToggleBlock)}
              >
                <Ban className="h-3.5 w-3.5" />
                {isJidBlocked(
                  getAccountBlocklist(
                    props.settings.blocklistByAccountId,
                    props.chatAccountId ||
                      props.settings.liveBaileysAccountId ||
                      props.settings.activeAccountId ||
                      "",
                    props.settings.blocklistJids
                  ),
                  directContact.channelAddress || directContact.phone
                )
                  ? t("chat.unblockContact")
                  : t("chat.blockContact")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
