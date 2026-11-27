import { useEffect, useRef, useState } from "react";
import { Check, Download, MessageSquareText, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, SectionLabel } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { getAppInfo, isTauri } from "@/lib/bridge";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  checkForAppUpdate,
  installAppUpdate,
  type AppUpdate,
} from "@/lib/appUpdate";

const FEEDBACK_FORM_URL = "https://forms.gle/HhRMF6YjH7nFmDg17";

export function SettingsUpdatePanel() {
  const { t } = useI18n();
  const pushToast = useAppStore((state) => state.pushToast);
  const setUpdateAvailableVersion = useAppStore((state) => state.setUpdateAvailableVersion);
  const [version, setVersion] = useState(() => t("updates.browserPreview"));
  const [update, setUpdate] = useState<AppUpdate>(null);
  const [status, setStatus] = useState(() => t("updates.notChecked"));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const autoChecked = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getAppInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(t("updates.unknown")));
  }, [t]);

  const checkNow = async () => {
    if (!isTauri()) {
      setStatus(t("updates.browserUnsupported"));
      return;
    }
    setBusy(true);
    setStatus(t("updates.checking"));
    setUpdate(null);
    try {
      const next = await checkForAppUpdate();
      setUpdate(next);
      setUpdateAvailableVersion(next?.version || null);
      setStatus(next ? t("updates.found", { version: next.version }) : t("updates.latest"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("updates.checkFailed");
      setStatus(`${t("updates.checkFailed")}: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoChecked.current) return;
    autoChecked.current = true;
    void checkNow();
  }, []);

  const install = async () => {
    if (!update) return;
    setBusy(true);
    setProgress(0);
    setStatus(t("updates.downloading"));
    try {
      await installAppUpdate(update, (downloaded, total) => {
        setProgress(total ? Math.min(100, Math.round((downloaded / total) * 100)) : -1);
      });
      setUpdateAvailableVersion(null);
      setStatus(t("updates.installed"));
      pushToast(t("updates.installed"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("updates.installFailed");
      setStatus(`${t("updates.installFailed")}: ${message}`);
      pushToast(message, "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("updates.title")}</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          {t("updates.versionNote", { version })}
        </p>
      </header>

      <section className="border-t border-zinc-800 pt-4">
        <SectionLabel>{t("feedback.title")}</SectionLabel>
        <p className="mt-2 text-[11px] leading-5 text-zinc-400">{t("feedback.description")}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={async () => {
            try {
              if (isTauri()) await openExternal(FEEDBACK_FORM_URL);
              else window.open(FEEDBACK_FORM_URL, "_blank", "noopener,noreferrer");
            } catch {
              pushToast(t("nav.openLinkFailed"), "error");
            }
          }}
        >
          <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />
          {t("feedback.open")}
        </Button>
      </section>

      <section className="border-t border-zinc-800 pt-4">
        <SectionLabel>{t("updates.section")}</SectionLabel>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void checkNow()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {busy && !update ? t("updates.checking") : t("updates.check")}
          </Button>
          {update && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void install()}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("updates.downloadInstall", { version: update.version })}
            </Button>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-zinc-400">{status}</p>
        {progress !== null && (
          <div className="mt-3 flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress >= 0 ? progress : undefined}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800"
            >
              <div
                className={
                  "h-full rounded-full bg-brand transition-[width] " +
                  (progress < 0 ? "w-1/3 animate-pulse" : "")
                }
                style={progress >= 0 ? { width: `${progress}%` } : undefined}
              />
            </div>
            <span className="w-9 text-right text-[11px] tabular-nums text-zinc-500">
              {progress >= 0 ? `${progress}%` : "…"}
            </span>
          </div>
        )}
      </section>

      <section className="border-t border-zinc-800 pt-4">
        <SectionLabel>{t("updates.security")}</SectionLabel>
        <div className="flex gap-3 text-[11px] leading-5 text-zinc-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <p>{t("updates.signatureNote")}</p>
        </div>
        <div className="mt-3 flex gap-2 text-[11px] text-zinc-500">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span>{t("updates.signedOnly")}</span>
        </div>
      </section>
    </div>
  );
}
