import { useMemo, useState } from "react";
import { MessageSquare, Search, Star, StarOff } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/crm";
import { useI18n } from "@/i18n";

function previewText(m: Message): string {
  const t = (m.mediaFileName || m.mediaCaption || m.body || "").trim();
  if (t) return t.replace(/\s+/g, " ").slice(0, 160);
  const mt = (m.mediaType || "").toLowerCase();
  if (mt === "image") return "[图片]";
  if (mt === "sticker") return "[贴纸]";
  if (mt === "video" || mt === "gif") return "[视频]";
  if (mt === "audio") return "[语音]";
  if (mt === "document") return "[文件]";
  return "[消息]";
}

function formatWhen(iso?: string) {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  return iso.slice(0, 16);
}

export function StarredView() {
  const { t } = useI18n();
  const listStarredMessages = useAppStore((s) => s.listStarredMessages);
  const toggleMessageStarred = useAppStore((s) => s.toggleMessageStarred);
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const setSelectedChat = useAppStore((s) => s.setSelectedChat);
  const setSelectedContact = useAppStore((s) => s.setSelectedContact);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setFocusMessageId = useAppStore((s) => s.setFocusMessageId);
  const ensureMessageInMemory = useAppStore((s) => s.ensureMessageInMemory);
  const pushToast = useAppStore((s) => s.pushToast);
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  // 依赖 messages 引用，星标变化时刷新列表
  const messages = useAppStore((s) => s.messages);
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");

  const starred = useMemo(() => {
    void messages;
    return listStarredMessages();
  }, [listStarredMessages, messages]);

  const chatById = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);
  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts]
  );

  const directionCounts = useMemo(
    () => ({
      all: starred.length,
      in: starred.filter((m) => m.direction === "in").length,
      out: starred.filter((m) => m.direction === "out").length,
    }),
    [starred]
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return starred.filter((m) => {
      if (direction !== "all" && m.direction !== direction) return false;
      if (!query) return true;
      const chat = m.chatId ? chatById.get(m.chatId) : undefined;
      const contact =
        (m.contactId && contactById.get(m.contactId)) ||
        (chat?.contactId ? contactById.get(chat.contactId) : undefined);
      const who = `${contact?.name || ""} ${chat?.contactName || ""} ${contact?.phone || ""} ${m.senderName || ""} ${m.senderPhoneE164 || ""}`;
      const body = previewText(m);
      return (
        who.toLowerCase().includes(query) || body.toLowerCase().includes(query)
      );
    });
  }, [starred, q, direction, chatById, contactById]);

  const openMessage = async (m: Message) => {
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
    } else {
      pushToast(t("starred.notFound"), "info");
      return;
    }
    pushToast(t("starred.located"), "info");
  };

  const contactLabel = (m: Message) => {
    const chat = m.chatId ? chatById.get(m.chatId) : undefined;
    const contact =
      (m.contactId && contactById.get(m.contactId)) ||
      (chat?.contactId ? contactById.get(chat.contactId) : undefined);
    return chat?.contactName || contact?.name || contact?.phone || t("sidebar.chats");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-zinc-800/90 px-5 py-4">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <h1 className="text-[15px] font-semibold text-zinc-100">{t("starred.title")}</h1>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] tabular-nums text-zinc-400">
              {starred.length}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-zinc-500">
            {t("starred.description")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 max-w-md flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("starred.search")}
                className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 pl-8 pr-3 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>
            <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5">
              {([
                ["all", t("starred.all")],
                ["in", t("starred.in")],
                ["out", t("starred.out")],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDirection(value)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-[11px] transition-colors",
                    direction === value
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {label} {directionCounts[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto w-full max-w-7xl">
          {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-10 text-center">
            <Star className="mx-auto h-8 w-8 text-zinc-600" />
            <div className="mt-3 text-[13px] font-medium text-zinc-300">
              {starred.length === 0 ? t("starred.empty") : t("starred.noMatch")}
            </div>
            <div className="mt-1 text-[12px] text-zinc-600">
              {starred.length === 0
                ? t("starred.emptyHint")
                : t("starred.filterHint")}
            </div>
            <Button
              variant="secondary"
              className="mt-4 !min-h-8 gap-1.5 text-[12px]"
              onClick={() => {
                if (starred.length === 0) {
                  setActiveNav("chats");
                } else {
                  setQ("");
                  setDirection("all");
                }
              }}
            >
              {starred.length === 0 ? (
                <MessageSquare className="h-3.5 w-3.5" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {starred.length === 0 ? t("starred.goChats") : t("starred.clearFilter")}
            </Button>
          </div>
        ) : (
          <>
            <SectionLabel className="mb-2">
              {q.trim()
                ? t("starred.matchCount", { count: filtered.length })
                : direction === "in"
                  ? t("starred.received")
                  : direction === "out"
                    ? t("starred.sent")
                    : t("starred.allStars")}
            </SectionLabel>
            <ul className="space-y-2">
              {filtered.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
                >
                  <span className="mt-0.5 shrink-0 text-amber-400" title={t("starred.starred")}>
                    <Star className="h-4 w-4 fill-amber-400" />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void openMessage(m)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-100">
                        {contactLabel(m)}
                      </span>
                      {m.isGroup && m.senderName && (
                        <span className="text-2xs text-zinc-500">
                          {m.senderName}
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-2xs",
                          m.direction === "out"
                            ? "bg-brand/15 text-brand"
                            : "bg-zinc-800 text-zinc-400"
                        )}
                      >
                        {m.direction === "out" ? t("starred.out") : t("starred.in")}
                      </span>
                      <span className="text-2xs tabular-nums text-zinc-600">
                        {formatWhen(m.sentAt)}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-zinc-400">
                      {previewText(m)}
                    </div>
                    {m.starredAt && (
                      <div className="mt-1 text-2xs text-zinc-600">
                        {t("starred.starredAt", { time: formatWhen(m.starredAt) })}
                      </div>
                    )}
                  </button>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button
                      variant="secondary"
                      className="!min-h-8 gap-1 !px-2.5 text-2xs"
                      onClick={() => void openMessage(m)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t("starred.open")}
                    </Button>
                    <Button
                      variant="ghost"
                      className="!min-h-8 gap-1 !px-2.5 text-2xs text-zinc-500"
                      onClick={() => {
                        toggleMessageStarred(m.id);
                        pushToast(t("starred.unstar"), "success");
                      }}
                    >
                      <StarOff className="h-3.5 w-3.5" />
                      {t("starred.unstar")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
