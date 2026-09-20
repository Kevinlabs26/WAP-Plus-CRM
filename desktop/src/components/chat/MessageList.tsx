import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Virtuoso,
  type ListItem,
  type VirtuosoHandle,
} from "react-virtuoso";
import type { Message } from "@/types/crm";
import type { SenderPresentation } from "@/lib/groupSenderDisplay";
import { EmptyState } from "@/components/ui/primitives";
import { syncLog } from "@/lib/syncDebug";
import { ArrowDown } from "lucide-react";
import { useI18n } from "@/i18n";
import { MessageBubble } from "./MessageBubble";
import { shouldAutoLoadMessageMedia } from "./messageMediaUtils";
import {
  resolveMessageFirstItemIndex,
  type MessageVirtualAnchor,
} from "./messageVirtualIndex";

export const MESSAGE_INITIAL_RENDER_COUNT = 80;
const HISTORY_LOAD_THRESHOLD_PX = 600;

export type MessageListHandle = {
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToMessage: (messageId: string, behavior?: "auto" | "smooth") => void;
};

type Props = {
  chatId?: string | null;
  messages: Message[];
  focusMessageId?: string | null;
  menuMessageId?: string | null;
  mediaBusyId?: string | null;
  senderByMessageId?: Record<string, SenderPresentation | undefined>;
  onAtBottomChange?: (atBottom: boolean) => void;
  onScrollActivityChange?: (active: boolean) => void;
  onLoadOlderFromDisk?: (
    chatId: string,
    cursor: { beforeSentAt: string; beforeId: string } | null
  ) => Promise<number> | number;
  onOpenMenu: (
    e: React.MouseEvent | React.PointerEvent,
    messageId: string,
    anchor?: DOMRect | null
  ) => void;
  onRetry: (id: string) => void;
  onReloadMedia: (m: Message, quiet?: boolean) => void;
  onPreview: (src: string, alt: string) => void;
  onSenderClick?: (m: Message) => void;
  selectable?: boolean;
  selectedMessageIds?: ReadonlySet<string>;
  onToggleSelect?: (messageId: string) => void;
  transcribingId?: string | null;
  onTranscribe?: (messageId: string) => void;
  translatingId?: string | null;
  onTranslate?: (messageId: string) => void;
};

const listComponents = {
  Header: () => <div className="h-5" aria-hidden="true" />,
  Footer: () => <div className="h-1" aria-hidden="true" />,
};

const computeMessageKey = (_index: number, message: Message) => message.id;

