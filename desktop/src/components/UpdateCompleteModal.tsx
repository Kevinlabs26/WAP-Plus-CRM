import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Coffee, ExternalLink, X } from "lucide-react";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { useI18n } from "@/i18n";
import { getAppInfo, isTauri } from "@/lib/bridge";
import {
  DONATION_PLATFORMS,
  donationQrUrl,
  type DonationPlatform,
} from "@/lib/donation";
import { PENDING_UPDATE_STORAGE_KEY } from "@/lib/appUpdate";

const LAST_RUNNING_VERSION_KEY = "wap-plus.last-running-version";
// Older builds predate this marker, so let this compatibility release show
// the confirmation once even when the old app cannot write it.
const FIRST_COMPLETION_MODAL_VERSION = "0.1.9";

type PendingUpdate = {
  version?: string;
};

export function UpdateCompleteModal({ ready, showDonation = false }: { ready: boolean; showDonation?: boolean }) {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const [visible, setVisible] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
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
    if (!ready || !visible) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    startRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setVisible(false); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!dialogRef.current?.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [ready, visible]);

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
      <div ref={dialogRef} className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-brand/20 bg-zinc-900 shadow-2xl shadow-black/30">
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label={t("updateComplete.close")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div className="bg-gradient-to-b from-brand/15 via-brand/5 to-transparent px-6 pb-6 pt-9 text-center">
            <div className="relative mx-auto mb-5 w-fit rounded-3xl bg-brand/10 p-3 ring-1 ring-brand/15">
              <WapPlusMark sizeClassName="h-14 w-14" className="rounded-2xl" />
              <span className="absolute -bottom-1 -right-1 rounded-full border-4 border-zinc-900 bg-brand p-1 text-[var(--brand-foreground)]">
                <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
              </span>
            </div>
            <span className="inline-flex rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand">v{version}</span>
            <h2 id="update-complete-title" className="mt-3 text-2xl font-semibold tracking-tight text-zinc-100">{t("updateComplete.title")}</h2>
            <p className="mt-2 text-sm text-zinc-500">{t("updateComplete.description")}</p>
          </div>
          {showDonation && <div className="px-6 pb-5">
            <button
              type="button"
              aria-expanded={supportOpen}
              aria-controls="update-complete-support"
              onClick={() => setSupportOpen((open) => !open)}
              className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-left text-xs text-zinc-300 transition-colors hover:border-brand/40 hover:bg-brand/5"
            >
              <Coffee className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <span className="flex-1">{t("updateComplete.sponsorTitle")}</span>
              <ChevronDown className={"h-4 w-4 shrink-0 text-zinc-500 transition-transform " + (supportOpen ? "rotate-180" : "")} aria-hidden="true" />
            </button>
            {supportOpen && <div id="update-complete-support" className="mt-3 grid gap-2">
              <p className="mb-1 text-xs text-zinc-500">{t("updateComplete.sponsorHint")}</p>
              {DONATION_PLATFORMS.map((platform) => {
                const selected = selectedPlatform?.id === platform.id;
                return (
                  <div key={platform.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPlatform(selected ? null : platform)
                      }
                      aria-expanded={selected}
                      aria-controls={"update-donation-" + platform.id}
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
                      <div id={"update-donation-" + platform.id} className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/45 p-3 text-center">
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
              <p className="mt-2 text-center text-2xs leading-relaxed text-zinc-500">{t("donate.footer")}</p>
            </div>}
          </div>}
        </div>
        <div className="shrink-0 border-t border-zinc-800/70 bg-zinc-900 px-6 py-4">
          <button
            ref={startRef}
            type="button"
            onClick={() => setVisible(false)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-[var(--brand-foreground)] shadow-sm shadow-brand/20 transition-colors hover:bg-brand/90"
          >
            {t("updateComplete.start")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
