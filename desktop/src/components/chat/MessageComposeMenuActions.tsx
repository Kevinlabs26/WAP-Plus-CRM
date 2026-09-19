import { ClipboardPaste, Pencil, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { useI18n } from "@/i18n";

type ReplyTarget = {
  id: string;
  body: string;
  direction: "in" | "out";
};

type Props = {
  message: Message;
  plainText: string;
  canProto: boolean;
  setEditingId: (id: string | null) => void;
  setReplyTo: (value: ReplyTarget | null) => void;
  setDraftReply: (text: string) => void;
  getDraft?: () => string;
  onClose: () => void;
};

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

export function MessageComposeMenuActions({
  message,
  plainText,
  canProto,
  setEditingId,
  setReplyTo,
  setDraftReply,
  getDraft,
  onClose,
}: Props) {
  const pushToast = useAppStore((state) => state.pushToast);
  const { t } = useI18n();

  const copyTextSafe = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(t("messageMenu.copied"), "success");
    } catch {
      pushToast(t("messageMenu.copyFailed"), "error");
    }
  };

  return (
    <>
      <button
        type="button"
        className={ITEM_CLASS}
        onClick={() => {
          setEditingId(null);
          setReplyTo({
            id: message.id,
            body: plainText.replace(/\s+/g, " ").slice(0, 160),
            direction: message.direction,
          });
          onClose();
          pushToast(t("messageMenu.quoted"), "info");
        }}
      >
        <Reply className="h-3.5 w-3.5 text-zinc-400" />
        {t("messageMenu.quote")}
      </button>
      {message.direction === "out" && (
        <button
          type="button"
          className={cn(
            ITEM_CLASS,
            "disabled:cursor-not-allowed disabled:opacity-45"
          )}
          disabled={!canProto || !!(message.mediaType && message.mediaType !== "")}
          title={
            message.mediaType
              ? t("messageMenu.editTextOnly")
              : canProto
                ? t("messageMenu.edit")
                : t("messageMenu.noProtocolId")
          }
          onClick={() => {
            if (!canProto) {
              pushToast(t("messageMenu.cannotEdit"), "info");
              return;
            }
            setReplyTo(null);
            setEditingId(message.id);
            setDraftReply(message.body || "");
            onClose();
            pushToast(t("messageMenu.editHint"), "info");
          }}
        >
          <Pencil className="h-3.5 w-3.5 text-zinc-400" />
          {t("messageMenu.edit")}
        </button>
      )}
      <button
        type="button"
        className={ITEM_CLASS}
        onClick={() => {
          void copyTextSafe(plainText);
          const current =
            getDraft?.() ?? useAppStore.getState().draftReply ?? "";
          setDraftReply(current ? `${current}\n${plainText}` : plainText);
          onClose();
          pushToast(t("messageMenu.fillInput"), "info");
        }}
      >
        <ClipboardPaste className="h-3.5 w-3.5 text-zinc-400" />
        {t("messageMenu.fillInput")}
      </button>
    </>
  );
}
