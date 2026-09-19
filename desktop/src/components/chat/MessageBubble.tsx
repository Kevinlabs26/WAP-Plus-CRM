import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Captions, Languages, Loader2, MessageCircle, MoreVertical, Pin, Star, UserPlus } from "lucide-react";
import type { Message, MessageReaction } from "@/types/crm";
import { avatarInitials, cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import type { SenderPresentation } from "@/lib/groupSenderDisplay";
import { MessageBody } from "./MessageBody";
import { MessageMedia } from "./MessageMedia";
import { Ticks } from "./Ticks";
import {
  inferMediaType,
  shouldShowBodyText,
} from "./messageMediaUtils";
import { extractWhatsAppInvite, GroupInviteCard } from "./GroupInviteCard";
import { VoiceBubble } from "./VoiceBubble";
import { baileysFetchAvatar } from "@/lib/baileys";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";

type Props = {
  m: Message;
  focused?: boolean;
  menuOpen?: boolean;
  mediaBusy?: boolean;
  senderPresentation?: SenderPresentation | null;
  transcribing?: boolean;
  onOpenMenu: (
    e: React.MouseEvent | React.PointerEvent,
    messageId: string,
    anchor?: DOMRect | null
  ) => void;
  onRetry: (id: string) => void;
  onReloadMedia: (m: Message) => void;
  onPreview: (src: string, alt: string) => void;
  onSenderClick?: (m: Message) => void;
  onTranscribe?: (messageId: string) => void;
  onTranslate?: (messageId: string) => void;
  translating?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (messageId: string) => void;
};

function ContactCardMessage({ m }: { m: Message }) {
  const { t } = useI18n();
  const card = m.contactCard;
  if (!card) return null;
  const digits = card.phoneE164.replace(/\D/g, "");
  const canUse = digits.length >= 7 && digits.length <= 15;

  // 优先从本地已知通讯录读取真实头像（如果有），否则展示带有姓名字母的彩色头像
  const savedContact = useAppStore((s) =>
    s.contacts.find((c) => !c.isGroup && c.phone.replace(/\D/g, "") === digits)
  );
  const avatarSrc = savedContact?.avatarUrl || null;

  const save = (openChat: boolean) => {
    if (!canUse) return;
    const accountId = m.accountId || undefined;
    const findSaved = () => {
      const contacts = useAppStore.getState().contacts;
      return (
        contacts.find(
          (contact) =>
            !contact.isGroup &&
            contact.phone.replace(/\D/g, "") === digits &&
            (!accountId || contact.accountId === accountId)
        ) ||
        contacts.find(
          (contact) =>
            !contact.isGroup && contact.phone.replace(/\D/g, "") === digits
        )
      );
    };
    let saved = findSaved();
    if (!saved) {
      useAppStore.getState().importContacts([
        {
          name: card.displayName || `+${digits}`,
          phone: `+${digits}`,
          accountId,
          source: "contact-card",
          tags: [],
          stage: "new",
        },
      ]);
      saved = findSaved();
    }
    if (!saved) {
      useAppStore.getState().pushToast(t("messageBubble.contactSaveFailed"), "error");
      return;
    }
    if (openChat) useAppStore.getState().openContactWorkspace(saved.id);
    useAppStore
      .getState()
      .pushToast(openChat ? t("messageBubble.contactOpened") : t("messageBubble.contactSaved"), "success");
  };

  return (
    <div className="contact-vcard-box min-w-60 overflow-hidden rounded-xl border border-black/10 bg-black/5 transition-all">
      <div className="flex items-center gap-3 p-3">
        <Avatar
          name={card.displayName || digits}
          seed={digits || card.displayName}
          src={avatarSrc}
          size="lg"
          className="!h-11 !w-11 text-xs shadow-xs ring-1 ring-black/10"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-zinc-100">
            {card.displayName || t("messageBubble.contactCard")}
          </div>
          <div className="mt-0.5 truncate font-mono text-2xs text-zinc-400">
            {card.phoneE164 || t("messageBubble.noPhone")}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-black/5 bg-black/[0.02]">
        <button
          type="button"
          disabled={!canUse}
          onClick={(event) => {
            event.stopPropagation();
            save(false);
          }}
          className="contact-vcard-btn inline-flex items-center justify-center gap-1.5 border-r border-black/5 px-3 py-2 text-2xs font-medium text-zinc-400 hover:bg-black/5 hover:text-zinc-200 active:scale-95 transition-all disabled:opacity-40"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {t("messageBubble.save")}
        </button>
        <button
          type="button"
          disabled={!canUse}
          onClick={(event) => {
            event.stopPropagation();
            save(true);
          }}
          className="contact-vcard-btn inline-flex items-center justify-center gap-1.5 px-3 py-2 text-2xs font-semibold text-brand hover:bg-brand/10 active:scale-95 transition-all disabled:opacity-40"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {t("messageBubble.sendMessage")}
        </button>
      </div>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  m,
  focused,
  menuOpen,
  mediaBusy,
  senderPresentation,
  transcribing,
  onOpenMenu,
  onRetry,
  onReloadMedia,
  onPreview,
  onSenderClick,
  onTranscribe,
  onTranslate,
  translating = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const { t } = useI18n();
  const [showTranslation, setShowTranslation] = useState(true);
  // 群头像悬停大图：fixed 定位，避免被气泡 overflow 裁成指甲盖
  const [avatarHover, setAvatarHover] = useState<{
    src: string;
    label: string;
    x: number;
    y: number;
    loading?: boolean;
    /** 仅高清失败时的小图回退 */
    fallbackSrc?: string;
    /** 当前是小图放大（可能略糊） */
    soft?: boolean;
  } | null>(null);
  /** 点击某 emoji 展开反应器名单（群多人同 emoji） */
  const [reactionOpen, setReactionOpen] = useState<string | null>(null);
  const reactionPanelRef = useRef<HTMLDivElement | null>(null);
  const hdCacheRef = useRef(new Map<string, string>()).current;
  // 稳定回调：避免每次渲染新建箭头函数击穿 MessageMedia 的 memo
  const stableReloadMedia = useCallback(() => onReloadMedia(m), [onReloadMedia, m]);
  const stablePreview = useCallback(
    (src: string, alt: string) => onPreview(src, alt),
    [onPreview]
  );
  const stableTranscribe = useCallback(
    () => onTranscribe?.(m.id),
    [onTranscribe, m.id]
  );

  useEffect(() => {
    if (!reactionOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = reactionPanelRef.current;
      if (el && !el.contains(e.target as Node)) setReactionOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReactionOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [reactionOpen]);

  const reactionGroups = useMemo(() => {
    const list = m.reactions || [];
    const groups = new Map<
      string,
      {
        emoji: string;
        count: number;
        mine: boolean;
        reactors: { key: string; label: string; from: MessageReaction["from"] }[];
      }
    >();
    for (const r of list) {
      const g = groups.get(r.emoji) || {
        emoji: r.emoji,
        count: 0,
        mine: false,
        reactors: [],
      };
      if (r.from === "me") g.mine = true;
      const label =
        r.from === "me"
          ? t("messageBubble.me")
          : r.participantName?.trim() ||
            (r.participantJid
              ? r.participantJid.split("@")[0]
              : r.from === "peer"
                ? t("messageBubble.other")
                : t("messageBubble.member"));
      const key =
        r.from === "me"
          ? "me"
          : r.participantJid
            ? `m:${r.participantJid}`
            : r.from === "peer"
              ? "peer"
              : `n:${label}:${g.reactors.length}`;
      if (!g.reactors.some((x) => x.key === key)) {
        g.reactors.push({ key, label, from: r.from });
        g.count += 1;
      }
      groups.set(r.emoji, g);
    }
    return [...groups.values()];
  }, [m.reactions]);
  const timeLabel = useMemo(
    () =>
      new Date(m.sentAt).toLocaleString(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [m.sentAt]
  );
  const mentionLabels = useMemo(() => {
    const body = m.body || "";
    if (m.mentionedJids?.length) {
      return body.match(/@[\wÀ-ɏ一-鿿]+/g) || undefined;
    }
    if (body.includes("@所有人")) return ["@所有人"] as string[];
    return undefined;
  }, [m.body, m.mentionedJids]);
  const st = m.deliveryStatus;
  const showStatus =
    m.direction === "out" &&
    st &&
    st !== "sent" &&
    st !== "local" &&
    st !== "delivered" &&
    st !== "read" &&
    st !== "played" &&
    st !== "server";
  const tick =
    m.direction === "out" &&
    st &&
    !["failed", "queued", "pending"].includes(st)
      ? st === "read" || st === "played"
        ? "read"
        : st === "delivered" || st === "server"
          ? "delivered"
          : "sent"
      : null;
  const mediaKind = inferMediaType(m);
  const hasVoiceTranscript = mediaKind === "audio" && Boolean(m.transcript);
  const showVoiceTranscribe =
    mediaKind === "audio" &&
    Boolean(m.mediaUrl) &&
    !m.transcript &&
    Boolean(onTranscribe);
  const inviteLink = extractWhatsAppInvite(m.body || "");
  const visibleBody = inviteLink
    ? (m.body || "").replace(inviteLink, "").trim()
    : m.body;
  const showTextTranslate =
    Boolean(visibleBody) &&
    mediaKind !== "system" &&
    mediaKind !== "audio" &&
    mediaKind !== "contact" &&
    m.mediaType !== "system" &&
    Boolean(onTranslate) &&
    Boolean(m.translation || m.body?.trim());
  if (m.mediaType === "system" || mediaKind === "system") {
    return (
      <div
        className="flex justify-center px-3 py-1"
        data-message-id={m.id}
      >
        <div className="max-w-[90%] rounded-full border border-zinc-800/80 bg-zinc-900/70 px-3 py-1 text-center text-[11px] leading-4 text-zinc-400">
          {m.body}
        </div>
      </div>
    );
  }
  const isMedia =
    ((mediaKind === "image" || mediaKind === "gif") && Boolean(m.mediaUrl)) ||
    (mediaKind === "video" && Boolean(m.mediaUrl || m.mediaThumbUrl));
  const hasCaption = isMedia && shouldShowBodyText(m);
  const imageFlush =
    (
      ((mediaKind === "image" || mediaKind === "sticker" || mediaKind === "gif") &&
        Boolean(m.mediaUrl)) ||
      (mediaKind === "video" && Boolean(m.mediaUrl || m.mediaThumbUrl))
    ) &&
    !shouldShowBodyText(m);
  const statusNode = showStatus ? (
    <span
      className={cn(
        st === "failed" ? "text-rose-300/95" : "text-amber-200/90"
      )}
      title={m.lastError || undefined}
    >
      {st === "pending"
        ? t("messageBubble.sending")
        : st === "queued"
          ? m.lastError
            ? `排队 · ${m.lastError.slice(0, 36)}`
            : t("messageBubble.queueRetry")
          : st === "failed"
            ? m.lastError
              ? `失败 · ${m.lastError.slice(0, 36)}`
              : t("messageBubble.failed")
            : st}
    </span>
  ) : null;
  const retryNode =
    m.direction === "out" && (st === "failed" || st === "queued") ? (
      <button
        type="button"
        className={cn(
          "underline-offset-2 hover:underline",
          imageFlush ? "text-white/90" : "text-brand/90"
        )}
        onClick={() => onRetry(m.id)}
      >
        {t("messageBubble.retry")}
      </button>
    ) : null;

  const moreBtn = (
    <button
      type="button"
      title={t("tooltip.messageActions")}
      className={cn(
        "rounded p-0.5 opacity-70 hover:opacity-100",
        imageFlush
          ? "bg-black/40 text-white hover:bg-black/55"
          : "text-zinc-500 hover:bg-black/20 hover:text-zinc-200"
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onOpenMenu(e, m.id, rect);
      }}
    >
      <MoreVertical className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <>
    <div
      data-msg-id={m.id}
      onContextMenu={(e) => onOpenMenu(e, m.id)}
      className={cn(
        // 左右 gutter 由列表行 padding 统一提供，气泡自身左右 margin 对称（0）
        "group/msg relative mb-2 block w-fit cursor-context-menu text-[13px] leading-relaxed ring-offset-2 ring-offset-zinc-950",
        hasCaption
          ? "max-w-[min(72vw,22rem)]"
          : "max-w-[min(72%,56rem)]",
        imageFlush
          ? cn(
              // 群图也走文档流（发送者在上），避免 absolute 叠层 + 虚拟列表测高把图「挤飞」
              "overflow-visible rounded-2xl bg-transparent p-0 shadow-none",
              m.direction === "out"
                ? "ml-auto mr-0 rounded-br-md"
                : "mr-auto ml-0 rounded-bl-md"
            )
          : hasCaption
            ? cn(
              // 让底部的表情回应浮出气泡；媒体组件自身负责图片圆角裁剪
              "overflow-visible rounded-2xl p-0",
              m.direction === "out"
                ? "message-bubble-out ml-auto mr-0 rounded-tr-[4px] border border-emerald-300/20 bg-emerald-950/90 text-white shadow-lg shadow-black/20"
                : "message-bubble-in mr-auto ml-0 rounded-tl-[4px] border border-white/10 bg-zinc-900/95 text-zinc-200 shadow-lg shadow-black/20"
            )
          : cn(
              "rounded-2xl px-3.5 py-2",
                m.direction === "out"
                  ? "message-bubble-out ml-auto mr-0 rounded-tr-[4px] border border-emerald-300/20 bg-emerald-950/90 text-white shadow-lg shadow-black/20"
                  : "message-bubble-in mr-auto ml-0 rounded-tl-[4px] border border-white/10 bg-zinc-900/95 text-zinc-200 shadow-lg shadow-black/20"
              ),
        st === "failed" && "ring-1 ring-rose-500/40",
        (st === "queued" || st === "pending") &&
          !imageFlush &&
          "opacity-90 ring-1 ring-amber-500/25",
        (st === "queued" || st === "pending") && imageFlush && "opacity-90",
        menuOpen && "ring-1 ring-brand/40",
        focused && "ring-2 ring-sky-400/70",
        selected && "ring-2 ring-brand/70"
      )}
    >
      {selectable && (
        <button
          type="button"
          aria-label={selected ? t("tooltip.cancelSelection") : t("tooltip.selectMessage")}
          aria-pressed={selected}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.(m.id);
          }}
          className={cn(
            "absolute -left-6 top-2 flex h-4 w-4 items-center justify-center rounded border text-[10px]",
            selected
              ? "border-brand bg-brand text-zinc-950"
              : "border-zinc-600 bg-zinc-900 text-transparent hover:border-brand"
          )}
        >
          ✓
        </button>
      )}
      <div className={cn(!imageFlush && !hasCaption && "space-y-1.5")}>
        {m.isGroup && m.direction === "in" && (() => {
          const senderLabel =
            senderPresentation?.label ||
            (m.senderName && m.senderName !== "群成员"
              ? m.senderName
              : m.senderPhoneE164
                ? `+${String(m.senderPhoneE164).replace(/^\+/, "")}`
                : t("messageBubble.member"));
          const avatarSrc =
            senderPresentation?.avatarUrl || m.senderAvatarUrl || "";
          const avatarFullKnown =
            senderPresentation?.avatarFullUrl ||
            // 消息侧通常只有小图；高清优先走 presentation / 会话内缓存
            "";
          const canDm = Boolean(
            onSenderClick &&
              (senderPresentation?.dmTarget ||
                m.senderJid ||
                m.senderPhoneE164)
          );
          // 仅当已有真实头像图时才允许悬停大图（字母/无图不弹）
          const hasAvatarImg = Boolean(avatarSrc || avatarFullKnown);
          const placeHoverOnAvatar = (avatarEl: HTMLElement) => {
            if (!hasAvatarImg) return;
            const box = avatarEl.getBoundingClientRect();
            const size = 280;
            let x = box.right + 12;
            let y = box.top - 12;
            if (x + size > window.innerWidth - 16) x = box.left - size - 12;
            if (x < 8) x = 8;
            if (y + size + 48 > window.innerHeight - 12)
              y = Math.max(12, window.innerHeight - size - 60);
            if (y < 12) y = 12;

            const jid = String(m.senderJid || "").trim();
            const phone = String(m.senderPhoneE164 || "").trim();
            const cacheKey = jid || phone || avatarFullKnown || avatarSrc;
            const cached = cacheKey ? hdCacheRef.get(cacheKey) : "";
            // 优先：内存缓存 / 已知高清；没有高清时不要立刻把 32px 小图硬放大到 280（会糊）
            const hdReady = cached || avatarFullKnown || "";
            const needFetch = Boolean(jid || phone) && !hdReady;
            setAvatarHover({
              src: hdReady,
              label: senderLabel,
              x,
              y,
              loading: needFetch,
              // 仅在拉取失败时再回退小图，避免默认就糊
              fallbackSrc: avatarSrc || undefined,
            });

            if (needFetch) {
              const accountId =
                useAppStore.getState().settings.liveBaileysAccountId ||
                useAppStore.getState().settings.activeAccountId ||
                undefined;
              // full/hd 优先；后端不支持时再退 image
              void baileysFetchAvatar({
                jid: jid || undefined,
                phone: phone || undefined,
                quality: "full",
                force: false,
                accountId,
              })
                .then(async (res) => {
                  let hd =
                    res?.avatarFullUrl ||
                    (res?.avatarUrl && res.avatarUrl !== avatarSrc
                      ? res.avatarUrl
                      : "") ||
                    "";
                  if (!hd) {
                    const retry = await baileysFetchAvatar({
                      jid: jid || undefined,
                      phone: phone || undefined,
                      quality: "image",
                      force: true,
                      accountId,
                    }).catch(() => null);
                    hd =
                      retry?.avatarFullUrl ||
                      retry?.avatarUrl ||
                      res?.avatarUrl ||
                      "";
                  }
                  if (!hd) {
                    setAvatarHover((prev) =>
                      prev
                        ? {
                            ...prev,
                            // 实在没有高清才用小图，并标记非高清
                            src: prev.fallbackSrc || prev.src || avatarSrc,
                            loading: false,
                            soft: true,
                          }
                        : prev
                    );
                    return;
                  }
                  if (cacheKey) hdCacheRef.set(cacheKey, hd);
                  setAvatarHover((prev) =>
                    prev
                      ? { ...prev, src: hd, loading: false, soft: false }
                      : prev
                  );
                })
                .catch(() => {
                  setAvatarHover((prev) =>
                    prev
                      ? {
                          ...prev,
                          src: prev.fallbackSrc || prev.src || avatarSrc,
                          loading: false,
                          soft: true,
                        }
                      : prev
                  );
                });
            }
          };
          return (
            <div
              className={cn(
                "mb-1 flex max-w-full items-center gap-2",
                imageFlush && "max-w-[min(72vw,22rem)] px-0.5"
              )}
            >
              <span
                data-sender-avatar
                onMouseEnter={(e) => {
                  if (!hasAvatarImg) return;
                  placeHoverOnAvatar(e.currentTarget);
                }}
                onMouseLeave={() => setAvatarHover(null)}
                className={cn(
                  "relative inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full",
                  "bg-zinc-700 text-[11px] font-semibold text-zinc-200",
                  "ring-1 ring-white/10",
                  hasAvatarImg && "cursor-zoom-in"
                )}
              >
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    {avatarInitials(
                      senderLabel && senderLabel !== "群成员"
                        ? senderLabel
                        : m.senderPhoneE164 || m.senderName || "?",
                      "?"
                    )}
                  </span>
                )}
              </span>
              <button
                type="button"
                title={canDm ? t("tooltip.dmMember") : t("tooltip.cannotDmMember")}
                disabled={!canDm}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSenderClick?.(m);
                }}
                className={cn(
                  "min-w-0 truncate text-left text-[12px] font-medium",
                  "disabled:cursor-default disabled:opacity-90",
                  imageFlush ? "text-white" : "text-emerald-300",
                  canDm &&
                    "cursor-pointer underline-offset-2 hover:underline"
                )}
              >
                {senderLabel}
              </button>
            </div>
          );
        })()}
        {m.quoted && (
          <div
            className={cn(
              "rounded-md border-l-2 px-2 py-1 text-[11px]",
              m.direction === "out"
                ? "border-emerald-400/50 bg-black/15 text-zinc-300"
                : "border-sky-400/50 bg-black/20 text-zinc-400"
            )}
          >
            <div className="text-2xs font-medium opacity-80">
              {m.quoted.fromMe ? t("messageBubble.you") : t("messageBubble.other")}
            </div>
            <div className="line-clamp-2 opacity-90">
              <MessageBody
                text={m.quoted.body || t("messageBubble.message")}
                outbound={m.quoted.fromMe}
              />
            </div>
          </div>
        )}
        {m.savedFromMessageId && (
          <div className="mb-1 text-2xs text-brand/75">
            {t("messageBubble.fromChat", { name: m.savedFromContactName || m.savedFromChatName || t("messageBubble.message") })}
          </div>
        )}
        <MessageMedia
          m={m}
          outbound={m.direction === "out"}
          flush={imageFlush || hasCaption}
          mediaBusy={mediaBusy}
          onReloadMedia={stableReloadMedia}
          onPreview={stablePreview}
        />
        {mediaKind === "contact" && <ContactCardMessage m={m} />}
        {shouldShowBodyText(m) && (
          <div
            className={cn(
              "whitespace-pre-wrap break-words",
              hasCaption && "px-3.5 pt-2 pb-0.5"
            )}
          >
            {visibleBody ? (
              <MessageBody
                text={visibleBody}
                outbound={m.direction === "out"}
                mentionLabels={mentionLabels}
              />
            ) : null}
            {inviteLink ? (
              <GroupInviteCard
                text={m.body || ""}
                accountId={m.accountId}
              />
            ) : null}
            {m.edited && (
              <span className="ml-1 text-2xs text-zinc-500">{t("messageBubble.edited")}</span>
            )}
            {showTextTranslate && m.translation && showTranslation && (
              <div
                className={cn(
                  "mt-1 border-t pt-1",
                  m.direction === "out"
                    ? "border-emerald-300/20"
                    : "border-zinc-600/30"
                )}
              >
                <span className="text-2xs font-medium opacity-70">
                  {m.translationLang === "zh"
                    ? t("messageBubble.translatedZh")
                    : `译文（${String(m.translationLang || "").toUpperCase()}）`}
                </span>
                <div className="whitespace-pre-wrap break-words text-zinc-400">
                  {m.translation}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {reactionGroups.length > 0 && (
        <div
          ref={reactionPanelRef}
          className={cn(
            "absolute -bottom-2.5 z-[2] flex max-w-[min(100%,16rem)] flex-wrap items-center gap-0.5",
            m.direction === "out" ? "right-1.5" : "left-1.5"
          )}
        >
          {reactionGroups.map((g) => {
            const open = reactionOpen === g.emoji;
            return (
              <div key={g.emoji} className="relative">
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-5 min-w-[1.25rem] items-center justify-center gap-0.5 rounded-full border px-1 text-[11px] shadow-sm transition-all active:scale-95",
                    g.mine
                      ? "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:border-brand/50 dark:bg-brand/15 dark:text-brand"
                      : "border-black/10 bg-white text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200",
                    open && "ring-1 ring-brand/40"
                  )}
                  title={
                    g.reactors.map((r) => r.label).join("、") || g.emoji
                  }
                  aria-expanded={open}
                  aria-label={t("tooltip.reactionCount", { emoji: g.emoji, count: g.count })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setReactionOpen((cur) =>
                      cur === g.emoji ? null : g.emoji
                    );
                  }}
                >
                  <span>{g.emoji}</span>
                  {g.count > 1 && (
                    <span className="text-2xs tabular-nums text-zinc-400">
                      {g.count}
                    </span>
                  )}
                </button>
                {open && (
                  <div
                    className={cn(
                      "absolute bottom-[calc(100%+6px)] z-20 min-w-[9.5rem] max-w-[14rem] overflow-hidden rounded-lg border border-zinc-700/90 bg-zinc-950 py-1 shadow-xl shadow-black/50",
                      m.direction === "out" ? "right-0" : "left-0"
                    )}
                    role="list"
                  >
                    <div className="border-b border-zinc-800/90 px-2.5 py-1 text-2xs text-zinc-500">
                      {g.emoji} · {g.reactors.length} 人
                    </div>
                    <ul className="max-h-40 overflow-y-auto py-0.5">
                      {g.reactors.map((r) => (
                        <li
                          key={r.key}
                          role="listitem"
                          className={cn(
                            "truncate px-2.5 py-1 text-[11px]",
                            r.from === "me"
                              ? "font-medium text-brand"
                              : "text-zinc-200"
                          )}
                        >
                          {r.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {imageFlush ? (
        <div className="absolute bottom-1.5 right-1.5 z-[1] flex max-w-[95%] flex-wrap items-center justify-end gap-x-1 gap-y-0.5 rounded-md bg-black/55 px-1 py-0.5 text-2xs tabular-nums text-white/95 shadow-sm">
          {m.starred && (
            <Star className="h-3 w-3 fill-amber-300 text-amber-300 drop-shadow" />
          )}
          {m.savedPinned && (
            <Pin className="h-3 w-3 fill-brand text-brand drop-shadow" />
          )}
          <span className="drop-shadow-sm px-0.5">{timeLabel}</span>
          {tick && <Ticks kind={tick} onImage />}
          {statusNode}
          {retryNode}
          {moreBtn}
        </div>
      ) : (
        <div
          className={cn(
            "mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs tabular-nums text-zinc-500",
            hasCaption && "px-3.5 pb-2"
          )}
        >
          {m.starred && (
            <span title={t("tooltip.starred")} className="inline-flex">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            </span>
          )}
          {m.savedPinned && (
            <span title={t("tooltip.pinned")} className="inline-flex">
              <Pin className="h-3 w-3 fill-brand text-brand" />
            </span>
          )}
          <span>{timeLabel}</span>
          {tick && <Ticks kind={tick} />}
          {statusNode}
          {retryNode}
          {showVoiceTranscribe && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                stableTranscribe();
              }}
              disabled={transcribing}
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs transition-colors",
                m.direction === "out"
                  ? "text-zinc-300 hover:bg-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-700",
                transcribing && "opacity-60"
              )}
              title={t("tooltip.transcribeVoice")}
            >
              {transcribing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Captions className="h-3 w-3" />
              )}
              {transcribing ? t("messageBubble.transcribing") : t("messageBubble.toText")}
            </button>
          )}
          {showTextTranslate && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (m.translation) {
                  setShowTranslation((v) => !v);
                } else {
                  onTranslate?.(m.id);
                }
              }}
              disabled={translating}
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs transition-colors",
                m.direction === "out"
                  ? "text-zinc-300 hover:bg-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-700",
                translating && "opacity-60"
              )}
              title={t("tooltip.translateMessage")}
            >
              {translating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Languages className="h-3 w-3" />
              )}
              {translating
                ? t("tooltip.translating")
                : m.translation
                  ? showTranslation
                    ? t("tooltip.originalText")
                    : t("tooltip.translatedText")
                  : t("tooltip.translate")}
            </button>
          )}
          <span
            className={cn(
              "inline-flex opacity-60 group-hover/msg:opacity-100",
              !showVoiceTranscribe && !showTextTranslate && "ml-auto"
            )}
          >
            {moreBtn}
          </span>
        </div>
      )}
    </div>
    {hasVoiceTranscript && (
      <div
        className={cn(
          "mb-2 w-fit max-w-[min(72%,56rem)] rounded-2xl px-3.5 py-2.5 shadow-sm transition-all",
          m.direction === "out"
            ? "message-bubble-out ml-auto mr-0 rounded-tr-[4px] border border-emerald-300/20 bg-emerald-950/90 text-white shadow-lg shadow-black/20"
            : "message-bubble-in mr-auto ml-0 rounded-tl-[4px] border border-white/10 bg-zinc-900/95 text-zinc-200 shadow-lg shadow-black/20"
        )}
      >
        <VoiceBubble
          src={m.mediaUrl || ""}
          seconds={m.mediaSeconds}
          ptt={Boolean(m.mediaPtt)}
          outbound={m.direction === "out"}
          transcript={m.transcript}
          translation={m.translation}
          translationLang={m.translationLang}
          renderTranscriptOnly
        />
      </div>
    )}
    {avatarHover ? createPortal(
      <div
        className="pointer-events-none fixed z-[9999]"
        style={{ left: avatarHover.x, top: avatarHover.y }}
      >
        <div className="overflow-hidden rounded-2xl bg-zinc-950 shadow-2xl shadow-black/70 ring-1 ring-white/20">
          {avatarHover.src ? (
            <img
              src={avatarHover.src}
              alt={avatarHover.label}
              className={cn(
                "h-[280px] w-[280px] object-cover",
                avatarHover.soft && "opacity-95"
              )}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500">
              <span className="h-8 w-8 animate-pulse rounded-full bg-zinc-700/80" />
              <span className="text-[12px]">{t("messageBubble.avatarLoading")}</span>
            </div>
          )}
          <div className="flex max-w-[280px] items-center justify-center gap-2 px-2.5 py-1.5">
            <div className="min-w-0 flex-1 truncate text-center text-[13px] font-medium text-zinc-100">
              {avatarHover.label}
            </div>
            {avatarHover.loading ? (
              <span className="shrink-0 text-2xs text-zinc-500">{t("messageBubble.hd")}</span>
            ) : avatarHover.soft ? (
              <span className="shrink-0 text-2xs text-zinc-600">{t("messageBubble.preview")}</span>
            ) : null}
          </div>
        </div>
      </div>,
      document.body
    ) : null}
    </>
  );
});
