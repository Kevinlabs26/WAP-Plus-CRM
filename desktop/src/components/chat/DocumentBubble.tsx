import { FileText, RefreshCw } from "lucide-react";
import type { Message } from "@/types/crm";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  documentDisplayName,
  documentExtLabel,
  estimateDataUrlBytes,
  formatByteSize,
  mediaPlaceholderState,
  openMediaInNewTab,
  triggerMediaDownload,
} from "./messageMediaUtils";

export function DocumentBubble({
  m,
  outbound,
  mediaBusy,
  onReloadMedia,
}: {
  m: Message;
  outbound?: boolean;
  mediaBusy?: boolean;
  onReloadMedia?: () => void;
}) {
  const { t } = useI18n();
  const name = documentDisplayName(m);
  const ext = documentExtLabel(name, m.mediaMime);
  const bytes = estimateDataUrlBytes(m.mediaUrl);
  const sizeLabel =
    bytes !== undefined ? formatByteSize(bytes) : "";
  const canUse =
    !!m.mediaUrl &&
    (m.mediaUrl.startsWith("data:") ||
      m.mediaUrl.startsWith("blob:") ||
      m.mediaUrl.startsWith("http"));
  const state = mediaPlaceholderState(m, Boolean(mediaBusy));
  const metaLine = [
    ext,
    sizeLabel ||
      (!canUse
        ? state === "loading"
          ? t("document.loading")
          : state === "failed"
            ? t("document.failed")
            : t("document.load")
        : ""),
  ]
    .filter(Boolean)
    .join(" · ");

  // 不再自带边框/底色：外层消息气泡已是唯一边框，避免双层厚框
  return (
    <div
      className="w-[min(68vw,15.5rem)] text-left"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "relative mt-0.5 flex h-10 w-8 shrink-0 items-center justify-center rounded-md",
            outbound ? "bg-black/15 text-emerald-100/85" : "bg-black/25 text-zinc-300"
          )}
          aria-hidden
        >
          <FileText className="h-5 w-5 opacity-90" strokeWidth={1.5} />
          <span
            className={cn(
              "absolute -bottom-0.5 left-1/2 max-w-[2.5rem] -translate-x-1/2 truncate rounded px-1 py-px text-[7.5px] font-bold leading-none tracking-wide",
              outbound
                ? "bg-emerald-800/85 text-emerald-50"
                : "bg-zinc-600/90 text-zinc-100"
            )}
          >
            {ext}
          </span>
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div
            className={cn(
              "line-clamp-2 break-all text-[12.5px] font-medium leading-snug",
              outbound ? "text-zinc-50" : "text-zinc-100"
            )}
            title={name}
          >
            {name}
          </div>
          <div
            className={cn(
              "mt-0.5 text-[10.5px] tabular-nums",
              outbound ? "text-emerald-100/40" : "text-zinc-500"
            )}
          >
            {metaLine || t("document.file")}
          </div>
        </div>
      </div>
      {!canUse ? (
        <button
          type="button"
          disabled={mediaBusy || !onReloadMedia}
          className={cn(
            "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium",
            onReloadMedia
              ? "bg-white/[0.06] text-emerald-300/90 hover:bg-white/[0.1]"
              : "cursor-not-allowed text-zinc-600"
          )}
          onClick={() => onReloadMedia?.()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", mediaBusy && "animate-spin")} />
          {mediaBusy
            ? t("document.loading")
            : state === "failed"
              ? t("document.retry")
              : t("document.load")}
        </button>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-white/[0.06]">
          <button
            type="button"
            className={cn(
              "bg-transparent px-2 py-1.5 text-center text-[12px] font-medium transition",
              outbound
                ? "text-emerald-300/90 hover:bg-black/15"
                : "text-emerald-400/90 hover:bg-white/[0.04]"
            )}
            onClick={() => {
              if (!m.mediaUrl) return;
              void openMediaInNewTab(m.mediaUrl, m.mediaMime).catch(() => {
                try {
                  triggerMediaDownload(m.mediaUrl!, name);
                } catch {
                  /* ignore */
                }
              });
            }}
          >
            {t("document.open")}
          </button>
          <button
            type="button"
            className={cn(
              "bg-transparent px-2 py-1.5 text-center text-[12px] font-medium transition",
              outbound
                ? "text-emerald-300/90 hover:bg-black/15"
                : "text-emerald-400/90 hover:bg-white/[0.04]"
            )}
            onClick={() => {
              if (!m.mediaUrl) return;
              try {
                triggerMediaDownload(m.mediaUrl, name);
              } catch {
                /* ignore */
              }
            }}
          >
            {t("document.saveAs")}
          </button>
        </div>
      )}
    </div>
  );
}

