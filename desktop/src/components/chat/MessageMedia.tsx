import { memo } from "react";
import { Mic, Play, RefreshCw, Search, ShoppingBag } from "lucide-react";
import type { Message } from "@/types/crm";
import { cn } from "@/lib/utils";
import { DocumentBubble } from "./DocumentBubble";
import { VoiceBubble } from "./VoiceBubble";
import { inferMediaType, mediaPlaceholderState } from "./messageMediaUtils";
import { useI18n } from "@/i18n";

function MediaReloadHint({
  label,
  busy,
  onReload,
  compact,
  failed,
}: {
  label: string;
  busy?: boolean;
  onReload?: () => void;
  compact?: boolean;
  failed?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-zinc-400",
        compact ? "text-[11px]" : "text-[12px]"
      )}
    >
      {label ? <span>{label}</span> : null}
      {onReload && (
        <button
          type="button"
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-emerald-300/90 hover:bg-white/5",
            busy && "opacity-60"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onReload();
          }}
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
          {busy ? t("media.loading") : failed ? t("media.retry") : t("media.load")}
        </button>
      )}
    </div>
  );
}

function formatDuration(sec?: number) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (!s) return "";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `0:${String(r).padStart(2, "0")}`;
}

function VideoTile({
  m,
  flush,
  mediaBusy,
  onReloadMedia,
}: {
  m: Message;
  flush?: boolean;
  mediaBusy?: boolean;
  onReloadMedia?: () => void;
}) {
  const { t: i18n } = useI18n();
  const dur = formatDuration(m.mediaSeconds);
  const thumb = m.mediaThumbUrl || "";
  const state = mediaPlaceholderState(m, Boolean(mediaBusy));

  if (m.mediaUrl) {
    return (
      <div
        className={cn(
          "relative overflow-hidden bg-transparent w-full max-w-[min(72vw,22rem)]",
          flush ? "rounded-2xl" : "rounded-t-2xl"
        )}
      >
        <video
          controls
          playsInline
          preload="metadata"
          src={m.mediaUrl}
          poster={thumb || undefined}
          className="block h-64 w-full bg-black object-contain"
        />
      </div>
    );
  }

  // 未缓存：优先显示协议缩略图封面，而不是「边框+加载中」文字卡
  return (
    <div
      className={cn(
        "relative overflow-hidden w-full max-w-[min(72vw,22rem)] bg-zinc-900/30",
        flush ? "rounded-2xl" : "rounded-t-2xl"
      )}
    >
      {thumb ? (
        <img
          src={thumb}
          alt={m.mediaCaption || i18n("media.video")}
          className="block h-64 w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          className="video-placeholder-box flex h-60 w-full items-center justify-center bg-zinc-900/40"
        >
          <div className="flex flex-col items-center gap-1.5 text-zinc-400">
            <Play className="h-7 w-7 fill-current opacity-60" />
            <span className="text-[11px] font-medium">
              {state === "failed" ? i18n("media.videoHistoryUnavailable") : i18n("media.videoWaiting")}
            </span>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      <button
        type="button"
        disabled={!onReloadMedia || mediaBusy}
        title={mediaBusy ? i18n("tooltip.videoLoading") : i18n("tooltip.loadVideo")}
        onClick={(e) => {
          e.stopPropagation();
          onReloadMedia?.();
        }}
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "disabled:cursor-wait"
        )}
      >
        <span
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-full",
            "bg-black/50 text-white shadow-md backdrop-blur-xs transition-transform hover:scale-105 active:scale-95",
            mediaBusy && "opacity-80"
          )}
        >
          {mediaBusy ? (
            <RefreshCw className="h-5 w-5 animate-spin" />
          ) : (
            <Play className="h-5 w-5 fill-white pl-0.5" />
          )}
        </span>
      </button>
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2">
        <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-2xs text-white/90 font-medium">
          {state === "loading"
            ? i18n("media.loading")
            : state === "failed"
              ? i18n("media.retryLoad")
              : i18n("media.load")}
          {dur ? ` · ${dur}` : ""}
        </span>
      </div>
    </div>
  );
}

