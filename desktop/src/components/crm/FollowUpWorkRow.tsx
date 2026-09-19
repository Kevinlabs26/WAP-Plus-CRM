import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Circle,
  Pencil,
  PencilLine,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Button, Input, Textarea } from "@/components/ui/primitives";
import { resolveSalesStageLabel } from "@/lib/contactWorkflow";
import {
  cn,
  displayContactLabel,
  displayPhone,
} from "@/lib/utils";
import type { Contact, FollowUp } from "@/types/crm";
import type { SalesStage } from "@/types/crm";
import { useI18n } from "@/i18n";

export type FollowUpTone = "overdue" | "today" | "later";

function formatDue(dueAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dueAt || "")) {
    return `${dueAt.slice(0, 10)} ${dueAt.slice(11, 16)}`;
  }
  return (dueAt || "").slice(0, 10);
}

/** 自动规则备注：弱化展示，避免刷屏 */
export function isAutoFollowUpNote(note?: string | null): boolean {
  const t = (note || "").trim();
  if (!t) return false;
  return (
    t.startsWith("自动：") ||
    t.startsWith("自动:") ||
    t.startsWith("[自动]") ||
    /^auto[:：]/i.test(t)
  );
}

export function stripAutoPrefix(note?: string | null): string {
  return (note || "")
    .trim()
    .replace(/^自动[:：]\s*/u, "")
    .replace(/^\[自动\]\s*/u, "")
    .replace(/^auto[:：]\s*/iu, "")
    .trim();
}

export type ContactWorkCard = {
  title: string;
  subtitle: string;
  avatarUrl?: string;
  stageLabel?: string;
  company?: string;
  tags: string[];
  crmNote?: string;
  lastMessage?: string;
  phoneLabel?: string;
  /** 是否只有号码/占位、建议补显示名 */
  needsName: boolean;
  rawName: string;
  rawNotes: string;
  canEdit: boolean;
};

/** 把 followUp 快照 + 实时 Contact/会话 合成可读卡片 */
export function buildContactWorkCard(
  f: FollowUp,
  contact: Contact | undefined,
  lastMessage?: string,
  stageLabels?: Partial<Record<SalesStage, string>>
): ContactWorkCard {
  const title = displayContactLabel(
    contact?.name || f.contactName,
    contact?.phone,
    contact?.channelAddress,
    lastMessage,
    { isGroup: !!contact?.isGroup }
  );
  const phoneLabel = displayPhone(contact?.phone) || "";
  const subtitleParts: string[] = [];
  if (phoneLabel && phoneLabel !== title) subtitleParts.push(phoneLabel);
  if (contact?.company?.trim()) subtitleParts.push(contact.company.trim());
  if (contact?.stage) {
    subtitleParts.push(resolveSalesStageLabel(contact.stage, stageLabels));
  }
  const crmNote = (contact?.notes || "").trim();
  const needsName =
    !contact?.isGroup &&
    (title === phoneLabel ||
      title === "未备注联系人" ||
      /^\+\d{7,15}$/.test(title));
  return {
    title,
    subtitle:
      subtitleParts.join(" · ") ||
      (contact?.isGroup ? "群聊" : "WhatsApp 联系人"),
    avatarUrl: contact?.avatarUrl,
    stageLabel: contact?.stage
      ? resolveSalesStageLabel(contact.stage, stageLabels)
      : undefined,
    company: contact?.company?.trim() || undefined,
    tags: (contact?.tags || []).slice(0, 3),
    crmNote: crmNote || undefined,
    lastMessage: (lastMessage || "").trim() || undefined,
    phoneLabel: phoneLabel || undefined,
    needsName,
    rawName: (contact?.name || "").trim(),
    rawNotes: (contact?.notes || "").trim(),
    canEdit: Boolean(contact?.id) && !contact?.isGroup,
  };
}

type Props = {
  followUp: FollowUp;
  card: ContactWorkCard;
  tone: FollowUpTone;
  onToggleDone: () => void;
  onOpen: () => void;
  onFollowDraft: () => void;
  /** 行内保存显示名 / CRM 备注 */
  onSaveContact?: (patch: { name?: string; notes?: string }) => void;
};

/**
 * 工作台 / 计划表共用：头像 + 可读名 + CRM 上下文 + 行内改名/备注。
 */
