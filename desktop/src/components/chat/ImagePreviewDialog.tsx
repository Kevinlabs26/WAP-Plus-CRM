import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";

type Props = {
  preview: {
    src: string;
    alt: string;
  };
  onClose: () => void;
};

export function ImagePreviewDialog({ preview, onClose }: Props) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("tooltip.previewImage")}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/90 p-6"
      onClick={onClose}
      onWheel={(event) => {
        event.preventDefault();
        setScale((current) =>
          Math.min(4, Math.max(0.5, current + (event.deltaY < 0 ? 0.2 : -0.2)))
        );
      }}
    >
      <button
        type="button"
        aria-label={t("tooltip.closeImagePreview")}
        className="fixed right-5 top-5 rounded-full bg-zinc-900/90 p-2 text-zinc-200 hover:bg-zinc-800"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={preview.src}
        alt={preview.alt}
        className="max-h-[86vh] max-w-[90vw] select-none object-contain transition-transform duration-100"
        style={{ transform: `scale(${scale})` }}
        onClick={(event) => event.stopPropagation()}
      />
      <div className="fixed bottom-5 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-zinc-300">
        {t("imagePreview.zoom", { percent: Math.round(scale * 100) })}
      </div>
    </div>
  );
}
