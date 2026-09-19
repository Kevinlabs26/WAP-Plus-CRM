import { useEffect } from "react";
import { Coffee, Github, Heart, QrCode, Star, X } from "lucide-react";
import { DONATION_PLATFORMS, donationQrUrl } from "@/lib/donation";
import { useI18n } from "@/i18n";

const ICONS = {
  coffee: Coffee,
  github: Github,
  heart: Heart,
  star: Star,
};

export function DonateModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="donate-title"
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3 border-b border-zinc-800 px-4 py-4">
          <Heart className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <h2 id="donate-title" className="text-[14px] font-semibold text-zinc-100">
              {t("donate.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              {t("donate.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title={t("donate.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-3">
          {DONATION_PLATFORMS.map((platform) => {
            const Icon = ICONS[platform.icon];
            return (
              <div
                key={platform.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3 text-center"
              >
                <div className="mb-2 flex items-center justify-center gap-1.5">
                  <Icon className="h-4 w-4 text-rose-300" />
                  <div className="text-[12px] font-medium text-zinc-100">
                    {platform.label}
                  </div>
                </div>
                <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg bg-white p-2">
                  <img
                    src={donationQrUrl(platform.url, 200)}
                    alt={t("donate.qrAlt", { name: platform.label })}
                    className="h-full w-full"
                    loading="eager"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="mt-2 text-2xs text-zinc-500">{t(platform.descriptionKey)}</div>
                <div className="mt-1 text-2xs text-zinc-600">{t("donate.scan")}</div>
                <a
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-brand/50 hover:text-brand"
                >
                  {t("donate.openDesktop")}
                </a>
              </div>
            );
          })}
        </div>
        <div className="px-4 pb-4 text-center text-2xs text-zinc-600">
          <QrCode className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom text-brand" />
          {t("donate.footer")}
        </div>
      </div>
    </div>
  );
}