export function FollowUpWorkRow({
  followUp: f,
  card,
  tone,
  onToggleDone,
  onOpen,
  onFollowDraft,
  onSaveContact,
}: Props) {
  const { t } = useI18n();
  const auto = isAutoFollowUpNote(f.note);
  const reason = stripAutoPrefix(f.note);
  const dueTone =
    tone === "overdue" ? "已逾期" : tone === "today" ? "今天" : "";

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(card.rawName);
  const [notesDraft, setNotesDraft] = useState(card.rawNotes);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setNameDraft(card.rawName);
      setNotesDraft(card.rawNotes);
    }
  }, [card.rawName, card.rawNotes, editing]);

  useEffect(() => {
    if (editing) {
      const t = window.setTimeout(() => nameRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [editing]);

  const startEdit = (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!card.canEdit || !onSaveContact) return;
    setNameDraft(card.rawName);
    setNotesDraft(card.rawNotes);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setNameDraft(card.rawName);
    setNotesDraft(card.rawNotes);
  };

  const saveEdit = () => {
    if (!onSaveContact) return;
    const name = nameDraft.trim();
    const notes = notesDraft.trim();
    const patch: { name?: string; notes?: string } = {};
    if (name !== card.rawName) patch.name = name;
    if (notes !== card.rawNotes) patch.notes = notes;
    if (Object.keys(patch).length) onSaveContact(patch);
    setEditing(false);
  };

  return (
    <div
      onClick={(event) => {
        if (editing || (event.target as HTMLElement).closest("button, input, textarea")) return;
        onOpen();
      }}
      className={cn(
        "flex h-full items-center gap-2.5 rounded-lg border border-zinc-800/90 bg-zinc-900/40 px-3 py-2 transition-colors",
        !editing && "cursor-pointer hover:bg-zinc-900/70",
        tone === "overdue"
          ? "border-l-2 border-l-rose-500/70"
          : tone === "today"
            ? "border-l-2 border-l-brand/70"
            : ""
      )}
    >
      <button
        type="button"
        onClick={onToggleDone}
        className="shrink-0 text-zinc-500 hover:text-brand"
        title={t("tooltip.markComplete")}
      >
        <Circle className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={onOpen}
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            title={t("tooltip.openChat")}
          >
            <Avatar
              name={card.title}
              seed={card.phoneLabel || f.contactId || card.title}
              src={card.avatarUrl}
              size="md"
            />
          </button>

          <div className="min-w-0 flex-1">
            {editing ? (
              <div
                className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-950/80 p-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveEdit();
                  }
                }}
              >
                <div>
                  <label className="mb-1 block text-2xs text-zinc-500">
                    显示名
                    {card.phoneLabel ? (
                      <span className="text-zinc-600"> · {card.phoneLabel}</span>
                    ) : null}
                  </label>
                  <Input
                    ref={nameRef}
                    value={nameDraft}
                    placeholder="例如公司简称 / 称呼"
                    className="!min-h-8 !py-1 text-[13px]"
                    onChange={(e) => setNameDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-2xs text-zinc-500">
                    客户备注（仅你可见）
                  </label>
                  <Textarea
                    value={notesDraft}
                    placeholder="意向、渠道、注意点…"
                    rows={2}
                    className="!min-h-[52px] text-[12px] leading-4"
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="primary"
                    className="!min-h-7 !px-2.5 text-2xs"
                    onClick={saveEdit}
                  >
                    保存
                  </Button>
                  <Button
                    variant="ghost"
                    className="!min-h-7 !px-2 text-2xs text-zinc-400"
                    onClick={cancelEdit}
                  >
                    <X className="mr-0.5 h-3 w-3" />
                    取消
                  </Button>
                  <span className="text-2xs text-zinc-600">
                    ⌘/Ctrl+Enter 保存 · Esc 取消
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onOpen}
                    className="truncate text-left text-[13px] font-semibold text-zinc-100 hover:text-brand"
                    title={t("tooltip.openChat")}
                  >
                    {card.title}
                  </button>
                  {card.stageLabel ? (
                    <Badge className="!text-2xs">{card.stageLabel}</Badge>
                  ) : null}
                  {card.tags.map((tag) => (
                    <Badge key={tag} className="!text-2xs">
                      {tag}
                    </Badge>
                  ))}
                  {card.canEdit && onSaveContact ? (
                    <button
                      type="button"
                      onClick={startEdit}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-2xs transition-colors",
                        card.needsName
                          ? "bg-amber-500/15 text-amber-200/90 hover:bg-amber-500/25"
                          : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                      )}
                      title={t("tooltip.editNameNote")}
                    >
                      <Pencil className="h-3 w-3" />
                      {card.needsName ? "补名字" : "备注"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {card.subtitle}
                </div>

                {card.crmNote ? (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="mt-1 line-clamp-1 w-full text-left text-[12px] leading-4 text-zinc-300 hover:text-zinc-100"
                    title={t("tooltip.editNote")}
                  >
                    <span className="text-zinc-500">备注 · </span>
                    {card.crmNote}
                  </button>
                ) : card.canEdit && onSaveContact ? (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="mt-1.5 text-left text-[11px] text-zinc-600 underline-offset-2 hover:text-zinc-400 hover:underline"
                  >
                    + 添加备注
                  </button>
                ) : null}

                {reason ? (
                  <div
                    className={cn(
                      "mt-1 line-clamp-1 text-[12px] leading-4",
                      auto ? "text-zinc-500" : "text-zinc-400"
                    )}
                  >
                    <span className="text-zinc-600">
                      {auto ? "系统提醒 · " : "跟进 · "}
                    </span>
                    {reason}
                  </div>
                ) : null}

                {!card.crmNote && !reason && card.lastMessage ? (
                  <div className="mt-1 line-clamp-1 text-[12px] leading-4 text-zinc-500">
                    <span className="text-zinc-600">最近 · </span>
                    {card.lastMessage}
                  </div>
                ) : null}

                <div className="mt-1.5 text-2xs tabular-nums text-zinc-600">
                  到期 {formatDue(f.dueAt)}
                  {dueTone ? ` · ${dueTone}` : ""}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0">
        <Button
          variant="ghost"
          className="!min-h-8 gap-1 !px-2.5 text-2xs text-zinc-400"
          title={t("tooltip.fillFollowUpNote")}
          onClick={onFollowDraft}
        >
          <PencilLine className="h-3.5 w-3.5" />
          跟进
        </Button>
      </div>
    </div>
  );
}
