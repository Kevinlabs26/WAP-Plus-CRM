import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type Props = {
  preview: {
    src: string;
    alt: string;
    fallbackSrc?: string;
    loading?: boolean;
    error?: string;
  };
  onClose: () => void;
  className?: string;
};

export function ImagePreviewDialog({ preview, onClose, className }: Props) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedFallback, setFailedFallback] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const imageSrc = failedSrc === preview.src ? preview.fallbackSrc : preview.src;
  const showImage = Boolean(imageSrc && failedFallback !== imageSrc);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("tooltip.previewImage")}
      className={cn("fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/90 p-6", className)}
      onClick={onClose}
      onWheel={(event) => {
        event.preventDefault();
        setScale((current) =>
          Math.min(4, Math.max(0.5, current + (event.deltaY < 0 ? 0.2 : -0.2)))
        );
      }}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label={t("tooltip.closeImagePreview")}
        className="fixed right-5 top-5 rounded-full bg-zinc-900/90 p-2 text-zinc-200 hover:bg-zinc-800"
        onClick={(event) => { event.stopPropagation(); onClose(); }}
      >
        <X className="h-5 w-5" />
      </button>
      {showImage && <img
        src={imageSrc}
        alt={preview.alt}
        className="max-h-[86vh] max-w-[90vw] select-none object-contain transition-transform duration-100"
        style={{ transform: `scale(${scale})` }}
        referrerPolicy="no-referrer"
        onError={() => {
          if (imageSrc === preview.src && preview.fallbackSrc && preview.fallbackSrc !== imageSrc) setFailedSrc(preview.src);
          else setFailedFallback(imageSrc || null);
        }}
        onClick={(event) => event.stopPropagation()}
      />}
      {!showImage && !preview.loading && <p role="status" className="text-center text-sm text-white">{preview.error || t("imagePreview.loadFailed")}</p>}
      <div className="fixed bottom-5 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-zinc-300">
        {preview.loading ? t("messageBubble.avatarLoading") : showImage ? t("imagePreview.zoom", { percent: Math.round(scale * 100) }) : null}
      </div>
    </div>
  );
}
