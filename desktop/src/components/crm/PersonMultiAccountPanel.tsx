/**
 * 客户多号作战条：时间线摘要 + 撞单提示。
 * 逻辑在 personThreads.ts，此处只负责展示与切换回调。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch,
  Merge,
  MessageCircle,
  Plus,
  Star,
} from "lucide-react";
import {
  accountOnlineMap,
  buildPersonThreadRows,
  findSiblingContacts,
  resolvePersonKeyForContact,
  type PersonThreadRow,
} from "@/lib/personThreads";
import { formatAccountDisplay } from "@/lib/accountLabels";
import {
  getPersonPrimaryAccount,
  setPersonPrimaryAccount,
} from "@/lib/internalNotes";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { WaAccount } from "@/types/account";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import { SectionLabel } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

type Props = {
  seed: Contact | null | undefined;
  /** 省略时内部从 store 取，避免父组件订全表 chats/contacts */
  contacts?: Contact[];
  chats?: ChatPreview[];
  /** 省略时内部按 person 从 store 取，避免父组件订阅整表 messages */
  messages?: Message[];
  selectedContactId?: string | null;
  selectedChatId?: string | null;
  focusAccountId?: string | null;
  waAccounts?: WaAccount[];
  liveBaileysAccountId?: string | null;
  liveConnection?: string;
  /** 紧凑条（聊天顶/底）；完整卡（CRM 侧栏） */
  variant?: "banner" | "card";
  onOpenThread: (row: PersonThreadRow) => void;
  /** 从未往来时，直接为当前空会话选择发送账号。 */
  onSelectStartAccount?: (accountId: string) => void;
};

function labelOf(
  accountId: string,
  waAccounts: WaAccount[] | undefined
): string {
  const accounts = waAccounts || [];
  const acc = accounts.find((a) => a.id === accountId);
  const idx = Math.max(0, accounts.findIndex((a) => a.id === accountId)) + 1 || 1;
  return formatAccountDisplay({
    label: acc?.label,
    userName: acc?.userName,
    index1: idx,
  });
}

