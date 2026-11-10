import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { cloneCallInvoke, cloneCallOwnerPhone, type CloneCallSetup } from "@/lib/cloneCalls";
import { useAppStore } from "@/store/appStore";
import type { WaAccount } from "@/types/account";
import { useI18n } from "@/i18n";

export function useCloneCallBindings(enabled: boolean) {
  const pushToast = useAppStore(s => s.pushToast);
  const [setup, setSetup] = useState<CloneCallSetup | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const ticket = ++generation.current;
    lock.current = true; setBusy(true);
    void cloneCallInvoke<CloneCallSetup>("clone_call_setup", {}).then(data => {
      if (ticket === generation.current) setSetup(data);
    }).catch(e => {
      if (ticket === generation.current) pushToast(e instanceof Error ? e.message : String(e), "error");
    }).finally(() => {
      if (ticket === generation.current) { lock.current = false; setBusy(false); }
    });
    return () => { generation.current++; lock.current = false; };
  }, [enabled, revision, pushToast]);

  const run = async (work: () => Promise<void>) => {
    if (!enabled || lock.current) return;
    lock.current = true; setBusy(true);
    const ticket = ++generation.current;
    try { await work(); }
    catch (e) { if (ticket === generation.current) pushToast(e instanceof Error ? e.message : String(e), "error"); }
    finally { if (ticket === generation.current) { lock.current = false; setBusy(false); } }
  };
  const save = (ownerPhone: string, appId: string) => {
    if (!ownerPhone || !setup || (appId && (!setup.apps.some(app => app.appId === appId)
      || Object.entries(setup.bindings).some(([phone, id]) => phone !== ownerPhone && id === appId)))) return;
    void run(async () => {
      const ticket = generation.current;
      await cloneCallInvoke("clone_call_bind", { ownerPhone, appId: appId || null });
      if (ticket !== generation.current) return;
      setSetup(previous => {
        if (!previous) return previous;
        const bindings = { ...previous.bindings };
        const verified = { ...previous.verified };
        delete verified[ownerPhone];
        if (appId) bindings[ownerPhone] = appId;
        else delete bindings[ownerPhone];
        return { ...previous, bindings, verified };
      });
    });
  };
  const verify = (ownerPhone: string) => void run(async () => {
    const ticket = generation.current;
    setSetup(previous => {
      if (!previous) return previous;
      const verified = { ...previous.verified };
      delete verified[ownerPhone];
      return { ...previous, verified };
    });
    await cloneCallInvoke("clone_call_verify", { ownerPhone });
    if (ticket !== generation.current) return;
    setSetup(previous => previous ? { ...previous, verified: { ...previous.verified, [ownerPhone]: previous.bindings[ownerPhone] } } : previous);
  });
  return {
    setup, busy, save, verify,
    refresh: () => { if (!lock.current) setRevision(value => value + 1); },
    open: (appId: string) => void run(async () => { await cloneCallInvoke("clone_call_open", { appId }); }),
  };
}

export function CloneCallBinding({ account, clients }: { account: WaAccount; clients: ReturnType<typeof useCloneCallBindings> }) {
  const { t } = useI18n();
  const { setup, busy, save, refresh, open, verify } = clients;
  const ownerPhone = cloneCallOwnerPhone(account);
  const appId = setup?.bindings[ownerPhone] || "";
  const available = setup?.apps.some(app => app.appId === appId);
  const verified = !!appId && setup?.verified?.[ownerPhone] === appId;
  return <div aria-busy={busy} className="flex shrink-0 items-center gap-1 self-start">
    <label htmlFor={`clone-client-${account.id}`} className="sr-only">{t("cloneCall.deviceTitle")}</label>
    <select id={`clone-client-${account.id}`} className="ui-control h-7 w-36 !min-h-7 px-2 text-[11px]"
      title={t(ownerPhone ? "cloneCall.deviceHint" : "cloneCall.loginFirst")}
      value={appId} disabled={busy || !setup || !ownerPhone} onChange={event => save(ownerPhone, event.target.value)}>
      <option value="">{t(!ownerPhone ? "cloneCall.loginFirst" : setup && !setup.apps.length ? "cloneCall.noApps" : "cloneCall.notBound")}</option>
      {appId && !available && <option value={appId}>{t("cloneCall.missing")}</option>}
      {setup?.apps.map(app => <option key={app.appId} value={app.appId}
        disabled={Object.entries(setup.bindings).some(([phone, id]) => phone !== ownerPhone && id === app.appId)}>{app.name}</option>)}
    </select>
    <Button size="xs" variant="ghost" className={`!h-7 !min-h-7 !px-2 text-[11px] ${verified ? "text-brand" : ""}`}
      disabled={busy || !available || !ownerPhone} aria-label={t("cloneCall.verify")} title={t("cloneCall.verifyHint")}
      onClick={() => verify(ownerPhone)}>{t(verified ? "cloneCall.verified" : "cloneCall.verify")}</Button>
    <Button size="xs" variant="ghost" className="!h-7 !min-h-7 !w-7 !px-0" disabled={busy || !available || !ownerPhone}
      aria-label={t("cloneCall.openAccount", { account: account.label })} title={t("cloneCall.openAccount", { account: account.label })}
      onClick={() => open(appId)}><ExternalLink className="h-3.5 w-3.5" /></Button>
    <Button size="xs" variant="ghost" className="!h-7 !min-h-7 !w-7 !px-0" disabled={busy} aria-label={t("cloneCall.refresh")} title={t("cloneCall.refresh")} onClick={refresh}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
    </Button>
  </div>;
}
