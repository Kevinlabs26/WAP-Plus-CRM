import { useState } from "react";
import { Square, Volume2 } from "lucide-react";
import {
  isSpeechActive,
  speakMessageText,
  stopSpeaking,
  type SpeakResult,
} from "./speakMessage";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type SpeakMessageMenuActionProps = {
  text: string;
  /** 联系人手动指定的朗读语言；空则自动探测 */
  lang?: string;
};

export function SpeakMessageMenuAction({ text, lang }: SpeakMessageMenuActionProps) {
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [voiceLabel, setVoiceLabel] = useState<string | undefined>(undefined);
  const { t } = useI18n();

  if (!text.trim()) return null;

  const handleSpeak = () => {
    if (speaking || isSpeechActive()) {
      stopSpeaking();
      setSpeaking(false);
      setNotice(undefined);
      return;
    }
    const result: SpeakResult = speakMessageText(text, {
      lang,
      onDone: () => setSpeaking(false),
    });
    setSpeaking(result.started);
    setNotice(result.notice);
    setVoiceLabel(result.voiceLabel);
  };

  return (
    <div className="w-full">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
        onClick={handleSpeak}
      >
        {speaking ? (
          <Square className="h-3.5 w-3.5 text-zinc-400" />
        ) : (
          <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
        )}
        {speaking ? t("speech.stop") : t("speech.read")}
      </button>
      {(notice || (!speaking && voiceLabel)) && (
        <p className={cn("px-3 pb-2 text-[11px] leading-snug", notice ? "text-amber-400/90" : "text-zinc-500")}>
          {notice ?? t("speech.voice", { voice: voiceLabel || "" })}
        </p>
      )}
    </div>
  );
}
