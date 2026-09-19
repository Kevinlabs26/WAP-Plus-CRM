import { useLayoutEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { MessageComposeMenuActions } from "./MessageComposeMenuActions";
import { MessageCopyMenuAction } from "./MessageCopyMenuAction";
import { MessageDeleteMenuActions } from "./MessageDeleteMenuActions";
import { MessageForwardMenuAction } from "./MessageForwardMenuAction";
import { MessageMediaMenuActions } from "./MessageMediaMenuActions";
import { MessageReactionMenu } from "./MessageReactionMenu";
import { MessageReloadMediaMenuAction } from "./MessageReloadMediaMenuAction";
import { MessageRetryMenuAction } from "./MessageRetryMenuAction";
import { SpeakMessageMenuAction } from "./SpeakMessageMenuAction";
import { SavedMessageMenuActions } from "./SavedMessageMenuActions";
import { messagePlainText } from "./chatPanelHelpers";
import { inferMediaType } from "./messageMediaUtils";
import { resolveMessageKeyFrom } from "./resolveMessageKey";

type ReplyTarget = {
  id: string;
  body: string;
  direction: "in" | "out";
};

type Props = {
  menu: { x: number; y: number; messageId: string } | null;
  chatMessages: Message[];
  favoriteStickers: string[];
  mediaBusyId: string | null;
  isBaileys: boolean;
  chatAccountId?: string;
  chatConnected: boolean;
  replyTo: ReplyTarget | null;
  onClose: () => void;
  onCopy: (text: string) => void;
  onReload: (m: Message) => void;
  onToggleSticker: (source: string) => Promise<void>;
  onRetry: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setReplyTo: (value: ReplyTarget | null) => void;
  setDraftReply: (text: string) => void;
  onForward: (m: Message) => void;
};

export function ChatPanelMessageMenu({
  menu,
  chatMessages,
  favoriteStickers,
  mediaBusyId,
  isBaileys,
  chatAccountId,
  chatConnected,
  replyTo,
  onClose,
  onCopy,
  onReload,
  onToggleSticker,
  onRetry,
  setEditingId,
  setReplyTo,
  setDraftReply,
  onForward,
}: Props) {
  const contacts = useAppStore((s) => s.contacts);
  const selectedContactId = useAppStore((s) => s.selectedContactId);
  // 朗读语言：联系人手动指定（ContactEditor「语言（朗读）」）优先，否则自动探测
  const speakingLang = contacts.find((c) => c.id === selectedContactId)?.language;

  // 按真实渲染尺寸把菜单钳回视口内，避免长菜单（收藏里的标签区等）被窗口边框盖住。
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = menu.x;
    let top = menu.y;
    if (rect.width) left = Math.min(left, vw - rect.width - pad);
    if (rect.height) {
      if (menu.y + rect.height > vh - pad) {
        const flipUp = menu.y - rect.height - 4;
        top = flipUp >= pad ? flipUp : vh - rect.height - pad;
      }
    }
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top) });
  }, [menu]);

  if (!menu) return null;
  const m =
    chatMessages.find((x) => x.id === menu.messageId) ||
    useAppStore.getState().messages.find((x) => x.id === menu.messageId);
  if (!m) return null;
  const plain = messagePlainText(m);
  const protoKey = resolveMessageKeyFrom(m, contacts, selectedContactId);
  const canProto = Boolean(protoKey?.id && protoKey?.remoteJid);
  const canSave =
    !!m.mediaUrl &&
    (m.mediaUrl.startsWith("data:") ||
      m.mediaUrl.startsWith("blob:") ||
      m.mediaUrl.startsWith("http"));
  const mediaKind = inferMediaType(m);
  const stickerFavorited = Boolean(
    mediaKind === "sticker" &&
      m.mediaUrl &&
      favoriteStickers.includes(m.mediaUrl)
  );
  const canReloadMedia =
    isBaileys &&
    !canSave &&
    !!mediaKind &&
    ["image", "sticker", "audio", "video", "gif", "document"].includes(
      mediaKind
    );
  const canRetry =
    m.direction === "out" &&
    (m.deliveryStatus === "failed" || m.deliveryStatus === "queued");

  return (
    <div
      ref={menuRef}
      data-msg-context-menu
      className="fixed z-[9999] max-h-[min(36rem,calc(100vh_-_0.75rem))] min-w-[11rem] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : { left: menu.x, top: menu.y }
      }
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MessageCopyMenuAction
        text={plain}
        onCopy={onCopy}
        onClose={onClose}
      />
      <SpeakMessageMenuAction text={plain} lang={speakingLang} />
      {canReloadMedia && (
        <MessageReloadMediaMenuAction
          busy={mediaBusyId === m.id}
          onClose={onClose}
          onReload={() => void onReload(m)}
        />
      )}
      <MessageComposeMenuActions
        message={m}
        plainText={plain}
        canProto={canProto}
        setEditingId={setEditingId}
        setReplyTo={setReplyTo}
        setDraftReply={setDraftReply}
        onClose={onClose}
      />
      <MessageForwardMenuAction
        isBaileys={isBaileys}
        canProto={canProto}
        onClose={onClose}
        onForward={() => onForward(m)}
      />
      <SavedMessageMenuActions
        message={m}
        onClose={onClose}
      />
      <MessageMediaMenuActions
        message={m}
        mediaKind={mediaKind}
        canSave={canSave}
        stickerFavorited={stickerFavorited}
        onToggleSticker={onToggleSticker}
        onClose={onClose}
      />
      {canRetry && (
        <MessageRetryMenuAction
          messageId={m.id}
          onRetry={onRetry}
          onClose={onClose}
        />
      )}
      <MessageReactionMenu
        message={m}
        messageKey={protoKey}
        connected={chatConnected}
        accountId={chatAccountId}
        onClose={onClose}
      />
      <div className="my-1 border-t border-zinc-800" />
      <MessageDeleteMenuActions
        message={m}
        messageKey={protoKey}
        connected={chatConnected}
        accountId={chatAccountId}
        onClearReply={
          replyTo?.id === m.id ? () => setReplyTo(null) : undefined
        }
        onClose={onClose}
      />
    </div>
  );
}