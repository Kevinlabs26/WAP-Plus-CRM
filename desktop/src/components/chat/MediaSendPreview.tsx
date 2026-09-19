import { FileText, Loader2, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";

export type PendingMediaKind = "image" | "audio" | "sticker" | "gif" | "file";

export type PendingMediaItem = {
  id: string;
  file: File;
  kind: PendingMediaKind;
  previewUrl?: string;
};

type Props = {
  items: PendingMediaItem[];
  caption: string;
  sendingIndex: number;
  onCaptionChange: (caption: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onSend: () => void;
};

export function MediaSendPreview({
  items,
  caption,
  sendingIndex,
  onCaptionChange,
  onRemove,
  onClose,
  onSend,
}: Props) {
  const { t } = useI18n();
  const sending = sendingIndex >= 0;
  const captionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!sending) captionRef.current?.focus({ preventScroll: true });
  }, [sending]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, sending]);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4" onPointerDown={() => !sending && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t("mediaPreview.ariaLabel")} className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onPointerDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">{t("mediaPreview.title")}</div>
            <div className="text-2xs text-zinc-500">{t("mediaPreview.count", { count: items.length })}</div>
          </div>
          <button type="button" disabled={sending} onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" aria-label={t("mediaPreview.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
          {items.map((item, index) => (
            <div key={item.id} className="relative flex min-h-32 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              {item.previewUrl ? (
                <img src={item.previewUrl} alt={item.file.name} className="max-h-48 w-full object-contain" />
              ) : (
                <div className="min-w-0 px-3 text-center">
                  <FileText className="mx-auto mb-2 h-8 w-8 text-zinc-500" />
                  <div className="truncate text-[11px] text-zinc-300">{item.file.name}</div>
                  <div className="mt-1 text-2xs text-zinc-600">{Math.max(1, Math.ceil(item.file.size / 1024))} KB</div>
                </div>
              )}
              <span
                className="absolute bottom-1.5 left-1.5 rounded-md px-2 py-1 text-2xs font-bold leading-none text-white shadow-lg"
                style={{
                  backgroundColor: "#111827",
                  color: "#ffffff",
                  border: "1px solid rgba(255,255,255,.55)",
                  textShadow: "0 1px 2px rgba(0,0,0,.95)",
                }}
              >
                {item.kind === "sticker" ? t("mediaPreview.sticker") : item.kind === "gif" ? t("mediaPreview.gif") : item.kind === "audio" ? t("mediaPreview.audio") : item.kind === "file" ? t("mediaPreview.file") : t("mediaPreview.image")}
              </span>
              {!sending && (
                <button type="button" onClick={() => onRemove(item.id)} className="absolute right-1.5 top-1.5 rounded-full p-1 text-white shadow-md hover:bg-rose-600" style={{ backgroundColor: "#111827", border: "1px solid rgba(255,255,255,.45)" }} aria-label={t("mediaPreview.remove")}>
                  <X className="h-3 w-3" />
                </button>
              )}
              {sendingIndex === index && <div className="absolute inset-0 flex items-center justify-center bg-black/60"><Loader2 className="h-7 w-7 animate-spin text-brand" /></div>}
              {sending && index < sendingIndex && <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xl text-emerald-400">✓</div>}
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-800 p-3">
          <textarea
            ref={captionRef}
            value={caption}
            disabled={sending}
            onChange={(event) => onCaptionChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={2}
            placeholder={t("mediaPreview.captionPlaceholder")}
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12px] text-zinc-100 outline-none focus:border-brand disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xs text-zinc-500">{t("mediaPreview.stickerNoCaption")}</span>
            <button type="button" disabled={!items.length || sending} onClick={onSend} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-40">
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? t("mediaPreview.sending", { current: sendingIndex + 1, total: items.length }) : t("mediaPreview.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
