import { memo, useMemo } from "react";
import {
  BellOff,
  Copy,
  MoreVertical,
  Pin,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { displayContactLabel, stripWhatsAppFormatting } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, ListRow } from "@/components/ui/primitives";
import { Ticks } from "@/components/chat/Ticks";
import {
  isPeerOnline,
  peerPresenceCores,
  pickPeerPresence,
} from "@/components/chat/usePeerPresence";
import type {
  ChatPreview,
  Contact,
  MessageDeliveryStatus,
} from "@/types/crm";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

function formatSidebarTime(raw?: string, yesterdayLabel = "Yesterday") {
  if (!raw) return "";
  const value = /^\d{10,13}$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(value)) return "";
  const date = new Date(value < 1e12 ? value * 1000 : value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return yesterdayLabel;
  return date.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}

export type ChatSidebarRowProps = {
  chat: ChatPreview;
  contact?: Contact | null;
  preview: string;
  lastMessageAt?: string;
  lastMessageDirection?: "in" | "out";
  lastDeliveryStatus?: MessageDeliveryStatus;
  active: boolean;
  isBaileys: boolean;
  showAccountBadge: boolean;
  accountShort?: string;
  accountLabel?: string;
  accountCount?: number;
  dataAccountId?: string;
  cloneId?: string;
  isDragging?: boolean;
  dragDisabled?: boolean;
  onOpen: (contactId: string, chatId: string) => void;
  onOpenMenu: (
    e: React.MouseEvent | React.PointerEvent,
    chatId: string,
    memberChatIds?: string[]
  ) => void;
  memberChatIds?: string[];
  onDragStart?: (e: React.PointerEvent, chatId: string, memberChatIds?: string[]) => void;
};

/**
 * 单行会话：memo + 行内窄订阅 presence，避免侧栏整树跟 presence 抖动。
 */
export const ChatSidebarRow = memo(function ChatSidebarRow({
  chat,
  contact,
  preview,
  lastMessageAt,
  lastMessageDirection,
  lastDeliveryStatus,
  active,
  isBaileys,
  showAccountBadge,
  accountShort,
  accountLabel,
  accountCount,
  memberChatIds,
  cloneId,
  isDragging,
  dragDisabled,
  onOpen,
  onOpenMenu,
  onDragStart,
}: ChatSidebarRowProps) {
  const { t } = useI18n();
  const c = contact;
  const label = useMemo(
    () =>
      displayContactLabel(
        c?.name || chat.contactName,
        c?.phone,
        c?.channelAddress,
        preview,
        { isGroup: !!(c?.isGroup || chat.isGroup) }
      ),
    [
      c?.name,
      c?.phone,
      c?.channelAddress,
      c?.isGroup,
      chat.contactName,
      chat.isGroup,
      preview,
    ]
  );

  const cores = useMemo(
    () =>
      peerPresenceCores({
        chatId: chat.id,
        contactId: chat.contactId,
        channelAddress: c?.channelAddress,
        phone: c?.phone,
      }),
    [chat.id, chat.contactId, c?.channelAddress, c?.phone]
  );

  const { online, typingLine } = useAppStore(
    useShallow((s) => {
      if (!isBaileys) return { online: false, typingLine: "" };
      const hit = pickPeerPresence(s.peerPresenceByKey, cores);
      return {
        online: isPeerOnline(hit),
        typingLine:
          hit?.presence === "composing"
            ? t("presence.typing")
            : hit?.presence === "recording"
              ? t("presence.recording")
              : "",
      };
    })
  );

  const muted =
    typeof chat.mutedUntil === "number" && chat.mutedUntil > Date.now();
  const previewText = stripWhatsAppFormatting(preview);
  const messageTime = formatSidebarTime(lastMessageAt, t("presence.yesterday"));
  const tickKind =
    lastMessageDirection !== "out" ||
    lastDeliveryStatus === "pending" ||
    lastDeliveryStatus === "queued" ||
    lastDeliveryStatus === "failed" ||
    lastDeliveryStatus === "local"
      ? null
      : lastDeliveryStatus === "read" || lastDeliveryStatus === "played"
        ? "read"
        : lastDeliveryStatus === "delivered"
          ? "delivered"
          : "sent";

  return (
    <li
      className={cn(
        "group/chat relative list-none",
        isDragging && "opacity-45",
        dragDisabled
          ? "cursor-default select-none"
          : "cursor-grab select-none active:cursor-grabbing"
      )}
      title={
        accountCount && accountCount > 1
          ? t("tooltip.accountCountDrag", { count: accountCount })
          : cloneId
            ? t("tooltip.cloneNoDrag")
            : t("tooltip.dragMove")
      }
      onPointerDown={(e) => {
        if (cloneId || dragDisabled) return;
        onDragStart?.(e, chat.id, memberChatIds);
      }}
    >
      <ListRow
        active={active}
        onClick={() => onOpen(chat.contactId, chat.id)}
        onContextMenu={(e) => onOpenMenu(e, chat.id, memberChatIds)}
        className="!items-center gap-2.5 !py-2 !pr-0"
      >
        <div className="relative shrink-0">
          <Avatar
            name={label}
            seed={c?.phone || chat.contactId}
            src={c?.avatarUrl}
            size="sm"
            online={online}
            onlineTitle={t("tooltip.online")}
          />
          {showAccountBadge && accountShort ? (
            <span
              title={accountLabel || accountShort}
              className="absolute -bottom-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-700 dark:bg-zinc-900 px-0.5 text-[8px] font-bold leading-none text-white ring-1.5 ring-white dark:ring-zinc-950 shadow-xs"
            >
              {accountShort}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex w-full items-center justify-between gap-1.5">
            <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-semibold text-zinc-100">
              {chat.pinned && (
                <Pin className="h-3 w-3 shrink-0 text-brand" />
              )}
              {cloneId && (
                <Copy className="h-3 w-3 shrink-0 text-zinc-500" />
              )}
              <span className="truncate">{label}</span>
              {accountCount && accountCount > 1 ? (
                <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-normal text-zinc-400">
                  {t("sidebar.accountCount", { count: accountCount })}
                </span>
              ) : null}
              {muted && (
                <BellOff className="h-3 w-3 shrink-0 text-zinc-500" />
              )}
            </span>
            {messageTime && (
              <span className="shrink-0 text-2xs tabular-nums text-zinc-500">
                {messageTime}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex w-full items-center justify-between gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {tickKind && <Ticks kind={tickKind} />}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-2xs",
                  typingLine ? "font-medium text-brand" : "text-zinc-500"
                )}
              >
                {typingLine || previewText || t("multiAccount.noMessages")}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {chat.unread > 0 && (
                <Badge tone="brand" className="!h-4 !min-w-4 !px-1 text-[10px] font-bold tabular-nums">
                  {chat.unread}
                </Badge>
              )}
              <span
                role="button"
                tabIndex={0}
                title={t("tooltip.conversationActions")}
                className="rounded p-0.5 text-zinc-500 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover/chat:opacity-100 transition-opacity"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenMenu(e, chat.id, memberChatIds);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenMenu(e as unknown as React.MouseEvent, chat.id, memberChatIds);
                  }
                }}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>
      </ListRow>
    </li>
  );
});
