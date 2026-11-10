import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { Button } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import {
  checkForAppUpdate,
  downloadAppUpdate,
  installDownloadedAppUpdate,
  type AppUpdate,
} from "@/lib/appUpdate";
import { waitForPendingSends } from "@/channels/sendGate";

const UPDATE_CHECK_DELAY_MS = 12_000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;
const READY_TOAST_DURATION_MS = 8 * 60 * 60_000;

async function closeUpdate(update: AppUpdate) {
  try {
    await update?.close?.();
  } catch {
    // Releasing an old updater resource must not block the next check.
  }
}

export function UpdateWatcher() {
  const { t } = useI18n();
  const pushToast = useAppStore((state) => state.pushToast);
  const setUpdateAvailableVersion = useAppStore((state) => state.setUpdateAvailableVersion);
  const [update, setUpdate] = useState<AppUpdate>(null);
  const [visible, setVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [waitingForSends, setWaitingForSends] = useState(false);
  const [error, setError] = useState("");
  const updateRef = useRef<AppUpdate>(null);
  const visibleRef = useRef(false);
  const downloadedRef = useRef(false);
  const waitingRef = useRef(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  visibleRef.current = visible;
  downloadedRef.current = downloaded;
  waitingRef.current = waitingForSends;

  useEffect(() => {
    let cancelled = false;
    let checking = false;
    const check = async () => {
      if (cancelled || checking || busyRef.current) return;
      checking = true;
      try {
        const next = await checkForAppUpdate();
        if (cancelled) {
          await closeUpdate(next);
          return;
        }
        const current = updateRef.current;
        if (next?.version && current?.version === next.version) {
          if (next !== current) await closeUpdate(next);
          return;
        }
        if (current !== next) await closeUpdate(current);
        updateRef.current = next;
        setUpdate(next);
        setUpdateAvailableVersion(next?.version || null);
        setDownloaded(false);
        setProgress(null);
        setError("");
        waitingRef.current = false;
        setWaitingForSends(false);
        setVisible(Boolean(next));
      } catch (cause) {
        console.warn("[updater] automatic check failed", cause);
      } finally {
        checking = false;
      }
    };

    const initialTimer = window.setTimeout(() => void check(), UPDATE_CHECK_DELAY_MS);
    const interval = window.setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      const current = updateRef.current;
      updateRef.current = null;
      void closeUpdate(current);
    };
  }, [setUpdateAvailableVersion]);

  const notifyReady = () => {
    const current = updateRef.current;
    if (!current || !downloadedRef.current) return;
    pushToast(
      t("updates.readyToast", { version: current.version }),
      "info",
      {
        title: t("updates.readyTitle"),
        dedupeKey: "app-update-ready",
        durationMs: READY_TOAST_DURATION_MS,
        onClick: () => setVisible(true),
      }
    );
  };

  const dismiss = () => {
    if (installing) return;
    waitingRef.current = false;
    setWaitingForSends(false);
    setVisible(false);
    notifyReady();
  };

  const download = async () => {
    const current = updateRef.current;
    if (!current || busyRef.current || downloadedRef.current) return;
    busyRef.current = true;
    setDownloading(true);
    setError("");
    setProgress(0);
    try {
      await downloadAppUpdate(current, (bytes, total) => {
        setProgress(total ? Math.min(100, Math.round((bytes / total) * 100)) : -1);
      });
      downloadedRef.current = true;
      setDownloaded(true);
      setProgress(100);
      if (!visibleRef.current) notifyReady();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("updates.downloadFailed"));
      setProgress(null);
    } finally {
      busyRef.current = false;
      setDownloading(false);
    }
  };

  const install = async () => {
    const current = updateRef.current;
    if (!current || !downloadedRef.current || busyRef.current) return;
    if (useAppStore.getState().broadcastCampaigns.some((campaign) => campaign.status === "running")) {
      waitingRef.current = true;
      setWaitingForSends(true);
      setError("");
      return;
    }
    busyRef.current = true;
    setInstalling(true);
    setError("");
    try {
      await waitForPendingSends();
      await installDownloadedAppUpdate(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("updates.installFailed"));
      setVisible(true);
    } finally {
      busyRef.current = false;
      setInstalling(false);
    }
  };

  useEffect(() => {
    if (!waitingForSends || !downloaded) return;
    const installWhenCampaignsFinish = () => {
      if (!waitingRef.current) return;
      if (useAppStore.getState().broadcastCampaigns.some((campaign) => campaign.status === "running")) return;
      waitingRef.current = false;
      setWaitingForSends(false);
      void install();
    };
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.broadcastCampaigns !== previous.broadcastCampaigns) installWhenCampaignsFinish();
    });
    installWhenCampaignsFinish();
    return unsubscribe;
  }, [waitingForSends, downloaded, update]);

  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !installing) {
        event.preventDefault();
        dismiss();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
      const first = controls[0];
      const last = controls.at(-1);
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
  }, [visible, downloading, downloaded, installing, waitingForSends, t]);

  if (!visible || !update) return null;

  const notes = update.body?.trim();
  const busy = downloading || installing;
  const ready = downloaded;
  const primaryLabel = downloading
    ? t("updates.downloading")
    : installing
      ? t("updates.installing")
      : waitingForSends
        ? t("updates.waitingForSends")
        : ready
          ? error ? t("updates.retryRestart") : t("updates.restartNow")
          : error ? t("updates.retryDownload") : t("updates.downloadNow");

  return (
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !installing) dismiss();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-prompt-title"
        className="relative flex max-h-[min(90dvh,42rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)] shadow-2xl"
      >
        {!installing && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("common.close")}
            className="absolute right-3 top-3 z-10 rounded-lg p-2 text-zinc-500 transition hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="min-h-0 overflow-y-auto p-6">
          <div className="flex items-center gap-3 pr-8">
            <WapPlusMark sizeClassName="h-10 w-10" className="rounded-xl" />
            <div>
              <h2 id="update-prompt-title" className="text-lg font-semibold">
                {ready ? t("updates.readyTitle") : t("updates.availableTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {ready ? t("updates.readyDescription") : t("updates.availableDescription")}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-[var(--app-surface-2)] p-3 text-sm">
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">{t("updates.currentVersion")}</div>
              <div className="mt-1 truncate font-medium">v{update.currentVersion || t("updates.unknown")}</div>
            </div>
            <span aria-hidden="true" className="text-zinc-500">→</span>
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">{t("updates.latestVersion")}</div>
              <div className="mt-1 truncate font-semibold text-brand">v{update.version}</div>
            </div>
          </div>

          <div className="mt-4">
            <h3 className="mb-2 text-sm font-medium">{t("updates.releaseNotes")}</h3>
            <div className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3.5 py-3 text-[13px] leading-5 text-zinc-500">
              {notes || t("updates.noReleaseNotes")}
            </div>
          </div>

          {downloading && (
            <div className="mt-4 flex items-center gap-3" role="status" aria-live="polite">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress !== null && progress >= 0 ? progress : undefined}
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--app-surface-2)]"
              >
                <div className={`h-full rounded-full bg-brand transition-[width] ${progress === -1 ? "w-1/3 animate-pulse" : ""}`} style={progress !== null && progress >= 0 ? { width: `${progress}%` } : undefined} />
              </div>
              <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{progress !== null && progress >= 0 ? `${progress}%` : "…"}</span>
            </div>
          )}

          {waitingForSends && (
            <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300" role="status" aria-live="polite">
              {t("updates.waitingForSendsHint")}
            </p>
          )}
          {installing && (
            <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-brand" />{t("updates.installing")}
            </p>
          )}
          {!!error && <p className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-4">
          <Button variant="ghost" onClick={dismiss} disabled={installing}>
            {t("updates.later")}
          </Button>
          {!ready ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void download()}
              className="gap-2"
              data-autofocus
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : error ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              {primaryLabel}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={installing || waitingForSends}
              onClick={() => void install()}
              className="gap-2"
              data-autofocus
            >
              {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : error ? <RefreshCw className="h-4 w-4" /> : waitingForSends ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {primaryLabel}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}
