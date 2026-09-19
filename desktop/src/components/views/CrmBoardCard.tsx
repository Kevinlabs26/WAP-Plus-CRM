import { memo } from "react";
import { CalendarClock, CalendarPlus, Check, Clock3, GripVertical, MessageSquare, UserRound } from "lucide-react";
import type { Contact } from "@/types/crm";
import { cn, displayPhone } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/primitives";
import {
  contactTitle,
  insightLine,
  needsDisplayName,
} from "./crmCardHelpers";
import { useI18n } from "@/i18n";

type Props = {
  contact: Contact;
  selected: boolean;
  dragging: boolean;
  due: boolean;
  unread: number;
  /** 多选模式：卡片显示复选框，点击切换勾选而非选中详情 */
  selectMode?: boolean;
  checked?: boolean;
  onToggleSelect: (contact: Contact) => void;
  onPointerDown: (e: React.PointerEvent, contactId: string) => void;
  onClick: (contact: Contact) => void;
  onOpenChat: (contact: Contact) => void;
  onScheduleToday: (contact: Contact) => void;
  onScheduleFollowUp: (contact: Contact) => void;
  onScheduleAt: (contact: Contact, dueAt: string) => void;
  onFixName: (contact: Contact) => void;
};

/** 看板阶段列里的一张联系人卡片。 */
const CrmBoardCardInner = ({
  contact: c,
  selected,
  dragging,
  due,
  unread,
  selectMode,
  checked,
  onToggleSelect,
  onPointerDown,
  onClick,
  onOpenChat,
  onScheduleToday,
  onScheduleFollowUp,
  onScheduleAt,
  onFixName,
}: Props) => {
  const { locale, t } = useI18n();
  const title = contactTitle(c);
  const phone = displayPhone(c.phone);
  const tip = insightLine(c, 40);
  const unnamed = needsDisplayName(c);
  const shortDate = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value.slice(0, 10)
      : new Intl.DateTimeFormat(locale, {
          month: "numeric",
          day: "numeric",
          hour: value.includes("T") ? "2-digit" : undefined,
          minute: value.includes("T") ? "2-digit" : undefined,
        }).format(date);
  };
  return (
    <div>
      <div
        onPointerDown={selectMode ? undefined : (e) => onPointerDown(e, c.id)}
        onClick={() => (selectMode ? onToggleSelect(c) : onClick(c))}
        className={cn(
          "crm-kanban-card group relative flex w-full select-none items-start gap-1.5 rounded-lg border p-2 text-left transition-all shadow-2xs",
          selectMode
            ? checked
              ? "cursor-pointer border-brand/50 bg-brand/15"
              : "cursor-pointer border-zinc-700 bg-zinc-900 hover:border-zinc-500"
            : dragging
              ? "cursor-grabbing border-brand/40 opacity-40 shadow-none"
              : "cursor-grab border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 hover:shadow-xs",
          !selectMode && !dragging && selected && "border-brand/40 bg-brand/10"
        )}
        title={selectMode ? t("crmBoard.toggleSelection") : t("crmBoard.dragStage")}
      >
        {selectMode && (
          <span
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              checked
                ? "border-brand bg-brand text-zinc-950"
                : "border-zinc-600 bg-zinc-900"
            )}
          >
            {checked && <Check className="h-3 w-3" />}
          </span>
        )}
        {!selectMode && (
          <span
            className="mt-0.5 shrink-0 cursor-grab touch-none text-zinc-600 group-hover:text-zinc-400"
            aria-hidden
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}
        <div className="relative mt-0.5 shrink-0">
          <Avatar
            name={title}
            seed={c.phone || c.id}
            src={c.avatarUrl}
            size="sm"
            className="pointer-events-none"
          />
          {unread > 0 && (
            <span
              title={t("crmBoard.unread", { count: unread })}
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 text-white px-1 text-[9px] font-bold tabular-nums ring-1.5 ring-white dark:ring-zinc-950 shadow-xs"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <div className="min-w-0 flex-1 basis-24 truncate text-[13px] font-medium">{title}</div>
            {due ? (
              <span className="shrink-0 rounded bg-rose-500/15 px-1 py-px text-2xs text-rose-300">
                {t("crmBoard.pending")}
              </span>
            ) : null}
            {unnamed ? (
              <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-2xs text-amber-200/90">
                {t("crmBoard.missingName")}
              </span>
            ) : null}
          </div>
          {(c.lastMessageAt || c.nextFollowUpAt) && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-2xs text-zinc-500">
              {c.lastMessageAt ? (
                <span className="inline-flex items-center gap-0.5" title={t("crmBoard.lastContact", { date: c.lastMessageAt })}>
                  <Clock3 className="h-3 w-3" />
                  {t("crmBoard.last", { date: shortDate(c.lastMessageAt) })}
                </span>
              ) : null}
              {c.nextFollowUpAt ? (
                <span className="inline-flex items-center gap-0.5 text-sky-300/80" title={t("crmBoard.nextFollowUpAt", { date: c.nextFollowUpAt })}>
                  <CalendarPlus className="h-3 w-3" />
                  {t("crmBoard.next", { date: shortDate(c.nextFollowUpAt) })}
                </span>
              ) : null}
            </div>
          )}
          <div className="truncate text-2xs text-zinc-500">
            {c.company ||
              (phone && phone !== title ? phone : c.phone) ||
              t("contact.noPhone")}
          </div>
          {tip && (
            <div
              className="mt-1 line-clamp-1 text-2xs leading-3.5 text-brand/80"
              title={insightLine(c, 200) || undefined}
            >
              {tip}
            </div>
          )}
          {c.tags[0] && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {c.tags.slice(0, 2).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
          {!selectMode ? (
            <div
              className="absolute bottom-1.5 right-1.5 z-10 hidden flex-nowrap items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/95 p-0.5 shadow-lg group-hover:flex"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title={t("crmBoard.openChat")}
                aria-label={t("crmBoard.openChat")}
                draggable={false}
                onClick={() => onOpenChat(c)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
              >
                <MessageSquare className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t("crmBoard.todayFollowUp")}
                aria-label={t("crmBoard.todayFollowUp")}
                draggable={false}
                onClick={() => onScheduleToday(c)}
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-2xs text-zinc-300 hover:border-zinc-600 hover:text-white"
              >
                {t("crmBoard.todayShort")}
              </button>
              <button
                type="button"
                title={t("crmBoard.tomorrowFollowUp")}
                aria-label={t("crmBoard.tomorrowFollowUp")}
                draggable={false}
                onClick={() => onScheduleFollowUp(c)}
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-2xs text-zinc-300 hover:border-zinc-600 hover:text-white"
              >
                {t("crmBoard.tomorrowShort")}
              </button>
              <label
                title={t("crmBoard.customFollowUp")}
                className="relative inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
              >
                <CalendarClock className="h-3 w-3" />
                <input
                  type="datetime-local"
                  aria-label={t("crmBoard.setFollowUp", { name: title })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    const dueAt = event.currentTarget.value;
                    if (dueAt) onScheduleAt(c, dueAt);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {unnamed ? (
                <button
                  type="button"
                  title={t("crmBoard.addName")}
                  aria-label={t("crmBoard.addName")}
                  draggable={false}
                  onClick={() => onFixName(c)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
                >
                  <UserRound className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const CrmBoardCard = memo(CrmBoardCardInner);
