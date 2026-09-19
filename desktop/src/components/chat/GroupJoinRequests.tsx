import { useCallback, useEffect, useState } from "react";
import {
  baileysGroupJoinRequests,
  baileysGroupJoinRequestsUpdate,
  type GroupJoinRequest,
} from "@/lib/baileysGroups";
import { displayContactLabel } from "@/lib/utils";
import type { GroupDetails } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  groupJid: string;
  accountId?: string | null;
  /** 未开入群审批时仍可尝试拉取（接口空则隐藏）*/
  enabled?: boolean;
  onUpdated?: (g: GroupDetails | null) => void;
  onError?: (msg: string) => void;
};

export function GroupJoinRequests({
  groupJid,
  accountId,
  enabled = true,
  onUpdated,
  onError,
}: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState<GroupJoinRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyJid, setBusyJid] = useState("");
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    if (!enabled || !groupJid.endsWith("@g.us")) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await baileysGroupJoinRequests(groupJid, accountId);
      if (!res.ok) {
        // 无权限/未开启时安静隐藏
        if (res.code === "unsupported" || res.code === "not_connected") {
          setHidden(true);
        } else {
          const message = res.error || t("groupRequests.loadFailed");
          setLoadError(message);
          onError?.(message);
        }
        return;
      }
      setHidden(false);
      onError?.("");
      setPending(Array.isArray(res.pending) ? res.pending : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [groupJid, accountId, enabled, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (
    action: "approve" | "reject",
    jid: string
  ) => {
    setBusyJid(jid);
    try {
      const res = await baileysGroupJoinRequestsUpdate(
        groupJid,
        action,
        [jid],
        accountId
      );
      if (!res.ok) {
        onError?.(res.error || t("groupRequests.operationFailed"));
        return;
      }
      setPending(Array.isArray(res.pending) ? res.pending : []);
      onUpdated?.(res.group || null);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyJid("");
    }
  };

  if (hidden) return null;
  if (loadError) {
    return (
      <div className="mb-2 flex items-center justify-between rounded-md border border-rose-500/25 px-2 py-1.5">
        <span className="min-w-0 truncate text-2xs text-rose-300">{t("groupRequests.loadFailed")}</span>
        <button
          type="button"
          className="shrink-0 text-2xs text-zinc-300 hover:text-white"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("groupRequests.retry")}
        </button>
      </div>
    );
  }
  if (!loading && pending.length === 0) {
    return (
      <div className="mb-2 flex items-center justify-between rounded-md border border-zinc-800/80 px-2 py-1.5">
        <span className="text-2xs text-zinc-500">{t("groupRequests.empty")}</span>
        <button
          type="button"
          className="text-2xs text-zinc-400 hover:text-zinc-200"
          disabled={loading}
          onClick={() => void load()}
        >
          {t("groupRequests.refresh")}
        </button>
      </div>
    );
  }

  return (
    <section className="mb-3 rounded-lg border border-violet-500/25 bg-violet-500/5 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-2xs font-medium uppercase tracking-wide text-violet-200/90">
          {t("groupRequests.title", { count: pending.length })}
        </div>
        <button
          type="button"
          className="text-2xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? t("groupRequests.refreshing") : t("groupRequests.refresh")}
        </button>
      </div>
      <ul className="space-y-1">
        {pending.map((row) => {
          const label = displayContactLabel("", "", row.jid, "", {
            isGroup: false,
          });
          const phone = row.jid.replace(/@.+$/, "");
          return (
            <li
              key={row.jid}
              className="flex items-center gap-2 rounded-md bg-zinc-950/40 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-zinc-200">{label}</div>
                <div className="truncate font-mono text-2xs text-zinc-600">
                  {phone || row.jid}
                  {row.status ? ` · ${row.status}` : ""}
                </div>
              </div>
              <button
                type="button"
                disabled={busyJid === row.jid}
                className="rounded-md bg-brand/90 px-2 py-0.5 text-2xs font-medium text-[var(--brand-foreground)] disabled:opacity-40"
                onClick={() => void decide("approve", row.jid)}
              >
                {t("groupRequests.approve")}
              </button>
              <button
                type="button"
                disabled={busyJid === row.jid}
                className="rounded-md border border-zinc-700 px-2 py-0.5 text-2xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                onClick={() => void decide("reject", row.jid)}
              >
                {t("groupRequests.reject")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
