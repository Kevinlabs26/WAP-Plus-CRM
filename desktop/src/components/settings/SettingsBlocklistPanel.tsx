import { useCallback, useMemo, useState } from "react";
import { RefreshCw, ShieldBan, UserX } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button, Input, SectionLabel } from "@/components/ui/primitives";
import {
  baileysBlocklist,
  baileysBlocklistSet,
} from "@/lib/baileysBlocklist";
import {
  getAccountBlocklist,
  resolveWaMetaAccountId,
  setAccountBlocklist,
} from "@/lib/accountWaMeta";
import { displayContactLabel } from "@/lib/utils";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { useI18n } from "@/i18n";

function jidDigits(j: string) {
  return String(j || "").replace(/@.+$/, "").replace(/\D/g, "");
}

export function SettingsBlocklistPanel() {
  const { t } = useI18n();
  const settings = useAppStore((s) => s.settings);
  const contacts = useAppStore((s) => s.contacts);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const baileysUi = useAppStore((s) => s.baileysUi);

  const accountId = resolveWaMetaAccountId(null, {
    liveBaileysAccountId: settings.liveBaileysAccountId,
    activeAccountId: settings.activeAccountId,
  });
  const jids = getAccountBlocklist(
    settings.blocklistByAccountId,
    accountId,
    settings.blocklistJids
  );
  const accountConnected = isWaAccountConnected(
    settings.waAccounts,
    accountId,
    settings.liveBaileysAccountId,
    baileysUi.connection
  );
  const [busy, setBusy] = useState("");
  const [manual, setManual] = useState("");

  const accountLabel = useMemo(() => {
    const acc = (settings.waAccounts || []).find((a) => a.id === accountId);
    const idx =
      Math.max(
        0,
        (settings.waAccounts || []).findIndex((a) => a.id === accountId)
      ) + 1 || 1;
    return formatAccountDisplay({
      label: acc?.label,
      userName: acc?.userName || baileysUi.userName,
      index1: idx,
    });
  }, [accountId, settings.waAccounts, baileysUi.userName]);

  const rows = useMemo(() => {
    return jids.map((jid) => {
      const dig = jidDigits(jid);
      const c = contacts.find((x) => {
        if (x.isGroup) return false;
        if (x.channelAddress === jid) return true;
        const pd = (x.phone || "").replace(/\D/g, "");
        return Boolean(dig && pd && (pd === dig || pd.endsWith(dig) || dig.endsWith(pd)));
      });
      const name = c
        ? displayContactLabel(c.name, c.phone, c.channelAddress, "", {
            isGroup: false,
          })
        : "";
      return { jid, name, phone: c?.phone || dig };
    });
  }, [jids, contacts]);

  const refresh = useCallback(async () => {
    if (!accountConnected) {
      pushToast(t("settingsBlocklist.connectFirst"), "error");
      return;
    }
    setBusy("refresh");
    try {
      const res = await baileysBlocklist(accountId, true);
      if (!res.ok) {
        pushToast(res.error || t("settingsBlocklist.refreshFailed"), "error");
        return;
      }
      updateSettings({
        blocklistByAccountId: setAccountBlocklist(
          settings.blocklistByAccountId,
          accountId,
          res.jids || []
        ),
        blocklistJids: res.jids || [],
      });
      pushToast(t("settingsBlocklist.refreshed", { count: (res.jids || []).length }), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  }, [accountConnected, accountId, pushToast, t, updateSettings]);

  const unblock = async (jid: string) => {
    setBusy(jid);
    try {
      const res = await baileysBlocklistSet(jid, "unblock", accountId);
      if (!res.ok) {
        pushToast(res.error || t("settingsBlocklist.unblockFailed"), "error");
        return;
      }
      const nextJids = res.jids || jids.filter((x) => x !== jid);
      updateSettings({
        blocklistByAccountId: setAccountBlocklist(
          settings.blocklistByAccountId,
          accountId,
          nextJids
        ),
        blocklistJids: nextJids,
      });
      pushToast(t("settingsBlocklist.unblocked"), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const blockManual = async () => {
    const raw = manual.trim();
    if (!raw) return;
    if (!accountConnected) {
      pushToast(t("settingsBlocklist.connectFirst"), "error");
      return;
    }
    setBusy("add");
    try {
      const res = await baileysBlocklistSet(raw, "block", accountId);
      if (!res.ok) {
        pushToast(res.error || t("settingsBlocklist.blockFailed"), "error");
        return;
      }
      updateSettings({
        blocklistByAccountId: setAccountBlocklist(
          settings.blocklistByAccountId,
          accountId,
          res.jids || []
        ),
        blocklistJids: res.jids || [],
      });
      setManual("");
      pushToast(t("settingsBlocklist.blocked"), "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h3 className="text-lg font-semibold text-zinc-100">{t("settingsBlocklist.title")}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {t("settingsBlocklist.description", { account: accountLabel })}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>{t("settingsBlocklist.blockedCount", { count: rows.length })}</SectionLabel>
          <Button
            variant="secondary"
            size="sm" className="gap-1.5 text-[11px]"
            disabled={busy === "refresh" || !accountConnected}
            onClick={() => void refresh()}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`}
            />
            {t("settingsBlocklist.refresh")}
          </Button>
        </div>

        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {rows.map((row) => (
            <li
              key={row.jid}
              className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2"
            >
              <UserX className="h-4 w-4 shrink-0 text-rose-300/80" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-zinc-200">
                  {row.name || row.phone || row.jid}
                </div>
                <div className="truncate font-mono text-2xs text-zinc-600">
                  {row.jid}
                </div>
              </div>
              <button
                type="button"
                disabled={busy === row.jid}
                className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-2xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                onClick={() => void unblock(row.jid)}
              >
                {t("settingsBlocklist.unblock")}
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-3 py-10 text-center text-[12px] text-zinc-600">
              <ShieldBan className="h-8 w-8 opacity-40" />
              {t("settingsBlocklist.empty")}
            </li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
        <SectionLabel>{t("settingsBlocklist.manual")}</SectionLabel>
        <p className="mt-2 text-[11px] text-zinc-600">
          {t("settingsBlocklist.manualHint")}
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            className="min-w-0 flex-1"
            placeholder={t("settingsBlocklist.placeholder")}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void blockManual();
            }}
          />
          <Button
            variant="primary"
            className="shrink-0 text-[12px]"
            disabled={!manual.trim() || busy === "add"}
            onClick={() => void blockManual()}
          >
            {t("settingsBlocklist.block")}
          </Button>
        </div>
      </section>
    </div>
  );
}
