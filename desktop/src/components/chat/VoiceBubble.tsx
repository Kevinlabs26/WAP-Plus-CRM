import { useEffect, useMemo, useState } from "react";
import { Captions, Loader2, MessageCircle, Mic, Pause, Play, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const MAX_WHATSAPP_AUDIO_SECONDS = 600;
let sharedAudio: HTMLAudioElement | null = null;
let sharedAudioSrc = "";
type PlaybackMeta = {
  chatId?: string;
  messageId?: string;
  accountId?: string;
  chatName: string;
  sentAt?: string;
};
type PlaybackSnapshot = PlaybackMeta & {
  currentTime: number;
  duration: number;
  playing: boolean;
};
let sharedPlaybackMeta: PlaybackMeta | null = null;
const playbackListeners = new Set<() => void>();

function notifyPlaybackChange() {
  playbackListeners.forEach((listener) => listener());
}

function getSharedAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    ["timeupdate", "loadedmetadata", "durationchange", "play", "pause", "ended"].forEach(
      (event) => sharedAudio?.addEventListener(event, notifyPlaybackChange)
    );
  }
  return sharedAudio;
}

function selectSharedAudio(src: string, meta?: PlaybackMeta) {
  const audio = getSharedAudio();
  if (sharedAudioSrc !== src) {
    audio.pause();
    sharedAudioSrc = src;
    audio.src = src;
  }
  if (meta) sharedPlaybackMeta = meta;
  notifyPlaybackChange();
  return audio;
}

function getPlaybackSnapshot(): PlaybackSnapshot | null {
  if (!sharedAudio || !sharedAudioSrc || !sharedPlaybackMeta || sharedAudio.ended) {
    return null;
  }
  return {
    ...sharedPlaybackMeta,
    currentTime: sharedAudio.currentTime || 0,
    duration: Number.isFinite(sharedAudio.duration) ? sharedAudio.duration : 0,
    playing: !sharedAudio.paused,
  };
}

function toggleCurrentPlayback() {
  if (!sharedAudio) return;
  if (sharedAudio.paused) void sharedAudio.play().catch(() => undefined);
  else sharedAudio.pause();
}

function stopCurrentPlayback() {
  if (sharedAudio) {
    sharedAudio.pause();
    sharedAudio.currentTime = 0;
  }
  sharedPlaybackMeta = null;
  notifyPlaybackChange();
}

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
  chatId,
  messageId,
  accountId,
  sentAt,
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
  chatId?: string;
  messageId?: string;
  accountId?: string;
  sentAt?: string;
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
    const syncPlayback = () => {
      const a = sharedAudio;
      if (!a || sharedAudioSrc !== src) {
        setPlaying(false);
        setCur(0);
        return;
      }
      setPlaying(!a.paused);
      setCur(a.ended ? 0 : a.currentTime || 0);
      // WhatsApp's protocol duration is authoritative. The optimistic local
      // data URL can contain the original file (for example 26 minutes),
      // while WhatsApp accepts/truncates voice messages to 10 minutes.
      if (!displaySeconds && Number.isFinite(a.duration) && a.duration > 0) {
        setDur(a.duration);
      }
    };
    playbackListeners.add(syncPlayback);
    syncPlayback();
    return () => {
      playbackListeners.delete(syncPlayback);
    };
  }, [src, displaySeconds]);

  const total = dur > 0 ? dur : displaySeconds;
  const progress = total > 0 ? Math.min(1, cur / total) : 0;
  const labelLeft = playing || cur > 0 ? formatClock(cur) : formatClock(total);

  const toggle = () => {
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId);
    const a = selectSharedAudio(src, {
      chatId,
      messageId,
      accountId: accountId || chat?.accountId || chat?.phoneId,
      chatName: chat?.contactName || chat?.id || t("voice.audio"),
      sentAt,
    });
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!total) return;
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId);
    const a = selectSharedAudio(src, {
      chatId,
      messageId,
      accountId: accountId || chat?.accountId || chat?.phoneId,
      chatName: chat?.contactName || chat?.id || t("voice.audio"),
      sentAt,
    });
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

export function VoicePlaybackHost() {
  const { t } = useI18n();
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const activeNav = useAppStore((state) => state.activeNav);
  const [playback, setPlayback] = useState(getPlaybackSnapshot);

  useEffect(() => {
    const syncPlayback = () => setPlayback(getPlaybackSnapshot());
    playbackListeners.add(syncPlayback);
    syncPlayback();
    return () => {
      playbackListeners.delete(syncPlayback);
    };
  }, []);

  if (
    !playback ||
    (activeNav === "chats" && playback.chatId === selectedChatId)
  ) {
    return null;
  }

  const returnToMessage = () => {
    if (!playback.chatId) return;
    const state = useAppStore.getState();
    state.setSelectedChat(playback.chatId, playback.accountId);
    if (playback.messageId) state.setFocusMessageId(playback.messageId);
  };
  const currentTime = formatClock(playback.currentTime);
  const duration = formatClock(playback.duration);

  return (
    <div className="flex shrink-0 items-center justify-center border-t border-zinc-800 bg-zinc-950/95 px-3 py-1.5">
      <div className="flex min-w-0 max-w-3xl flex-1 items-center gap-3">
        <button
          type="button"
          onClick={toggleCurrentPlayback}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand hover:bg-brand/25"
          aria-label={playback.playing ? t("tooltip.pauseVoice") : t("tooltip.playVoice")}
        >
          {playback.playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-0.5 fill-current" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-zinc-200">
            {t("voice.playing")} · {playback.chatName}
          </div>
          <div className="text-[10px] tabular-nums text-zinc-500">
            {currentTime} / {duration}{playback.sentAt ? ` · ${playback.sentAt.slice(11, 16)}` : ""}
          </div>
        </div>
        {playback.chatId && (
          <button
            type="button"
            onClick={returnToMessage}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-brand hover:bg-brand/10"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {t("voice.returnToMessage")}
          </button>
        )}
        <button
          type="button"
          onClick={stopCurrentPlayback}
          className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label={t("voice.stopPlayback")}
          title={t("voice.stopPlayback")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
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