function formatShortAt(iso: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function PersonMultiAccountPanel({
  seed,
  contacts: contactsProp,
  chats: chatsProp,
  messages: messagesProp,
  selectedContactId,
  selectedChatId,
  focusAccountId,
  waAccounts,
  liveBaileysAccountId,
  liveConnection,
  variant = "card",
  onOpenThread,
  onSelectStartAccount,
}: Props) {
  const { t } = useI18n();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const mergeContacts = useAppStore((s) => s.mergeContacts);
  const requestConfirm = useAppStore((s) => s.requestConfirm);
  const storeContacts = useAppStore((s) =>
    contactsProp ? undefined : s.contacts
  );
  const storeChats = useAppStore((s) => (chatsProp ? undefined : s.chats));
  const contacts = contactsProp || storeContacts || [];
  const chats = chatsProp || storeChats || [];

  const siblings = useMemo(
    () => findSiblingContacts(contacts, seed),
    [contacts, seed]
  );

  const personKey = useMemo(
    () => resolvePersonKeyForContact(seed),
    [seed]
  );
  const primaryAccountId = getPersonPrimaryAccount(
    settings.personPrimaryAccountByKey,
    personKey
  );

  const siblingChatIds = useMemo(() => {
    const contactIds = new Set(siblings.map((contact) => contact.id));
    const ids = new Set(
      chats
        .filter((chat) => contactIds.has(chat.contactId))
        .map((chat) => chat.id)
    );
    for (const contactId of contactIds) ids.add(`bridge-chat-${contactId}`);
    return ids;
  }, [chats, siblings]);

  const messagesStableRef = useRef<Message[]>([]);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [accountMenuOpen]);

  const messagesFromStore = useAppStore((s) => {
    if (messagesProp) return messagesProp;
    if (siblingChatIds.size === 0) {
      if (messagesStableRef.current.length === 0) return messagesStableRef.current;
      const empty: Message[] = [];
      messagesStableRef.current = empty;
      return empty;
    }
    const matched: Message[] = [];
    for (const chatId of siblingChatIds) {
      const bucket = s.messagesByChatId[chatId];
      if (bucket?.length) matched.push(...bucket);
    }
    const prev = messagesStableRef.current;
    if (
      prev.length === matched.length &&
      prev.every((m, i) => m === matched[i])
    ) {
      return prev;
    }
    messagesStableRef.current = matched;
    return matched;
  });
  const messages = messagesProp ?? messagesFromStore;

  const rows = useMemo(
    () =>
      buildPersonThreadRows({
        contacts,
        chats,
        messages,
        seed,
        selectedContactId,
        selectedChatId,
        focusAccountId,
      }),
    [
      contacts,
      chats,
      messages,
      seed,
      selectedContactId,
      selectedChatId,
      focusAccountId,
    ]
  );

  const setPrimary = (accountId: string, clear = false) => {
    if (!personKey) {
      pushToast(t("multiAccount.noPersonKey"), "error");
      return;
    }
    updateSettings({
      personPrimaryAccountByKey: setPersonPrimaryAccount(
        settings.personPrimaryAccountByKey,
        personKey,
        clear ? "" : accountId
      ),
    });
    pushToast(
      clear
        ? t("multiAccount.primaryCleared")
        : t("multiAccount.primaryAssigned", { name: labelOf(accountId, waAccounts) }),
      "success"
    );
  };

  const tryMerge = async () => {
    if (!seed || siblings.length < 2) return;
    const drops = siblings.filter((s) => s.id !== seed.id);
    const ok = await requestConfirm({
      title: t("crm.mergeContactsTitle", { count: drops.length }),
      description: t("crm.mergeContactsDescription", {
        count: drops.length,
        name: seed.name || seed.phone,
      }),
      confirmLabel: t("crm.mergeContacts"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!ok) return;
    const done = mergeContacts(seed.id, drops.map((d) => d.id));
    pushToast(
      done
        ? t("multiAccount.merged", { count: drops.length + 1 })
        : t("multiAccount.mergeFailed"),
      done ? "success" : "error"
    );
  };

  const online = useMemo(
    () =>
      accountOnlineMap(
        waAccounts,
        liveBaileysAccountId || undefined,
        liveConnection
      ),
    [waAccounts, liveBaileysAccountId, liveConnection]
  );

  if (
    variant === "banner" &&
    onSelectStartAccount &&
    (waAccounts?.length || 0) > 1
  ) {
    const rowByAccount = new Map(rows.map((row) => [row.accountId, row]));
    const visibleAccounts = (waAccounts || []).slice(0, 4);
    const overflowAccounts = (waAccounts || []).slice(4);
    const openAccount = (account: WaAccount) => {
      const row = rowByAccount.get(account.id);
      if (row) {
        if (!row.active) onOpenThread(row);
      } else {
        onSelectStartAccount(account.id);
      }
    };
    const accountButton = (account: WaAccount, compact = false) => {
      const row = rowByAccount.get(account.id);
      const hasConversation = Boolean(row);
      const active = account.id === focusAccountId;
      return (
        <button
          key={account.id}
          type="button"
          title={`${labelOf(account.id, waAccounts)} · ${hasConversation ? t("multiAccount.existingChat") : t("multiAccount.startChat")}`}
          aria-label={`${labelOf(account.id, waAccounts)}, ${hasConversation ? t("multiAccount.existingChat") : t("multiAccount.startChat")}`}
          onClick={() => openAccount(account)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full text-[11px] transition-colors",
            compact ? "w-full justify-start px-2 py-1.5" : "max-w-[11rem] px-2 py-1",
            active
              ? "bg-brand/15 font-medium text-brand ring-1 ring-brand/30"
              : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
          )}
        >
          <span className="relative shrink-0">
            <Avatar
              name={account.userName || account.label || account.id}
              seed={account.id}
              src={account.avatarUrl}
              size="sm"
              className="!h-[18px] !w-[18px] !text-[8px]"
            />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-zinc-950",
                online[account.id] ? "bg-brand" : "bg-zinc-600"
              )}
            />
          </span>
          <span className="min-w-0 truncate">{labelOf(account.id, waAccounts)}</span>
          {hasConversation ? (
            <MessageCircle className="h-3 w-3 shrink-0 text-brand/80" />
          ) : (
            <Plus className="h-3 w-3 shrink-0 text-zinc-600" />
          )}
        </button>
      );
    };

    return (
      <div className="shrink-0 border-t border-zinc-800/60 bg-zinc-950/90 px-3 py-1.5">
        <div className="relative flex max-w-full items-center gap-1.5 overflow-x-auto">
          <span className="mr-1 shrink-0 text-[11px] text-zinc-500">{t("multiAccount.sendAccount")}</span>
          {visibleAccounts.map((account) => accountButton(account))}
          {overflowAccounts.length > 0 && (
            <div ref={accountMenuRef} className="relative shrink-0">
              <button
                type="button"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((open) => !open)}
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200"
              >
                {t("multiAccount.moreAccounts", { count: overflowAccounts.length })}
              </button>
              {accountMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-1 min-w-[12rem] rounded-lg border border-zinc-700/80 bg-zinc-900 p-1 shadow-xl shadow-black/30"
                >
                  {overflowAccounts.map((account) => accountButton(account, true))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 单号不展示
  if (rows.length < 2) return null;

  if (variant === "banner") {
    return (
      <div className="shrink-0 border-t border-zinc-800/60 bg-zinc-950/90 px-3 py-1.5">
        <div
          className="flex max-w-full items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label={t("multiAccount.chatAria")}
        >
          {rows.map((row) => {
            const account = waAccounts?.find(
              (item) => item.id === row.accountId
            );
            return (
              <button
                key={row.accountId}
                type="button"
                role="tab"
                aria-selected={row.active}
                title={row.lastMessage || labelOf(row.accountId, waAccounts)}
                onClick={() => {
                  if (!row.active) onOpenThread(row);
                }}
                className={cn(
                  "inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  row.active
                    ? "bg-brand/15 font-medium text-brand ring-1 ring-brand/30"
                    : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
                )}
              >
                <Avatar
                  name={account?.userName || account?.label || row.accountId}
                  seed={row.accountId}
                  src={account?.avatarUrl}
                  size="sm"
                  className="!h-[18px] !w-[18px] !text-[8px]"
                />
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    online[row.accountId] ? "bg-brand" : "bg-zinc-600"
                  )}
                />
                <span className="truncate">
                  {labelOf(row.accountId, waAccounts)}
                </span>
                {row.unread > 0 && (
                  <span className="rounded-full bg-brand/25 px-1 text-2xs tabular-nums text-brand">
                    {row.unread > 99 ? "99+" : row.unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // card：CRM 侧栏
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5 text-brand" />
        <SectionLabel>{t("multiAccount.timeline", { count: rows.length })}</SectionLabel>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {siblings.length >= 2 && (
            <button
              type="button"
              title={t("crm.mergeContacts")}
              onClick={() => void tryMerge()}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-2xs text-zinc-400 transition-colors hover:border-brand/40 hover:text-brand"
            >
              <Merge className="h-3 w-3" />
              {t("crm.mergeContacts")}
            </button>
          )}
        </div>
      </div>

      <ol className="space-y-1">
        {rows.map((row) => {
          const isPrimary = primaryAccountId === row.accountId;
          return (
            <li key={row.accountId} className="flex items-stretch gap-0.5">
              <button
                type="button"
                onClick={() => onOpenThread(row)}
                className={cn(
                  "flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                  row.active
                    ? "bg-brand/10 ring-1 ring-brand/25"
                    : "hover:bg-zinc-900/80"
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    online[row.accountId] ? "bg-brand" : "bg-zinc-600"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-zinc-100">
                      {labelOf(row.accountId, waAccounts)}
                      {row.active ? (
                        <span className="ml-1 text-2xs font-normal text-brand">
                          {t("multiAccount.current")}
                        </span>
                      ) : null}
                      {isPrimary ? (
                        <span className="ml-1 text-2xs font-normal text-amber-300">
                          {t("multiAccount.primary")}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-2xs tabular-nums text-zinc-600">
                      {formatShortAt(row.lastAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">
                    {row.lastDirection === "out" ? t("multiAccount.mePrefix") : ""}
                    {row.lastMessage || t("multiAccount.noMessages")}
                  </p>
                </div>
                {row.unread > 0 && (
                  <span className="mt-0.5 rounded-full bg-brand/20 px-1.5 text-2xs tabular-nums text-brand">
                    {row.unread}
                  </span>
                )}
              </button>
              <button
                type="button"
                title={isPrimary ? t("multiAccount.removePrimary") : t("multiAccount.setPrimary")}
                onClick={(e) => {
                  e.stopPropagation();
                  setPrimary(row.accountId, isPrimary);
                }}
                className={cn(
                  "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  isPrimary
                    ? "text-amber-300"
                    : "text-zinc-600 hover:bg-zinc-900 hover:text-amber-200"
                )}
              >
                <Star
                  className={cn("h-3.5 w-3.5", isPrimary && "fill-amber-300")}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
