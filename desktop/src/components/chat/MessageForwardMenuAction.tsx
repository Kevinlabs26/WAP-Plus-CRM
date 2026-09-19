import { Send } from "lucide-react";
import { useI18n } from "@/i18n";

type MessageForwardMenuActionProps = {
  isBaileys: boolean;
  canProto: boolean;
  onForward: () => void;
  onClose: () => void;
};

export function MessageForwardMenuAction({
  isBaileys,
  canProto,
  onForward,
  onClose,
}: MessageForwardMenuActionProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={!isBaileys || !canProto}
      title={
        !isBaileys
          ? t("messageMenu.forwardBaileys")
          : canProto
            ? t("messageMenu.forwardChoose")
            : t("messageMenu.forwardNoId")
      }
      onClick={() => {
        onClose();
        onForward();
      }}
    >
      <Send className="h-3.5 w-3.5 text-zinc-400" />
      {t("messageMenu.forward")}
    </button>
  );
}
