import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Avatar } from "@/components/ui/Avatar";
import { displayContactLabel, stripWhatsAppFormatting } from "@/lib/utils";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { buildMessageInbox, inboxRelativeTime } from "@/lib/messageInbox";
import { markChatReadRemote } from "@/lib/markChatRead";
import { useI18n } from "@/i18n";

export function MessageInbox({ onOpen }: { onOpen: () => void }) {
  const { t, locale } = useI18n();
  const chats = useAppStore((s) => s.chats);
  const contacts = useAppStore((s) => s.contacts);
  const messagesByChatId = useAppStore((s) => s.messagesByChatId);
  const folders = useAppStore((s) => s.settings.chatFolders);
  const accounts = useAppStore((s) => s.settings.waAccounts);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const unreadChats = useMemo(() => chats.filter((chat) => chat.unread > 0 && !chat.localOnly), [chats]);
  const entries = useMemo(() => open ? buildMessageInbox(unreadChats, messagesByChatId) : [], [open, unreadChats, messagesByChatId]);
  const contactById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const foldersByChatId = useMemo(() => {
    const names = new Map<string, string[]>();
    for (const folder of folders) for (const id of folder.chatIds) {
      names.set(id, [...(names.get(id) || []), folder.name]);
    }
    return names;
  }, [folders]);
  const accountLabels = useMemo(() => new Map(accounts.map((account, index) => [account.id,
    formatAccountDisplay({ label: account.label, userName: account.userName, index1: index + 1 }),
  ])), [accounts]);

  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    closeRef.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return <div ref={rootRef} className="relative" onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={buttonRef} type="button" className="ui-btn-ghost relative !min-h-8 w-8 !px-0"
      aria-label={t("inbox.button", { count: unreadChats.length })} title={t("inbox.title")}
      aria-expanded={open} aria-haspopup="dialog" aria-controls="message-inbox"
      onClick={() => { if (!open) onOpen(); setOpen((value) => !value); }}>
      <Bell className="h-4 w-4" />
      {unreadChats.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-2xs font-semibold text-white" aria-hidden>
        {unreadChats.length > 99 ? "99+" : unreadChats.length}
      </span>}
    </button>
    {open && <section id="message-inbox" role="dialog" aria-labelledby="message-inbox-title"
      className="fixed inset-x-3 top-24 z-50 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[26rem]">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div><h2 id="message-inbox-title" className="text-sm font-semibold text-zinc-100">{t("inbox.title")}
          <span className="ml-2 text-xs font-normal text-zinc-400">{t("inbox.count", { count: unreadChats.length })}</span>
        </h2><p className="mt-1 text-xs text-zinc-400">{t("inbox.hint")}</p></div>
        <button ref={closeRef} type="button" className="ui-btn-ghost !min-h-8 w-8 shrink-0 !px-0" aria-label={t("inbox.close")} onClick={close}><X className="h-4 w-4" /></button>
      </div>
      <ul className="max-h-[min(65vh,32rem)] overflow-y-auto overscroll-contain p-1">
        {entries.map(({ chat, message, body, sentAt }) => {
          const contact = contactById.get(chat.contactId);
          const name = displayContactLabel(contact?.name || chat.contactName, contact?.phone, contact?.channelAddress, undefined, { isGroup: chat.isGroup || contact?.isGroup });
          const accountId = chat.accountId || chat.phoneId || contact?.accountId || "";
          const time = inboxRelativeTime(sentAt, now, locale);
          const preview = stripWhatsAppFormatting(body).replace(/\s+/g, " ").trim() || t("inbox.newMessage");
          const source = [...(foldersByChatId.get(chat.id) || [t("folder.ungrouped")]), accountLabels.get(accountId) || accountId].filter(Boolean).join(" · ");
          return <li key={chat.id}><button type="button" className="flex w-full gap-3 rounded-lg px-3 py-3 text-left hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            onClick={() => {
              const state = useAppStore.getState();
              const current = state.chats.find((item) => item.id === chat.id);
              if (!current) { close(); return; }
              if (state.unreadHoldUntilByChatId[current.id]) {
                const holds = { ...state.unreadHoldUntilByChatId };
                delete holds[current.id];
                useAppStore.setState({ unreadHoldUntilByChatId: holds });
              }
              state.goToChats("all");
              state.setSelectedChat(current.id, current.accountId || current.phoneId);
              state.setFocusMessageId(message?.id || null);
              void markChatReadRemote(current, state.contacts.find((item) => item.id === current.contactId));
              close();
            }}>
            <Avatar name={name} seed={contact?.phone || chat.contactId} src={contact?.avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-zinc-100">{name}</span>
                <time dateTime={Number.isFinite(Date.parse(sentAt)) ? sentAt : undefined} title={Number.isFinite(Date.parse(sentAt)) ? new Date(sentAt).toLocaleString(locale) : undefined} className="shrink-0 text-xs text-zinc-400">{time === null ? t("inbox.timeUnknown") : time || t("inbox.justNow")}</time>
              </div>
              <div className="mt-1 flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">{message?.senderName ? `${message.senderName}: ` : ""}{preview}</p>
                <span className="rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand" aria-label={t("inbox.unread", { count: chat.unread })}>{chat.unread > 99 ? "99+" : chat.unread}</span>
              </div>
              <p className="mt-1 truncate text-xs text-zinc-500" title={source}>{source}</p>
            </div>
          </button></li>;
        })}
        {entries.length === 0 && <li className="px-4 py-10 text-center text-sm text-zinc-400">{t("inbox.empty")}</li>}
      </ul>
    </section>}
  </div>;
}
