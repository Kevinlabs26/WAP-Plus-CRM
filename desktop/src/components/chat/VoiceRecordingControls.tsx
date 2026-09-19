import { Pause, Play, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";

type Props = {
  seconds: number;
  paused: boolean;
  sending: boolean;
  readLevel: () => number;
  onDelete: () => void;
  onTogglePause: () => void;
  onSend: () => void;
};

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function VoiceRecordingControls({
  seconds,
  paused,
  sending,
  readLevel,
  onDelete,
  onTogglePause,
  onSend,
}: Props) {
  const { t } = useI18n();
  const [levels, setLevels] = useState<number[]>(() => Array(30).fill(0));

  useEffect(() => {
    if (paused) return;
    const sample = () => {
      const next = Math.max(0, Math.min(1, readLevel()));
      setLevels((current) => [...current.slice(1), next]);
    };
    sample();
    const timer = window.setInterval(sample, 80);
    return () => window.clearInterval(timer);
  }, [paused, readLevel]);

  const recentPeak = Math.max(...levels.slice(-12));
  const signalOk = recentPeak >= 0.04;
  const status = paused
    ? t("voice.statusPaused")
    : signalOk
      ? t("voice.statusOk")
      : seconds >= 2
        ? t("voice.statusSilent")
        : t("voice.statusListening");

  return (
    <div className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-zinc-700/80 bg-zinc-900/95 px-3 shadow-sm shadow-black/20">
      <button
        type="button"
        title={t("tooltip.deleteRecording")}
        aria-label={t("tooltip.deleteRecording")}
        disabled={sending}
        className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-rose-300 disabled:opacity-40"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={
            paused
              ? "h-2.5 w-2.5 rounded-full bg-zinc-500"
              : "h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500"
          }
        />
        <span className="w-10 font-mono text-[14px] tabular-nums text-zinc-100">
          {formatDuration(seconds)}
        </span>
        <div
          className="flex h-7 min-w-20 flex-1 items-center justify-center gap-[2px] overflow-hidden"
          aria-label={t("voice.waveform", { status })}
        >
          {levels.map((level, index) => (
            <span
              key={index}
              className={
                signalOk && !paused
                  ? "w-[3px] shrink-0 rounded-full bg-emerald-400/90 transition-[height] duration-75"
                  : "w-[3px] shrink-0 rounded-full bg-zinc-600 transition-[height] duration-75"
              }
              style={{ height: `${Math.max(3, Math.round(level * 25))}px` }}
            />
          ))}
        </div>
        <span
          className={
            signalOk && !paused
              ? "text-2xs text-emerald-400"
              : seconds >= 2 && !paused
                ? "text-2xs text-amber-400"
                : "text-2xs text-zinc-500"
          }
        >
          {status}
        </span>
      </div>

      <button
        type="button"
        title={paused ? t("voice.resume") : t("voice.pause")}
        aria-label={paused ? t("voice.resume") : t("voice.pause")}
        disabled={sending}
        className="rounded-full p-2 text-rose-400 hover:bg-zinc-800 disabled:opacity-40"
        onClick={onTogglePause}
      >
        {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
      </button>

      <button
        type="button"
        title={t("tooltip.sendVoice")}
        aria-label={t("tooltip.sendVoice")}
        disabled={sending}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
        onClick={onSend}
      >
        <Send className="h-5 w-5" />
      </button>
    </div>
  );
}
