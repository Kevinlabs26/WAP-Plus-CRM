import { Trash2 } from "lucide-react";
import { baileysMessageDelete } from "@/lib/baileys";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { Message, WaMessageKey } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  message: Message;
  messageKey: WaMessageKey | null;
  connected: boolean;
  accountId?: string;
  onClearReply?: () => void;
  onClose: () => void;
};

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

export function MessageDeleteMenuActions({
  message,
  messageKey,
  connected,
  accountId,
  onClearReply,
  onClose,
}: Props) {
  const deleteLocalMessage = useAppStore(
    (state) => state.deleteLocalMessage
  );
  const pushToast = useAppStore((state) => state.pushToast);
  const { t } = useI18n();
  const canRevoke = Boolean(messageKey?.id && messageKey.remoteJid);

  const deleteLocally = () => {
    deleteLocalMessage(message.id);
    onClearReply?.();
  };

  return (
    <>
      {message.direction === "out" && (
        <button
          type="button"
          className={cn(
            ITEM_CLASS,
            "text-amber-200/90 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          )}
          disabled={!canRevoke}
          title={
            canRevoke
              ? t("messageMenu.revokeTitle")
              : t("messageMenu.revokeUnavailable")
          }
          onClick={() => {
            void (async () => {
              try {
                if (!messageKey) {
                  pushToast(
                    t("messageMenu.revokeMissingId"),
                    "info"
                  );
                  return;
                }
                if (!connected) {
                  pushToast(t("messageMenu.connectFirst"), "error");
                  return;
                }
                await baileysMessageDelete(messageKey, true, accountId);
                deleteLocally();
                pushToast(t("messageMenu.revoked"), "success");
              } catch (error) {
                pushToast(
                  error instanceof Error
                    ? error.message
                    : t("messageMenu.revokeFailed"),
                  "error"
                );
              } finally {
                onClose();
              }
            })();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("messageMenu.revokeBoth")}
        </button>
      )}
      <button
        type="button"
        className={cn(ITEM_CLASS, "text-rose-300 hover:bg-rose-500/10")}
        onClick={() => {
          deleteLocally();
          onClose();
          pushToast(t("messageMenu.deletedLocal"), "info");
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t("messageMenu.deleteLocal")}
      </button>
    </>
  );
}
