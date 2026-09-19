import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { MessageComposeMenuActions } from "@/components/chat/MessageComposeMenuActions";
import { MessageCopyMenuAction } from "@/components/chat/MessageCopyMenuAction";
import { MessageDeleteMenuActions } from "@/components/chat/MessageDeleteMenuActions";
import { MessageForwardMenuAction } from "@/components/chat/MessageForwardMenuAction";
import { MessageMediaMenuActions } from "@/components/chat/MessageMediaMenuActions";
import { MessageReactionMenu } from "@/components/chat/MessageReactionMenu";
import { MessageReloadMediaMenuAction } from "@/components/chat/MessageReloadMediaMenuAction";
import { MessageRetryMenuAction } from "@/components/chat/MessageRetryMenuAction";
import { SavedMessageMenuActions } from "@/components/chat/SavedMessageMenuActions";
import { SpeakMessageMenuAction } from "@/components/chat/SpeakMessageMenuAction";
import { messagePlainText } from "@/components/chat/chatPanelHelpers";
import { inferMediaType } from "@/components/chat/messageMediaUtils";
import { resolveMessageKeyFrom } from "@/components/chat/resolveMessageKey";
import type { ComposerReplyTo } from "@/components/chat/useTextSend";

type Props = {
  menu: { x: number; y: number; messageId: string } | null;
  messages: Message[];
  contactId?: string | null;
  favoriteStickers: string[];
  mediaBusyId: string | null;
  isBaileys: boolean;
  chatAccountId: string;
  chatConnected: boolean;
  replyTo: ComposerReplyTo | null;
  onClose: () => void;
  onCopy: (text: string) => void;
  onReload: (message: Message) => void;
  onToggleSticker: (source: string) => Promise<void>;
  onRetry: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setReplyTo: (value: ComposerReplyTo | null) => void;
  setDraftReply: (text: string) => void;
  getDraft: () => string;
  onForward: (message: Message) => void;
};

export function MultiWindowMessageMenu({
  menu,
  messages,
  contactId,
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
  getDraft,
  onForward,
}: Props) {
  const contacts = useAppStore((state) => state.contacts);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(Math.max(pad, menu.x), window.innerWidth - rect.width - pad);
    const top = menu.y + rect.height > window.innerHeight - pad
      ? Math.max(pad, menu.y - rect.height - 4)
      : Math.max(pad, menu.y);
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.("[data-msg-context-menu]")) onClose();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const frame = window.setTimeout(() => {
      window.addEventListener("pointerdown", closeOnPointer, true);
      window.addEventListener("keydown", closeOnKey);
    }, 0);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener("pointerdown", closeOnPointer, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const message =
    messages.find((item) => item.id === menu.messageId) ||
    useAppStore.getState().messages.find((item) => item.id === menu.messageId);
  if (!message) return null;

  const plain = messagePlainText(message);
  const mediaKind = inferMediaType(message);
  const messageKey = resolveMessageKeyFrom(message, contacts, contactId || null);
  const canProto = Boolean(messageKey?.id && messageKey.remoteJid);
  const canSave = Boolean(
    message.mediaUrl &&
      (message.mediaUrl.startsWith("data:") ||
        message.mediaUrl.startsWith("blob:") ||
        message.mediaUrl.startsWith("http"))
  );
  const canReloadMedia =
    isBaileys &&
    !canSave &&
    Boolean(mediaKind) &&
    ["image", "sticker", "audio", "video", "gif", "document"].includes(mediaKind);
  const canRetry =
    message.direction === "out" &&
    (message.deliveryStatus === "failed" || message.deliveryStatus === "queued");
  const speakingLang = contacts.find((item) => item.id === contactId)?.language;

  return createPortal(
    <div
      ref={menuRef}
      data-msg-context-menu
      className="fixed z-[9999] max-h-[min(36rem,calc(100vh_-_0.75rem))] min-w-[11rem] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50"
      style={pos ? { left: pos.left, top: pos.top } : { left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MessageCopyMenuAction text={plain} onCopy={onCopy} onClose={onClose} />
      <SpeakMessageMenuAction text={plain} lang={speakingLang} />
      {canReloadMedia && (
        <MessageReloadMediaMenuAction
          busy={mediaBusyId === message.id}
          onClose={onClose}
          onReload={() => onReload(message)}
        />
      )}
      <MessageComposeMenuActions
        message={message}
        plainText={plain}
        canProto={canProto}
        setEditingId={setEditingId}
        setReplyTo={setReplyTo}
        setDraftReply={setDraftReply}
        getDraft={getDraft}
        onClose={onClose}
      />
      <MessageForwardMenuAction
        isBaileys={isBaileys}
        canProto={canProto}
        onClose={onClose}
        onForward={() => onForward(message)}
      />
      <SavedMessageMenuActions message={message} onClose={onClose} />
      <MessageMediaMenuActions
        message={message}
        mediaKind={mediaKind}
        canSave={canSave}
        stickerFavorited={Boolean(message.mediaUrl && favoriteStickers.includes(message.mediaUrl))}
        onToggleSticker={onToggleSticker}
        onClose={onClose}
      />
      {canRetry && (
        <MessageRetryMenuAction
          messageId={message.id}
          onRetry={onRetry}
          onClose={onClose}
        />
      )}
      <MessageReactionMenu
        message={message}
        messageKey={messageKey}
        connected={chatConnected}
        accountId={chatAccountId}
        onClose={onClose}
      />
      <div className="my-1 border-t border-zinc-800" />
      <MessageDeleteMenuActions
        message={message}
        messageKey={messageKey}
        connected={chatConnected}
        accountId={chatAccountId}
        onClearReply={replyTo?.id === message.id ? () => setReplyTo(null) : undefined}
        onClose={onClose}
      />
    </div>,
    document.body
  );
}
