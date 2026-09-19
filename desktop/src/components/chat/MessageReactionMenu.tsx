import { Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { baileysMessageReact } from "@/lib/baileys";
import { useAppStore } from "@/store/appStore";
import type { Message, WaMessageKey } from "@/types/crm";
import { placeReactionPicker } from "./reactionPickerPosition";
import { useI18n } from "@/i18n";

const ReactionEmojiPicker = lazy(() =>
  import("./ReactionEmojiPicker").then((module) => ({
    default: module.ReactionEmojiPicker,
  }))
);

type Props = {
  message: Message;
  messageKey: WaMessageKey | null;
  connected: boolean;
  accountId?: string;
  onClose: () => void;
};

export function MessageReactionMenu({
  message,
  messageKey,
  connected,
  accountId,
  onClose,
}: Props) {
  const { t } = useI18n();
  const updateMessageDelivery = useAppStore(
    (state) => state.updateMessageDelivery
  );
  const pushToast = useAppStore((state) => state.pushToast);
  const canReact = Boolean(messageKey?.id && messageKey.remoteJid);
  const [pickerPosition, setPickerPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const react = async (emoji: string) => {
    const previous = message.reactions || [];
    let optimistic = false;
    try {
      if (!messageKey) {
        pushToast(t("reaction.noIdToast"), "info");
        return;
      }
      if (!connected) {
        pushToast(t("messageMenu.connectFirst"), "error");
        return;
      }
      const existingMine = previous.find((reaction) => reaction.from === "me");
      const removing = existingMine?.emoji === emoji;
      const reactionText = removing ? "" : emoji;
      // 乐观：先贴到气泡上
      const next = [
        ...previous.filter((reaction) => reaction.from !== "me"),
        ...(removing ? [] : [{ emoji, from: "me" as const }]),
      ];
      // 同一反应者只保留一条；不同人可以使用同一个 emoji。
      const deduplicated = next.filter(
        (reaction, index, reactions) => {
          const actorKey =
            reaction.from === "me"
              ? "me"
              : reaction.participantJid
                ? `member:${reaction.participantJid}`
                : reaction.from === "peer"
                  ? "peer"
                  : `member:${reaction.participantName || "?"}`;
          return (
            reactions.findIndex((item) => {
              const itemKey =
                item.from === "me"
                  ? "me"
                  : item.participantJid
                    ? `member:${item.participantJid}`
                    : item.from === "peer"
                      ? "peer"
                      : `member:${item.participantName || "?"}`;
              return itemKey === actorKey;
            }) === index
          );
        }
      );
      updateMessageDelivery(message.id, { reactions: deduplicated });
      optimistic = true;
      await baileysMessageReact(messageKey, reactionText, accountId);
      pushToast(
        t(removing ? "reaction.removed" : "reaction.sent", { emoji }),
        "success"
      );
    } catch (error) {
      if (optimistic) updateMessageDelivery(message.id, { reactions: previous });
      pushToast(error instanceof Error ? error.message : t("reaction.failed"), "error");
    } finally {
      onClose();
    }
  };

  return (
    <div className="border-t border-zinc-800 px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{t("reaction.title")}</span>
        {!canReact && <span className="text-zinc-600">{t("reaction.needProtocolId")}</span>}
      </div>
      <div className="flex items-center gap-0.5">
        {["👍", "❤️", "😂", "😮", "🙏"].map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            title={
              canReact
                ? t("reaction.send")
                : t("reaction.noMessageId")
            }
            disabled={!canReact}
            onClick={() => void react(emoji)}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          aria-label={t("tooltip.reactionPicker")}
          title={canReact ? t("tooltip.reactionPicker") : t("tooltip.reactionNoId")}
          disabled={!canReact}
          className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-35"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPickerPosition(placeReactionPicker(rect, {
              width: window.innerWidth,
              height: window.innerHeight,
            }));
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {pickerPosition &&
        createPortal(
          <div
            data-msg-context-menu
            role="dialog"
            aria-label={t("tooltip.reactionDialog")}
            className="fixed z-[10000] w-[22rem]"
            style={pickerPosition}
          >
            <Suspense
              fallback={
                <div className="flex h-[23.25rem] items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-[12px] text-zinc-500 shadow-2xl shadow-black/60">
                  {t("reaction.loading")}
                </div>
              }
            >
              <ReactionEmojiPicker
                onPick={(emoji) => void react(emoji)}
                onClose={() => setPickerPosition(null)}
              />
            </Suspense>
          </div>,
          document.body
        )}
    </div>
  );
}