const MessageListInner = forwardRef<MessageListHandle, Props>(
  function MessageListInner(
    {
      chatId,
      messages,
      focusMessageId,
      menuMessageId,
      mediaBusyId,
      senderByMessageId,
      onAtBottomChange,
      onScrollActivityChange,
      onLoadOlderFromDisk,
      onOpenMenu,
      onRetry,
      onReloadMedia,
      onPreview,
      onSenderClick,
      selectable,
      selectedMessageIds,
      onToggleSelect,
      transcribingId,
      onTranscribe,
      translatingId,
      onTranslate,
    },
    ref
  ) {
    const { t } = useI18n();
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const historyRef = useRef({
      chatId: null as string | null,
      loading: false,
      exhausted: false,
      requestedCursors: new Set<string>(),
    });
    const autoMediaRef = useRef(new Set<string>());
    const anchorRef = useRef<MessageVirtualAnchor>({
      chatId: null,
      messageId: null,
    });
    const [atBottom, setAtBottom] = useState(true);
    const chatKey = chatId ?? null;

    if (historyRef.current.chatId !== chatKey) {
      historyRef.current = {
        chatId: chatKey,
        loading: false,
        exhausted: false,
        requestedCursors: new Set<string>(),
      };
    }

    const firstItemIndex = resolveMessageFirstItemIndex(
      anchorRef.current,
      chatKey,
      messages
    );

    useEffect(() => {
      autoMediaRef.current.clear();
      setAtBottom(true);
      syncLog("message-view", "virtual list ready", {
        chatId,
        msgCount: messages.length,
      });
    }, [chatId]);

    const loadOlder = useCallback(() => {
      const history = historyRef.current;
      if (
        history.chatId !== chatKey ||
        history.loading ||
        history.exhausted ||
        !chatId ||
        !onLoadOlderFromDisk
      ) {
        return;
      }
      const oldest = messages[0];
      const cursor = oldest
        ? { beforeSentAt: oldest.sentAt, beforeId: oldest.id }
        : null;
      const cursorKey = cursor
        ? `${cursor.beforeSentAt}\u0000${cursor.beforeId}`
        : "start";
      if (history.requestedCursors.has(cursorKey)) return;

      history.requestedCursors.add(cursorKey);
      history.loading = true;
      void Promise.resolve(onLoadOlderFromDisk(chatId, cursor))
        .then((added) => {
          if (!added && historyRef.current === history) history.exhausted = true;
        })
        .catch((error) => {
          history.requestedCursors.delete(cursorKey);
          syncLog("message-view", "history page failed", {
            chatId,
            error: String(error),
          });
        })
        .finally(() => {
          history.loading = false;
        });
    }, [chatId, chatKey, messages, onLoadOlderFromDisk]);

    const handleNearTop = useCallback(
      (nearTop: boolean) => {
        if (nearTop) loadOlder();
      },
      [loadOlder]
    );

    const handleAtBottom = useCallback(
      (next: boolean) => {
        setAtBottom(next);
        onAtBottomChange?.(next);
      },
      [onAtBottomChange]
    );

    const handleItemsRendered = useCallback(
      (items: ListItem<Message>[]) => {
        for (const item of items) {
          const message = item.data;
          if (
            !message ||
            autoMediaRef.current.has(message.id) ||
            !shouldAutoLoadMessageMedia(message)
          ) {
            continue;
          }
          autoMediaRef.current.add(message.id);
          onReloadMedia(message, true);
        }
      },
      [onReloadMedia]
    );

    const renderMessage = useCallback(
      (_index: number, message: Message) => (
        <div
          data-message-row-id={message.id}
          className="w-full box-border px-4 pb-2"
        >
          <MessageBubble
            m={message}
            focused={focusMessageId === message.id}
            menuOpen={menuMessageId === message.id}
            mediaBusy={mediaBusyId === message.id}
            senderPresentation={senderByMessageId?.[message.id]}
            onOpenMenu={onOpenMenu}
            onRetry={onRetry}
            onReloadMedia={onReloadMedia}
            onPreview={onPreview}
            onSenderClick={onSenderClick}
            selectable={selectable}
            selected={selectedMessageIds?.has(message.id)}
            onToggleSelect={onToggleSelect}
            transcribing={transcribingId === message.id}
            onTranscribe={onTranscribe}
            translating={translatingId === message.id}
            onTranslate={onTranslate}
          />
        </div>
      ),
      [
        focusMessageId,
        mediaBusyId,
        menuMessageId,
        onOpenMenu,
        onPreview,
        onReloadMedia,
        onRetry,
        onSenderClick,
        onToggleSelect,
        onTranscribe,
        onTranslate,
        selectable,
        selectedMessageIds,
        senderByMessageId,
        transcribingId,
        translatingId,
      ]
    );

    useEffect(() => {
      if (!focusMessageId) return;
      const index = messages.findIndex((message) => message.id === focusMessageId);
      if (index < 0) return;
      const frame = requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "center",
          behavior: "auto",
        });
      });
      return () => cancelAnimationFrame(frame);
    }, [focusMessageId, messages]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom: (behavior = "auto") => {
          virtuosoRef.current?.scrollToIndex({
            index: "LAST",
            align: "end",
            behavior,
          });
        },
        scrollToMessage: (messageId, behavior = "smooth") => {
          const index = messages.findIndex((message) => message.id === messageId);
          if (index < 0) return;
          virtuosoRef.current?.scrollToIndex({
            index,
            align: "center",
            behavior,
          });
        },
      }),
      [messages]
    );

    if (!messages.length) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          <EmptyState
            title={t("tooltip.startConversation")}
            description={t("chat.startConversationHint")}
          />
        </div>
      );
    }

    return (
      <div className="relative min-h-0 flex-1">
        <Virtuoso<Message>
          key={chatKey ?? "no-chat"}
          ref={virtuosoRef}
          className="h-full"
          data={messages}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          computeItemKey={computeMessageKey}
          components={listComponents}
          defaultItemHeight={120}
          alignToBottom
          followOutput="auto"
          atBottomThreshold={24}
          atBottomStateChange={handleAtBottom}
          atTopThreshold={HISTORY_LOAD_THRESHOLD_PX}
          atTopStateChange={handleNearTop}
          increaseViewportBy={{ top: 600, bottom: 360 }}
          isScrolling={onScrollActivityChange}
          itemsRendered={handleItemsRendered}
          itemContent={renderMessage}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            scrollbarGutter: "stable",
            overscrollBehavior: "contain",
          }}
        />
        {!atBottom && (
          <button
            type="button"
            title={t("tooltip.jumpLatest")}
            aria-label={t("tooltip.jumpLatest")}
            className="absolute bottom-4 right-6 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/95 text-zinc-200 shadow-xl shadow-black/40 hover:border-zinc-600 hover:bg-zinc-800"
            onClick={() =>
              virtuosoRef.current?.scrollToIndex({
                index: "LAST",
                align: "end",
                behavior: "auto",
              })
            }
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        )}
      </div>
    );
  }
);

export const MessageList = memo(MessageListInner);
MessageList.displayName = "MessageList";
