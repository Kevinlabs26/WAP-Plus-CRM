import { ChevronRight, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  baileysCommonGroups,
  baileysGroupParticipants,
} from "@/lib/baileysGroups";
import { baileysFetchAvatar } from "@/lib/baileysChatActions";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { Contact, GroupDetails } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n";

type Props = {
  contact: Contact;
  accountId?: string | null;
  connected: boolean;
  onOpenGroup: (group: GroupDetails) => void;
};

export function CommonGroupsPanel({
  contact,
  accountId,
  connected,
  onOpenGroup,
}: Props) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<GroupDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{
    group: GroupDetails;
    x: number;
    y: number;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const load = useCallback(
    async (force = false) => {
      const id = ++requestId.current;
      if (!connected) {
        setLoading(false);
        setGroups([]);
        setLoaded(false);
        setError(t("commonGroups.notConnected"));
        return;
      }
      const target = contact.channelAddress || contact.phone;
      if (!target) {
        setLoading(false);
        setGroups([]);
        setLoaded(true);
        setError(t("commonGroups.missingAddress"));
        return;
      }
      setLoading(true);
      setError("");
      try {
        const result = await baileysCommonGroups(
          {
            jids: contact.channelAddress ? [contact.channelAddress] : [],
            phone: contact.phone,
          },
          accountId,
          { force }
        );
        if (id !== requestId.current) return;
        setGroups((result.groups || []) as GroupDetails[]);
        setLoaded(true);
      } catch (e) {
        if (id !== requestId.current) return;
        setGroups([]);
        setLoaded(true);
        const message = e instanceof Error ? e.message : t("commonGroups.loadFailed");
        setError(
          message === "not found"
            ? t("commonGroups.unsupported")
            : message
        );
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [accountId, connected, contact.channelAddress, contact.phone, t]
  );

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!connected || groups.length === 0) return;
    let cancelled = false;
    void Promise.all(
      groups.map(async (group) => {
        try {
          const result = await baileysFetchAvatar({
            jid: group.jid,
            quality: "preview",
            accountId,
          });
          const src = result.avatarUrl || result.avatarFullUrl || "";
          if (!cancelled && src) {
            setAvatars((prev) =>
              prev[group.jid] === src
                ? prev
                : { ...prev, [group.jid]: src }
            );
          }
        } catch {
          // 没有群头像或当前账号无权读取时保留默认图标。
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [accountId, connected, groups]);

  const runMemberAction = useCallback(
    async (group: GroupDetails, action: "promote" | "remove") => {
      if (!connected) return;
      const target = contact.channelAddress || contact.phone;
      if (!target) return;
      if (action === "remove") {
        const ok = await useAppStore.getState().requestConfirm({
          title: t("commonGroups.removeTitle"),
          description: t("commonGroups.removeConfirm", {
            name: contact.name || contact.phone || t("commonGroups.group"),
            group: group.subject || t("commonGroups.group"),
          }),
          confirmLabel: t("commonGroups.remove"),
          tone: "danger",
        });
        if (!ok) return;
      }
      const key = `${group.jid}:${action}`;
      setActionBusy(key);
      try {
        const result = await baileysGroupParticipants(
          group.jid,
          action,
          [target],
          accountId
        );
        if (!result.ok) {
          throw new Error(
            result.error || t("commonGroups.actionFailed")
          );
        }
        useAppStore
          .getState()
          .pushToast(action === "promote" ? t("commonGroups.promoted") : t("commonGroups.removed"), "success");
        setMenu(null);
        await load(true);
      } catch (e) {
        useAppStore
          .getState()
          .pushToast(e instanceof Error ? e.message : t("commonGroups.memberActionFailed"), "error");
      } finally {
        setActionBusy("");
      }
    },
    [accountId, connected, contact.channelAddress, contact.name, contact.phone, load, t]
  );

  if (contact.isGroup) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-brand" />
          <h4 className="ui-section-label !mb-0">{t("commonGroups.title")}</h4>
          {loaded && <span className="text-2xs text-zinc-600">{groups.length}</span>}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-2xs text-zinc-500 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void load(true)}
          disabled={loading || !connected}
          title={t("commonGroups.reloadTitle")}
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {t("commonGroups.refresh")}
        </button>
      </div>

      {loading && !loaded ? (
        <p className="py-2 text-2xs text-zinc-600">{t("commonGroups.loading")}</p>
      ) : error ? (
        <p className="py-2 text-2xs leading-4 text-zinc-600">{error}</p>
      ) : groups.length === 0 ? (
        <p className="py-2 text-2xs text-zinc-600">{t("commonGroups.empty")}</p>
      ) : (
        <div className="space-y-1">
          {groups.map((group) => (
            <button
              key={group.jid}
              type="button"
              onClick={() => onOpenGroup(group)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu({
                  group,
                  x: Math.min(event.clientX, window.innerWidth - 210),
                  y: Math.min(event.clientY, window.innerHeight - 150),
                });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800/70"
              title={t("commonGroups.openHint")}
            >
              {avatars[group.jid] ? (
                <Avatar
                  name={group.subject || t("commonGroups.group")}
                  seed={group.jid}
                  src={avatars[group.jid]}
                  size="sm"
                />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Users className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-zinc-300">
                  {group.subject || group.jid}
                </span>
                <span className="block text-2xs text-zinc-600">
                  {group.participantCount ? t("commonGroups.members", { count: group.participantCount }) : t("commonGroups.whatsappGroup")}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            </button>
          ))}
        </div>
      )}

      {menu && (
        <div
          className="fixed z-[100] min-w-44 rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-2 py-1 text-2xs text-zinc-500">
            {menu.group.subject || t("commonGroups.group")}
          </div>
          <button
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              setMenu(null);
              onOpenGroup(menu.group);
            }}
          >
            {t("commonGroups.open")}
          </button>
          <button
            type="button"
            disabled={Boolean(actionBusy)}
            className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-brand hover:bg-zinc-800 disabled:opacity-40"
            onClick={() => void runMemberAction(menu.group, "promote")}
          >
            {actionBusy === `${menu.group.jid}:promote` ? t("commonGroups.processing") : t("commonGroups.promote")}
          </button>
          <button
            type="button"
            disabled={Boolean(actionBusy)}
            className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
            onClick={() => void runMemberAction(menu.group, "remove")}
          >
            {actionBusy === `${menu.group.jid}:remove` ? t("commonGroups.processing") : t("commonGroups.remove")}
          </button>
        </div>
      )}
    </section>
  );
}
