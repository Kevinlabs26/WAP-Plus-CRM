import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MessageSquare,
  User,
  Phone,
  CalendarCheck,
  BarChart3,
  Settings,
  FileText,
  Loader2,
  Activity,
  Megaphone,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { Message } from "@/types/crm";

type PaletteItem = {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  kind?: "nav" | "contact" | "chat" | "message" | "followup" | "phone";
  run: () => void | Promise<void>;
};

function snippetOf(m: Message, query: string, mediaFallback: string): string {
  const raw = (m.mediaFileName || m.mediaCaption || m.body || mediaFallback)
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "—";
  const lower = raw.toLowerCase();
  const q = query.toLowerCase();
  const at = lower.indexOf(q);
  if (at < 0) return raw.slice(0, 90);
  const start = Math.max(0, at - 24);
  const end = Math.min(raw.length, at + q.length + 48);
  return `${start > 0 ? "…" : ""}${raw.slice(start, end)}${
    end < raw.length ? "…" : ""
  }`;
}

function scoreMessage(m: Message, query: string): number {
  const body = (m.body || "").toLowerCase();
  const cap = (m.mediaCaption || "").toLowerCase();
  const file = (m.mediaFileName || "").toLowerCase();
  let s = 0;
  if (file.includes(query)) s += 4;
  if (body.startsWith(query)) s += 3;
  else if (body.includes(query)) s += 2;
  if (cap.includes(query)) s += 1;
  // 越新略优先
  const t = Date.parse(m.sentAt || "");
  if (Number.isFinite(t)) s += Math.min(1.5, t / 1e15);
  return s;
}