export const MessageMedia = memo(function MessageMedia({
  m,
  outbound,
  avatarUrl,
  flush,
  mediaBusy,
  onReloadMedia,
  onPreview,
}: {
  m: Message;
  outbound?: boolean;
  avatarUrl?: string;
  /** 纯图：与气泡同圆角、无内边距，避免双层框 */
  flush?: boolean;
  mediaBusy?: boolean;
  onReloadMedia?: () => void;
  onPreview?: (src: string, alt: string) => void;
  /** 语音转文字：true 表示该条正在转写 */
}) {
  const { t: i18n } = useI18n();
  const t = inferMediaType(m);
  const state = mediaPlaceholderState(m, Boolean(mediaBusy));
  if (!t) return null;
  if (t === "unknown") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]",
          outbound ? "bg-black/20" : "bg-black/30"
        )}
        title={i18n("tooltip.legacyMedia")}
      >
        <span className="text-base leading-none">📎</span>
        <span className="text-zinc-400">
          {i18n("media.legacy")}
          <span className="ml-1 text-2xs text-zinc-600">
            {i18n("media.legacyHint")}
          </span>
        </span>
      </div>
    );
  }

  if ((t === "image" || t === "sticker") && m.mediaUrl) {
    // 固定盒：避免图片 decode 后改变行高 → Virtuoso 滚动中反复 remeasure
    const box =
      t === "sticker"
        ? "h-40 w-40 max-w-full"
        : "w-full max-w-[min(72vw,22rem)]";
    return (
      <button
        type="button"
        aria-label={i18n("tooltip.zoomImage")}
        className={cn(
          "group relative block cursor-zoom-in overflow-hidden bg-transparent w-full",
          flush ? "rounded-2xl" : "rounded-t-2xl",
          box
        )}
        onClick={(e) => {
          e.stopPropagation();
          onPreview?.(m.mediaUrl!, m.mediaCaption || m.body || i18n("media.image"));
        }}
      >
        <img
          src={m.mediaUrl}
          alt={m.mediaCaption || m.body || i18n("media.image")}
          className={cn(
            t === "sticker"
              ? "h-full w-full object-contain p-1"
              : "block h-auto max-h-[32rem] w-full object-cover"
          )}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 group-hover:bg-black/25 group-hover:opacity-100 transition-opacity">
          <Search className="h-6 w-6 text-white drop-shadow" />
        </span>
      </button>
    );
  }

  if (t === "audio") {
    if (m.mediaUrl) {
      return (
        <VoiceBubble
          src={m.mediaUrl}
          seconds={m.mediaSeconds}
          ptt={Boolean(m.mediaPtt)}
          waveform={m.mediaWaveform}
          outbound={outbound}
          avatarUrl={avatarUrl}
          transcript={m.transcript}
          translation={m.translation}
          translationLang={m.translationLang}
          renderAudioOnly={Boolean(m.transcript)}
        />
      );
    }
    return (
      <button
        type="button"
        disabled={!onReloadMedia || state === "loading"}
        onClick={(event) => {
          event.stopPropagation();
          onReloadMedia?.();
        }}
        className="flex w-full items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2 text-left transition-colors enabled:hover:bg-black/30 disabled:cursor-wait"
      >
        <Mic className="h-4 w-4 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-zinc-300">
            {m.mediaPtt ? i18n("media.voice") : i18n("media.audio")}
          </div>
          <div className="mt-0.5 text-2xs tabular-nums text-zinc-500">
            {m.mediaSeconds ? `${m.mediaSeconds}″ · ` : ""}
            {state === "loading"
              ? i18n("media.loading")
              : state === "failed"
                ? i18n("media.retryLoad")
                : i18n("media.load")}
          </div>
        </div>
        <RefreshCw
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-emerald-300/90",
            state === "loading" && "animate-spin"
          )}
        />
      </button>
    );
  }

  if (t === "product") {
    return (
      <div className="mb-1 overflow-hidden rounded-xl bg-black/20">
        {m.mediaUrl ? (
          <img
            src={m.mediaUrl}
            alt={m.body || i18n("media.product")}
            className="max-h-44 w-full object-cover"
            decoding="async"
          />
        ) : (
          <div className="flex h-20 items-center justify-center">
            <ShoppingBag className="h-6 w-6 text-zinc-500" />
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-2xs text-zinc-400">
          <ShoppingBag className="h-3 w-3" />
          WhatsApp Business
        </div>
      </div>
    );
  }

  if (t === "gif") {
    if (m.mediaUrl?.startsWith("data:image/gif")) {
      return (
        <div className="h-64 w-full max-w-[min(72vw,20rem)] overflow-hidden rounded-xl bg-zinc-900/40">
          <img
            src={m.mediaUrl}
            alt="GIF"
            className="h-full w-full object-contain"
            decoding="async"
            loading="lazy"
          />
        </div>
      );
    }
    if (m.mediaUrl) {
      return (
        <div className="h-64 w-full max-w-[min(72vw,20rem)] overflow-hidden rounded-xl bg-black">
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            src={m.mediaUrl}
            className="h-full w-full object-contain"
          />
        </div>
      );
    }
    return (
      <VideoTile
        m={m}
        flush={flush}
        mediaBusy={mediaBusy}
        onReloadMedia={onReloadMedia}
      />
    );
  }

  if (t === "video") {
    return (
      <VideoTile
        m={m}
        flush={flush}
        mediaBusy={mediaBusy}
        onReloadMedia={onReloadMedia}
      />
    );
  }

  if (t === "document") {
    return (
      <DocumentBubble
        m={m}
        outbound={outbound}
        mediaBusy={mediaBusy}
        onReloadMedia={onReloadMedia}
      />
    );
  }

  if (t === "image" || t === "sticker") {
    // 固定盒占位：与加载后同高，避免媒体到达时高度突变触发 Virtuoso 重排闪烁
    const box =
      t === "sticker"
        ? "h-40 w-40 max-w-full"
        : flush
          ? "h-64 w-full max-w-[min(72vw,22rem)]"
          : "h-64 w-full max-w-[min(72vw,20rem)]";
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-zinc-900/40",
          box,
          flush ? "rounded-2xl" : "rounded-lg"
        )}
      >
        <MediaReloadHint
          label={
            state === "failed"
              ? `${t === "sticker" ? i18n("media.sticker") : i18n("media.image")} ${i18n("media.retry")}`
              : `${t === "sticker" ? i18n("media.sticker") : i18n("media.image")} ${i18n("media.videoWaiting")}`
          }
          busy={mediaBusy}
          failed={state === "failed"}
          onReload={onReloadMedia}
        />
      </div>
    );
  }

  return null;
});
