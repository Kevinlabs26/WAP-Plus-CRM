import { useEffect, useRef, useState } from "react";
import { Loader2, Phone, X } from "lucide-react";
import { cloneCallInvoke, type CloneCallSetup, type CloneCallTarget } from "@/lib/cloneCalls";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";

export function CloneCallButton({ target }: { target: CloneCallTarget | null }) {
  const { t } = useI18n();
  const pushToast = useAppStore(s => s.pushToast);
  const setActiveNav = useAppStore(s => s.setActiveNav);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const request = useRef<string | null>(null);
  const mounted = useRef(true);
  const cancel = () => {
    generation.current++;
    if (request.current) void cloneCallInvoke("clone_call_cancel", { requestId: request.current }).catch(error => {
      if (mounted.current) pushToast(error instanceof Error ? error.message : String(error), "error");
    });
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, []);

  const dial = async () => {
    if (!target || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const ticket = ++generation.current;
    try {
      const setup = await cloneCallInvoke<CloneCallSetup>("clone_call_setup", {});
      if (ticket !== generation.current) return;
      const appId = setup.bindings[target.ownerPhone];
      const app = setup.apps.find(item => item.appId === appId);
      if (!app) {
        pushToast(t("cloneCall.bindInDevices", { account: target.accountLabel }), "info");
        setActiveNav("phones");
        return;
      }
      if (setup.verified?.[target.ownerPhone] !== appId) {
        pushToast(t("cloneCall.verifyInDevices"), "info");
        setActiveNav("phones");
        return;
      }
      const requestId = crypto.randomUUID();
      request.current = requestId;
      await cloneCallInvoke("clone_call_start", { ownerPhone: target.ownerPhone, recipientPhone: target.recipientPhone, requestId });
      if (ticket === generation.current) pushToast(t("cloneCall.requested", { name: app.name }), "success");
    } catch (error) {
      if (ticket === generation.current) {
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        pushToast(message, "error");
      }
    } finally {
      request.current = null;
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <span className="relative inline-flex shrink-0 items-center gap-1">
    <button type="button" disabled={!target || busy} onClick={() => void dial()}
      title={t(busy ? "cloneCall.preparing" : target ? "cloneCall.actionHint" : "cloneCall.unavailable")} aria-label={t("cloneCall.action")} aria-busy={busy}
      className="ui-btn-secondary !min-h-7 !w-7 shrink-0 !px-0 disabled:opacity-40">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
    </button>
    {busy && <button type="button" onClick={cancel} title={t("cloneCall.cancelHint")} aria-label={t("cloneCall.cancel")}
      className="ui-btn-ghost !min-h-7 !w-7 !px-0"><X className="h-3.5 w-3.5" /></button>}
    {error && <span role="alert" className="absolute right-0 top-full z-50 mt-2 flex w-72 gap-2 rounded-lg border border-amber-500/30 bg-zinc-900 p-3 text-xs text-amber-500 shadow-lg">
      <span className="min-w-0 flex-1 break-words">{error}</span>
      <button type="button" onClick={() => setError("")} aria-label={t("common.close")} className="self-start"><X className="h-3.5 w-3.5" /></button>
    </span>}
  </span>;
}
