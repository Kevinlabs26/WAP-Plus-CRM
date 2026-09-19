import { Loader2, Mic, Send } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

type Props = {
  hasDraft: boolean;
  sending: boolean;
  disabled: boolean;
  isBaileys: boolean;
  onSend: () => void;
  onBeginVoice: () => void;
};

/** Text sends immediately; an empty composer starts the voice recorder. */
export function SendVoiceToggle({
  hasDraft,
  sending,
  disabled,
  isBaileys,
  onSend,
  onBeginVoice,
}: Props) {
  const { t } = useI18n();
  if (hasDraft) {
    return (
      <Button
        variant="primary"
        aria-label={t("tooltip.sendMessage")}
        title={t("tooltip.sendMessage")}
        disabled={disabled || sending}
        onClick={onSend}
        className="!h-9 !min-h-9 !w-9 rounded-xl !px-0"
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || sending || !isBaileys}
      title={isBaileys ? t("tooltip.startRecording") : t("tooltip.voiceNeedsBaileys")}
      aria-label={t("tooltip.startRecording")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onBeginVoice}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
