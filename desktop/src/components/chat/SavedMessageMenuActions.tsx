import { Bookmark, CalendarClock, Pin, Reply, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import { SAVED_MESSAGES_CHAT_ID, type Message } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  message: Message;
  onClose: () => void;
};

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

export function SavedMessageMenuActions({ message, onClose }: Props) {
  const saveMessageToSelf = useAppStore((state) => state.saveMessageToSelf);
  const toggleMessageStarred = useAppStore(
    (state) => state.toggleMessageStarred
  );
  const isMessageSaved = useAppStore((state) => state.isMessageSaved);
  const toggleSavedMessagePinned = useAppStore(
    (state) => state.toggleSavedMessagePinned
  );
  const setSavedMessageTags = useAppStore(
    (state) => state.setSavedMessageTags
  );
  const scheduleSavedMessageTomorrowFollowUp = useAppStore(
    (state) => state.scheduleSavedMessageTomorrowFollowUp
  );
  const openSavedMessageSource = useAppStore(
    (state) => state.openSavedMessageSource
  );
  const pushToast = useAppStore((state) => state.pushToast);
  const { t } = useI18n();
  const isSaved =
    isMessageSaved(message.id) || message.chatId === SAVED_MESSAGES_CHAT_ID;

  return (
    <>
      <button
        type="button"
        className={ITEM_CLASS}
        onClick={() => {
          toggleMessageStarred(message.id);
          onClose();
          pushToast(message.starred ? t("savedMenu.starRemoved") : t("savedMenu.starAdded"), "success");
        }}
      >
        <Star
          className={cn(
            "h-3.5 w-3.5 text-amber-400",
            message.starred && "fill-amber-400"
          )}
        />
        {message.starred ? t("savedMenu.removeStar") : t("savedMenu.addStar")}
      </button>
      <button
        type="button"
        className={ITEM_CLASS}
        disabled={isSaved}
        onClick={() => {
          const saved = saveMessageToSelf(message.id);
          onClose();
          pushToast(
            saved ? t("savedMenu.saved") : t("savedMenu.alreadySaved"),
            "success"
          );
        }}
      >
        <Bookmark className="h-3.5 w-3.5 text-brand" />
        {isSaved ? t("savedMenu.inSaved") : t("savedMenu.save")}
      </button>
      {message.chatId === SAVED_MESSAGES_CHAT_ID && (
        <button
          type="button"
          className={ITEM_CLASS}
          onClick={() => {
            toggleSavedMessagePinned(message.id);
            onClose();
            pushToast(
              message.savedPinned ? t("savedMenu.pinRemoved") : t("savedMenu.pinAdded"),
              "success"
            );
          }}
        >
          <Pin
            className={cn(
              "h-3.5 w-3.5 text-brand",
              message.savedPinned && "fill-brand"
            )}
          />
          {message.savedPinned ? t("savedMenu.unpin") : t("savedMenu.pin")}
        </button>
      )}
      {message.chatId === SAVED_MESSAGES_CHAT_ID && (
        <button
          type="button"
          className={ITEM_CLASS}
          onClick={() => {
            openSavedMessageSource(message.id);
            onClose();
          }}
        >
          <Reply className="h-3.5 w-3.5 text-zinc-400" />
          {t("savedMenu.openSource")}
        </button>
      )}
      {message.chatId === SAVED_MESSAGES_CHAT_ID && (
        <button
          type="button"
          className={ITEM_CLASS}
          onClick={() => {
            const created = scheduleSavedMessageTomorrowFollowUp(message.id);
            onClose();
            if (created) pushToast(t("savedMenu.followUpCreated"), "success");
          }}
        >
          <CalendarClock className="h-3.5 w-3.5 text-violet-300" />
          {t("savedMenu.followUp")}
        </button>
      )}
      {message.chatId === SAVED_MESSAGES_CHAT_ID && (
        <div className="border-y border-zinc-800 px-2 py-1.5">
          <div className="mb-1 text-2xs text-zinc-500">{t("savedMenu.addTag")}</div>
          <div className="flex flex-wrap gap-1">
            {["客户资料", "待跟进", "重要文件", "灵感"].map((tag) => {
              const active = message.savedTags?.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={cn(
                    "rounded px-1.5 py-1 text-2xs",
                    active
                      ? "bg-brand/20 text-brand"
                      : "bg-zinc-800 text-zinc-500 hover:text-zinc-200"
                  )}
                  onClick={() => {
                    const tags = active
                      ? (message.savedTags || []).filter((item) => item !== tag)
                      : [...(message.savedTags || []), tag];
                    setSavedMessageTags(message.id, tags);
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
