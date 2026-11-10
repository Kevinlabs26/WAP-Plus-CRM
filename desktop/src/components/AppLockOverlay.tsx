import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { WapPlusMark } from "@/components/brand/WapPlusMark";
import { useI18n } from "@/i18n";
import { Button, Input } from "@/components/ui/primitives";
import {
  changeAppLockPassword,
  createAppLockPassword,
  verifyAppLockPassword,
} from "@/lib/appLock";

export type AppLockMode = "setup" | "unlock" | "change";

export function AppLockOverlay({
  mode,
  onCancel,
  onCreated,
  onUnlocked,
  onChanged,
}: {
  mode: AppLockMode;
  onCancel: () => void;
  onCreated: () => void;
  onUnlocked: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCurrentPassword("");
    setPassword("");
    setConfirmation("");
    setError("");
  }, [mode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (mode !== "unlock") {
      if (Array.from(password).length < 6) {
        setError(t("appLock.passwordMin"));
        return;
      }
      if (password !== confirmation) {
        setError(t("appLock.passwordMismatch"));
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "setup") {
        await createAppLockPassword(password);
        onCreated();
      } else if (mode === "unlock") {
        if (await verifyAppLockPassword(password)) onUnlocked();
        else setError(t("appLock.passwordWrong"));
      } else {
        if (await changeAppLockPassword(currentPassword, password)) onChanged();
        else setError(t("appLock.passwordWrong"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const heading =
    mode === "setup"
      ? t("appLock.setupTitle")
      : mode === "change"
        ? t("appLock.changeTitle")
        : t("appLock.lockedTitle");

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-zinc-950 p-5" role="dialog" aria-modal="true" aria-label={heading}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[min(78vw,58rem)] w-[min(78vw,58rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.035]" />
        <div className="absolute left-1/2 top-[43%] h-[min(58vw,42rem)] w-[min(58vw,42rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/[0.045] blur-3xl" />
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-emerald-500/[0.07] blur-[120px]" />
        <div className="absolute -bottom-48 -right-40 h-[30rem] w-[30rem] rounded-full bg-teal-400/[0.06] blur-[130px]" />
      </div>
      <form onSubmit={(event) => void submit(event)} className="relative z-10 w-full max-w-md space-y-5 overflow-hidden rounded-3xl border border-[var(--app-border-strong)] bg-[var(--app-surface)] p-8 text-[var(--app-text)] shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
        <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent" />
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="relative mb-1">
            <div aria-hidden className="absolute -inset-5 rounded-full bg-brand/10 blur-2xl" />
            <WapPlusMark sizeClassName="h-16 w-16 rounded-2xl" />
            <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--app-surface)] bg-brand text-brand-foreground shadow-sm">
              {mode === "change" ? <KeyRound className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
            </span>
          </div>
          <h1 className="text-lg font-semibold text-[var(--app-text)]">{heading}</h1>
          <p className="text-sm text-[var(--app-muted)]">
            {mode === "setup" ? t("appLock.setupHint") : mode === "change" ? t("appLock.changeHint") : t("appLock.unlockHint")}
          </p>
        </div>

        {mode === "change" && (
          <label className="block space-y-1.5 text-sm text-[var(--app-muted)]">
            <span>{t("appLock.currentPassword")}</span>
            <Input autoFocus type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} maxLength={512} />
          </label>
        )}
        <label className="block space-y-1.5 text-sm text-[var(--app-muted)]">
          <span>{mode === "unlock" ? t("appLock.password") : t("appLock.newPassword")}</span>
          <Input autoFocus={mode !== "change"} type="password" autoComplete={mode === "unlock" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.currentTarget.value)} maxLength={512} />
        </label>
        {mode !== "unlock" && (
          <label className="block space-y-1.5 text-sm text-[var(--app-muted)]">
            <span>{t("appLock.confirmPassword")}</span>
            <Input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} maxLength={512} />
          </label>
        )}

        {error && <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-[var(--app-danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          {mode !== "unlock" && <Button variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>}
          <Button variant="primary" type="submit" disabled={busy || (mode === "unlock" ? !password : !password || (mode === "change" && !currentPassword) || !confirmation)}>
            {busy ? t("appLock.working") : mode === "setup" ? t("appLock.setPassword") : mode === "change" ? t("appLock.changePassword") : t("appLock.unlock")}
          </Button>
        </div>
      </form>
    </div>
  );
}
