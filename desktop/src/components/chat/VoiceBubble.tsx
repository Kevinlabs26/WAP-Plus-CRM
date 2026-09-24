import { useEffect, useMemo, useRef, useState } from "react";
import { Captions, Loader2, Mic, Pause, Play, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const MAX_WHATSAPP_AUDIO_SECONDS = 600;

/** 伪波形条（固定种子，同一条消息形状稳定） */
function WaveBars({
  progress,
  waveform,
  active,
  outbound,
}: {
  progress: number; // 0–1 played
  waveform?: number[];
  active?: boolean;
  outbound?: boolean;
}) {
  const bars = 28;
  // 确定性高度序列
  const heights = useMemo(() => {
    if (waveform?.length) {
      const peak = Math.max(1, ...waveform);
      return Array.from({ length: bars }, (_, i) => {
        const start = Math.floor((waveform.length * i) / bars);
        const end = Math.max(start + 1, Math.floor((waveform.length * (i + 1)) / bars));
        const samples = waveform.slice(start, end);
        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        return 0.18 + (average / peak) * 0.82;
      });
    }
    const h: number[] = [];
    let x = 7;
    for (let i = 0; i < bars; i++) {
      x = (x * 17 + i * 3) % 23;
      h.push(0.28 + (x / 23) * 0.72);
    }
    return h;
  }, [waveform]);
  return (
    <div className="flex h-7 flex-1 items-center gap-[2.5px]" aria-hidden>
      {heights.map((ht, i) => {
        const filled = i / bars <= progress;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] shrink-0 rounded-full transition-colors",
              filled
                ? outbound
                  ? "voice-wave-out-filled bg-emerald-300/90"
                  : "voice-wave-in-filled bg-sky-400/90"
                : outbound
                  ? "voice-wave-out-unfilled bg-white/25"
                  : "voice-wave-in-unfilled bg-zinc-500/70",
              active && filled && "opacity-100"
            )}
            style={{ height: `${Math.round(ht * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

export function VoiceBubble({
  src,
  seconds,
  ptt,
  waveform,
  outbound,
  avatarUrl,
  transcript,
  translation,
  translationLang,
  transcribing,
  onTranscribe,
  renderTranscriptOnly,
  renderAudioOnly,
}: {
  src: string;
  seconds?: number;
  ptt?: boolean;
  waveform?: number[];
  outbound?: boolean;
  avatarUrl?: string;
  transcript?: string;
  translation?: string;
  translationLang?: string;
  transcribing?: boolean;
  onTranscribe?: () => void;
  renderTranscriptOnly?: boolean;
  renderAudioOnly?: boolean;
}) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const knownSeconds = Math.max(0, Number(seconds) || 0);
  const displaySeconds =
    ptt === false
      ? knownSeconds
      : Math.min(MAX_WHATSAPP_AUDIO_SECONDS, knownSeconds);
  const [dur, setDur] = useState(displaySeconds);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCur(a.currentTime || 0);
    const onMeta = () => {
      // WhatsApp's protocol duration is authoritative. The optimistic local
      // data URL can contain the original file (for example 26 minutes),
      // while WhatsApp accepts/truncates voice messages to 10 minutes.
      if (!displaySeconds && Number.isFinite(a.duration) && a.duration > 0) {
        setDur(a.duration);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      setPlaying(false);
      setCur(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
    };
  }, [src, displaySeconds]);

  const total = dur > 0 ? dur : displaySeconds;
  const progress = total > 0 ? Math.min(1, cur / total) : 0;
  const labelLeft = playing || cur > 0 ? formatClock(cur) : formatClock(total);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * total;
    setCur(a.currentTime);
  };

  if (renderTranscriptOnly) {
    if (!transcript) return null;
    return (
      <div className="w-full min-w-[280px] max-w-[min(72vw,36rem)] text-[13px] leading-relaxed break-words whitespace-pre-wrap">
        {translation && (
          <div className="leading-relaxed text-zinc-100">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-2xs font-semibold tracking-wide text-brand">
                {translationLang === "zh"
                  ? t("voice.translationZh")
                  : `${t("tooltip.translatedText")} (${String(translationLang || "").toUpperCase()})`}
              </span>
            </div>
            <div className="leading-relaxed">{translation}</div>
          </div>
        )}
        {translation && (
          <button
            type="button"
            aria-expanded={showTranscript}
            onClick={(e) => {
              e.stopPropagation();
              setShowTranscript((visible) => !visible);
            }}
            className={cn(
              "mt-1 block px-0.5 text-2xs font-medium underline-offset-2 hover:underline",
              outbound ? "text-emerald-700/80" : "text-zinc-500"
            )}
          >
            {showTranscript ? t("voice.hideOriginal") : t("voice.showOriginal")}
          </button>
        )}
        {(!translation || showTranscript) && (
          <div
            className={cn(
              "leading-relaxed text-zinc-200",
              translation && "mt-2 border-t border-black/5 pt-2"
            )}
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-zinc-400">
              <Captions className="h-3 w-3" />
              <span>{t("voice.transcript")}</span>
            </div>
            <div className="leading-relaxed">{transcript}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-1.5 py-0.5"
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      {/* 核心语音播放条：固定黄金宽度 230px，波形固定条数，永不拉伸 */}
      <div className="flex w-[274px] shrink-0 items-center gap-2 px-0.5 py-0.5">
        {!outbound && <VoiceAvatar src={avatarUrl} className="order-1" />}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className={cn(
            "voice-play-button order-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-xs transition-all duration-150 active:scale-95",
            outbound
              ? "bg-brand/20 text-brand hover:bg-brand/30"
              : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          )}
          aria-label={playing ? t("tooltip.pauseVoice") : t("tooltip.playVoice")}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 translate-x-0.5 fill-current" />
          )}
        </button>
        <div className={cn("w-[185px] shrink-0", outbound ? "order-1" : "order-3")}>
          <div
            role="slider"
            tabIndex={0}
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              seek(e);
            }}
          >
            <WaveBars
              progress={progress}
              waveform={waveform}
              active={playing}
              outbound={outbound}
            />
          </div>
          <div className={cn(
            "mt-1 flex items-center justify-between text-[11px] tabular-nums font-medium text-zinc-500",
            outbound && "flex-row-reverse"
          )}>
            <span>{labelLeft}</span>
            {ptt !== false && (
              <span className="text-[10px] text-zinc-500/80">
                {playing ? t("voice.playing") : t("voice.audio")}
              </span>
            )}
          </div>
        </div>
        {outbound && <VoiceAvatar src={avatarUrl} className="order-3" />}
      </div>
      {!renderAudioOnly && transcript ? (
        <div className="voice-transcript-card mt-2.5 w-full min-w-[280px] max-w-[min(72vw,36rem)] rounded-2xl border border-black/10 bg-black/5 p-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap shadow-xs">
          {translation && (
            <div className="leading-relaxed text-zinc-100">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-2xs font-semibold tracking-wide text-brand">
                {translationLang === "zh"
                  ? t("voice.translationZh")
                  : `${t("tooltip.translatedText")} (${String(translationLang || "").toUpperCase()})`}
                </span>
              </div>
              <div className="leading-relaxed">{translation}</div>
            </div>
          )}
          {translation && (
            <button
              type="button"
              aria-expanded={showTranscript}
              onClick={(e) => {
                e.stopPropagation();
                setShowTranscript((visible) => !visible);
              }}
              className={cn(
                "mt-1 block px-0.5 text-2xs font-medium underline-offset-2 hover:underline",
                outbound ? "text-emerald-700/80" : "text-zinc-500"
              )}
            >
              {showTranscript ? t("voice.hideOriginal") : t("voice.showOriginal")}
            </button>
          )}
          {(!translation || showTranscript) && (
            <div
              className={cn(
                "leading-relaxed text-zinc-200",
                translation && "mt-2 border-t border-black/5 pt-2"
              )}
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-zinc-400">
                <Captions className="h-3 w-3" />
                <span>{t("voice.transcript")}</span>
              </div>
              <div className="leading-relaxed">{transcript}</div>
            </div>
          )}
        </div>
      ) : !renderAudioOnly && onTranscribe ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTranscribe();
          }}
          disabled={transcribing}
          className={cn(
            "flex w-fit items-center gap-1 self-end rounded-lg px-2 py-1 text-2xs transition-colors",
            outbound
              ? "bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
              : "bg-zinc-600/60 text-zinc-100 hover:bg-zinc-500/70",
            transcribing && "opacity-60"
          )}
          title={t("tooltip.transcribeTranslate")}
        >
          {transcribing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Captions className="h-3 w-3" />
          )}
          {transcribing ? t("voice.transcribing") : t("voice.toText")}
        </button>
      ) : null}
    </div>
  );
}

function VoiceAvatar({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("relative h-8 w-8 shrink-0 rounded-full bg-zinc-700", className)}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="h-full w-full rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full text-zinc-200">
          <UserRound className="h-4 w-4" />
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-900 bg-brand text-zinc-950">
        <Mic className="h-2 w-2" />
      </span>
    </span>
  );
}
