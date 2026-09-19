import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, QrCode, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { getAppInfo, isTauri } from "@/lib/bridge";
import {
  DONATION_PLATFORMS,
  donationQrUrl,
  type DonationPlatform,
} from "@/lib/donation";
import { PENDING_UPDATE_STORAGE_KEY } from "@/lib/appUpdate";

const LAST_RUNNING_VERSION_KEY = "wap-plus.last-running-version";
// v0.1.6 predates this marker, so let the first release containing the
// feature show the confirmation once even when the old app cannot write it.
const FIRST_COMPLETION_MODAL_VERSION = "0.1.7";

type PendingUpdate = {
  version?: string;
};

export function UpdateCompleteModal({ ready }: { ready: boolean }) {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [visible, setVisible] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<DonationPlatform | null>(null);

  useEffect(() => {
    if (!isTauri() || typeof window === "undefined") return;

    void getAppInfo()
      .then((info) => {
        const currentVersion = String(info.version || "").trim();
        if (!currentVersion) return;

        const previousVersion = window.localStorage.getItem(
          LAST_RUNNING_VERSION_KEY
        );
        const pendingRaw = window.localStorage.getItem(
          PENDING_UPDATE_STORAGE_KEY
        );
        let pending: PendingUpdate | null = null;
        try {
          pending = pendingRaw ? (JSON.parse(pendingRaw) as PendingUpdate) : null;
        } catch {
          pending = null;
        }

        window.localStorage.setItem(LAST_RUNNING_VERSION_KEY, currentVersion);
        window.localStorage.removeItem(PENDING_UPDATE_STORAGE_KEY);

        const wasUpdated =
          pending?.version === currentVersion ||
          Boolean(previousVersion && previousVersion !== currentVersion) ||
          (!previousVersion && currentVersion === FIRST_COMPLETION_MODAL_VERSION);
        if (wasUpdated) {
          setVersion(currentVersion);
          setVisible(true);
        }
      })
      .catch(() => {
        // Update confirmation is optional and must never block startup.
      });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVisible(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [visible]);

  if (!ready || !visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-complete-title"
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setVisible(false);
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3 border-b border-zinc-800 px-4 py-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <h2
              id="update-complete-title"
              className="text-[14px] font-semibold text-zinc-100"
            >
              {t("updateComplete.title")}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              {t("updateComplete.description", { version })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title={t("updateComplete.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="mb-3 text-[12px] font-medium text-zinc-200">
            {t("updateComplete.sponsorTitle")}
          </div>
          <p className="mb-3 text-[11px] text-zinc-500">
            {t("updateComplete.sponsorHint")}
          </p>
          <div className="grid gap-2">
            {DONATION_PLATFORMS.map((platform) => {
              const selected = selectedPlatform?.id === platform.id;
              return (
                <div key={platform.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPlatform(selected ? null : platform)
                    }
                    className={
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[12px] transition-colors " +
                      (selected
                        ? "border-brand/60 bg-brand/10 text-zinc-100"
                        : "border-zinc-800 bg-zinc-950/45 text-zinc-300 hover:border-brand/40 hover:text-zinc-100")
                    }
                  >
                    <span>{platform.label}</span>
                    <span className="text-[11px] text-zinc-500">
                      {selected ? "−" : "+"}
                    </span>
                  </button>

                  {selected && (
                    <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/45 p-3 text-center">
                      <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg bg-white p-2">
                        <img
                          src={donationQrUrl(platform.url, 200)}
                          alt={t("donate.qrAlt", { name: platform.label })}
                          className="h-full w-full"
                          loading="eager"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="mt-2 text-2xs text-zinc-500">
                        {t("donate.scan")}
                      </div>
                      <a
                        href={platform.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-brand/50 hover:text-brand"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("donate.openDesktop")}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 text-center text-2xs text-zinc-600">
            <QrCode className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom text-brand" />
            {t("donate.footer")}
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="mt-4 w-full rounded-lg border border-zinc-700 px-3 py-2 text-[12px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            {t("updateComplete.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
