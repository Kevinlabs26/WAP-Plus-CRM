import { FileText, Loader2, X } from "lucide-react";
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
  sendingIndex: number;
  onRemove: (id: string) => void;
  onClose: () => void;
};

export function MediaSendPreview({
  items,
  sendingIndex,
  onRemove,
  onClose,
}: Props) {
  const { t } = useI18n();
  const sending = sendingIndex >= 0;

  return (
    <div className="mb-2 rounded-2xl border border-zinc-700/80 bg-zinc-900/90 p-2 shadow-sm shadow-black/20">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <div className="text-[11px] font-medium text-zinc-300">
          {t("mediaPreview.title")} <span className="text-zinc-500">· {t("mediaPreview.count", { count: items.length })}</span>
        </div>
        <button type="button" disabled={sending} onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30" aria-label={t("mediaPreview.close")}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((item, index) => (
          <div key={item.id} className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 sm:h-28 sm:w-28">
            {item.previewUrl ? (
              <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-contain" />
            ) : (
              <div className="min-w-0 px-3 text-center">
                <FileText className="mx-auto mb-1.5 h-7 w-7 text-zinc-500" />
                <div className="truncate text-[10px] text-zinc-300">{item.file.name}</div>
                <div className="mt-1 text-[9px] text-zinc-600">{Math.max(1, Math.ceil(item.file.size / 1024))} KB</div>
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
      <div className="px-1 pt-1 text-[10px] text-zinc-500">{t("mediaPreview.captionPlaceholder")}</div>
    </div>
  );
}