export function CommandPalette() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.commandOpen);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [diskMessages, setDiskMessages] = useState<Message[]>([]);
  const [diskLoading, setDiskLoading] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  const messages = useAppStore((s) => s.messages);
  const followUps = useAppStore((s) => s.followUps);
  const phones = useAppStore((s) => s.phones);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const goToChats = useAppStore((s) => s.goToChats);
  const setSelectedContact = useAppStore((s) => s.setSelectedContact);
  const setSelectedChat = useAppStore((s) => s.setSelectedChat);
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setFocusMessageId = useAppStore((s) => s.setFocusMessageId);
  const searchMessagesGlobal = useAppStore((s) => s.searchMessagesGlobal);
  const ensureMessageInMemory = useAppStore((s) => s.ensureMessageInMemory);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setDiskMessages([]);
      setDiskLoading(false);
    }
  }, [open]);

  // 防抖：SQLite 全局消息搜索（含冷历史）
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setDiskMessages([]);
      setDiskLoading(false);
      return;
    }
    let cancelled = false;
    setDiskLoading(true);
    const t = window.setTimeout(() => {
      void searchMessagesGlobal(query, 48)
        .then((hits) => {
          if (!cancelled) setDiskMessages(hits);
        })
        .catch(() => {
          if (!cancelled) setDiskMessages([]);
        })
        .finally(() => {
          if (!cancelled) setDiskLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, open, searchMessagesGlobal]);

  const jumpToMessage = async (m: Message) => {
    await ensureMessageInMemory(m.id);
    const state = useAppStore.getState();
    const chat =
      (m.chatId && state.chats.find((c) => c.id === m.chatId)) ||
      state.chats.find((c) => c.contactId && c.contactId === m.contactId);
    const contact =
      (m.contactId && state.contacts.find((c) => c.id === m.contactId)) ||
      (chat?.contactId
        ? state.contacts.find((c) => c.id === chat.contactId)
        : undefined);
    if (contact?.id) {
      openContactWorkspace(contact.id, { focusMessageId: m.id });
    } else if (chat) {
      setSelectedChat(chat.id);
      setSelectedContact(chat.contactId);
      setActiveNav("chats");
      setFocusMessageId(m.id);
    } else if (m.chatId) {
      setSelectedChat(m.chatId);
      setActiveNav("chats");
      setFocusMessageId(m.id);
    }
  };

  const items = useMemo(() => {
    // 关闭时直接短路：避免每次 ingest 后台重建全量候选数组
    if (!open) return [];
    const query = q.trim().toLowerCase();

    const nav: PaletteItem[] = [
      {
        id: "nav-today",
        label: t("palette.open", { target: t("nav.today") }),
        hint: t("palette.workspaceHint"),
        icon: CalendarCheck,
        kind: "nav",
        run: () => setActiveNav("today"),
      },
      {
        id: "nav-chats",
        label: t("palette.open", { target: t("nav.allChats") }),
        hint: t("palette.chatsHint"),
        icon: MessageSquare,
        kind: "nav",
        run: () => goToChats("all"),
      },
      {
        id: "nav-crm",
        label: t("palette.open", { target: t("nav.crm") }),
        hint: t("palette.crmHint"),
        icon: User,
        kind: "nav",
        run: () => setActiveNav("crm"),
      },
      {
        id: "nav-broadcast",
        label: t("palette.open", { target: t("nav.broadcast") }),
        hint: t("palette.broadcastHint"),
        icon: Megaphone,
        kind: "nav",
        run: () => setActiveNav("broadcast"),
      },
      {
        id: "nav-phones",
        label: t("palette.open", { target: t("nav.phones") }),
        hint: t("palette.phonesHint"),
        icon: Phone,
        kind: "nav",
        run: () => setActiveNav("phones"),
      },
      {
        id: "nav-starred",
        label: t("palette.open", { target: t("nav.starred") }),
        hint: t("palette.starredHint"),
        icon: FileText,
        kind: "nav",
        run: () => setActiveNav("starred"),
      },
      {
        id: "nav-stats",
        label: t("palette.open", { target: t("nav.stats") }),
        hint: t("palette.statsHint"),
        icon: BarChart3,
        kind: "nav",
        run: () => setActiveNav("stats"),
      },
      {
        id: "nav-monitor",
        label: t("palette.open", { target: t("nav.monitor") }),
        hint: t("palette.monitorHint"),
        icon: Activity,
        kind: "nav",
        run: () => setActiveNav("monitor"),
      },
      {
        id: "settings",
        label: t("palette.open", { target: t("nav.settings") }),
        hint: t("palette.settingsHint"),
        icon: Settings,
        kind: "nav",
        run: () => setSettingsOpen(true),
      },
    ];

    const contactItems: PaletteItem[] = contacts.map((c) => ({
      id: `c-${c.id}`,
      label: c.name,
      hint: `${c.phone} · ${c.company ?? "—"} · ${c.stage}`,
      icon: User,
      kind: "contact",
      run: () => openContactWorkspace(c.id),
    }));

    const chatItems: PaletteItem[] = chats.map((c) => ({
      id: `ch-${c.id}`,
      label: t("palette.chatLabel", { name: c.contactName }),
      hint: c.lastMessage || t("palette.noMessage"),
      icon: MessageSquare,
      kind: "chat",
      run: () => {
        setSelectedChat(c.id);
        setSelectedContact(c.contactId);
        setActiveNav("chats");
      },
    }));

    const fuItems: PaletteItem[] = followUps
      .filter((f) => !f.done)
      .map((f) => ({
        id: `f-${f.id}`,
        label: t("palette.followupLabel", { name: f.contactName }),
        hint: f.note ?? f.dueAt,
        icon: CalendarCheck,
        kind: "followup",
        run: () => openContactWorkspace(f.contactId),
      }));

    const phoneItems: PaletteItem[] = phones.map((p) => ({
      id: `p-${p.id}`,
      label: p.name,
      hint: `${p.remark} · ${p.online ? t("palette.online") : t("palette.offline")}`,
      icon: Phone,
      kind: "phone",
      run: () => setActiveNav("phones"),
    }));

    const chatById = new Map(chats.map((c) => [c.id, c]));
    const contactById = new Map(contacts.map((c) => [c.id, c]));

    // 消息：合并内存即时结果 + 防抖磁盘结果
    const msgItems: PaletteItem[] = [];
    if (query.length >= 2) {
      const byId = new Map<string, Message>();
      // 内存先扫（即时反馈，不截断过早）
      for (const m of messages) {
        const hay =
          `${m.body || ""} ${m.mediaCaption || ""} ${m.mediaFileName || ""}`.toLowerCase();
        if (!hay.includes(query)) continue;
        byId.set(m.id, m);
      }
      for (const m of diskMessages) {
        if (!m?.id) continue;
        if (!byId.has(m.id)) byId.set(m.id, m);
      }
      const scored = [...byId.values()]
        .map((m) => ({ m, score: scoreMessage(m, query) }))
        .sort((a, b) => b.score - a.score || (b.m.sentAt || "").localeCompare(a.m.sentAt || ""))
        .slice(0, 24);

      for (const { m } of scored) {
        const chat = m.chatId ? chatById.get(m.chatId) : undefined;
        const contact =
          (m.contactId && contactById.get(m.contactId)) ||
          (chat?.contactId ? contactById.get(chat.contactId) : undefined);
        const who =
          contact?.name || chat?.contactName || contact?.phone || t("palette.conversation");
        const when = (m.sentAt || "").slice(0, 16).replace("T", " ");
        msgItems.push({
          id: `m-${m.id}`,
          label: t("palette.messageLabel", { name: who }),
          hint: `${when ? when + " · " : ""}${snippetOf(m, query, t("palette.media"))}`,
          icon: m.mediaType ? FileText : MessageSquare,
          kind: "message",
          run: () => jumpToMessage(m),
        });
      }
    }

    const all = [
      ...nav,
      ...contactItems,
      ...chatItems,
      ...msgItems,
      ...fuItems,
      ...phoneItems,
    ];
    if (!query) return all.slice(0, 14);

    // 有查询时：导航/联系人/会话仍按 label/hint 滤；消息项已按正文筛过
    const filtered = all.filter(
      (i) =>
        i.kind === "message" ||
        i.label.toLowerCase().includes(query) ||
        i.hint.toLowerCase().includes(query)
    );

    // 消息优先排在前面（全局搜正文的主场景）
    const msgs = filtered.filter((i) => i.kind === "message");
    const rest = filtered.filter((i) => i.kind !== "message");
    return [...msgs, ...rest].slice(0, 36);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpToMessage 闭包用最新 store
  }, [
    q,
    contacts,
    chats,
    messages,
    diskMessages,
    followUps,
    phones,
    setActiveNav,
    setSelectedChat,
    setSelectedContact,
    openContactWorkspace,
    setSettingsOpen,
    setFocusMessageId,
    t,
    open,
  ]);

  useEffect(() => {
    setActive(0);
  }, [q, items.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-idx="${active}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const runItem = async (item: PaletteItem) => {
    try {
      await item.run();
    } finally {
      setCommandOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      onClick={() => setCommandOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("palette.searchPlaceholder")}
            className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-zinc-600"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && items[active]) {
                e.preventDefault();
                void runItem(items[active]!);
              }
            }}
          />
          {diskLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
          )}
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-2xs text-zinc-500">
            Esc
          </kbd>
        </div>
        <ul ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {items.map((item, idx) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  data-palette-idx={idx}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-800",
                    idx === active && "bg-zinc-800/90"
                  )}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => void runItem(item)}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      item.kind === "message" ? "text-amber-400" : "text-brand"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{item.label}</div>
                    <div className="truncate text-[11px] text-zinc-500">
                      {item.hint}
                    </div>
                  </div>
                  {item.kind === "message" && (
                    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-2xs text-zinc-500">
                      {t("palette.message")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-zinc-600">
              {q.trim().length === 1
                ? t("palette.minSearch")
                : diskLoading
                  ? t("palette.searching")
                  : t("palette.noResults")}
            </li>
          )}
        </ul>
        <div className="border-t border-zinc-800 px-3 py-1.5 text-2xs text-zinc-600">
          {t("palette.shortcuts")}
          {q.trim().length >= 2
            ? t("palette.diskHistory")
            : ""}
        </div>
      </div>
    </div>
  );
}
