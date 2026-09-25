import { useCallback, useEffect, useState } from "react";
import { Users, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import {
  baileysGroupAcceptInvite,
  baileysGroupInviteInfo,
} from "@/lib/baileysGroups";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { useAppStore } from "@/store/appStore";
import { baileysSync } from "@/lib/baileys";
import type { GroupDetails } from "@/types/crm";
import { openJoinedGroup } from "./openJoinedGroup";
import { useI18n } from "@/i18n";
import { extractWhatsAppInvite } from "@/lib/whatsappGroupInvite";

type Props = {
  /** 消息正文或链接 */
  text: string;
  accountId?: string | null;
  className?: string;
  onJoined?: (groupJid: string) => void;
};

/** 聊天气泡内：预览邀请链接（只读 + 可选加入） */
export function GroupInviteCard({
  text,
  accountId,
  className,
  onJoined,
}: Props) {
  const { t } = useI18n();
  const link = extractWhatsAppInvite(text);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<(GroupDetails & { inviteCode?: string }) | null>(
    null
  );

  const preview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await baileysGroupInviteInfo(link, accountId);
      if (!res.ok || !res.invite) {
        setError(res.error || t("groupInvite.parseFailed"));
        setInfo(null);
        return;
      }
      setInfo(res.invite as GroupDetails & { inviteCode?: string });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, link]);

  useEffect(() => {
    if (link) void preview();
  }, [link, preview]);

  if (!link) return null;

  const join = async () => {
    const ok = await useAppStore.getState().requestConfirm({
      title: t("group.joinTitle"),
      description: t("group.joinDescription"),
      confirmLabel: t("group.join"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setJoining(true);
    setError("");
    try {
      const res = await baileysGroupAcceptInvite(link, accountId);
      if (!res.ok) {
        setError(res.error || t("group.joinFailed"));
        useAppStore
          .getState()
          .pushToast(res.error || t("group.joinFailed"), "error");
        return;
      }
      if (res.groupJid) {
        const store = useAppStore.getState();
        const owner =
          accountId ||
          store.settings.liveBaileysAccountId ||
          store.settings.activeAccountId ||
          "wa-default";
        let opened = openJoinedGroup({
          accountId: owner,
          groupJid: res.groupJid,
          group: res.group,
          ingest: (events) =>
            store.ingestBridgeEvents(
              events as Parameters<typeof store.ingestBridgeEvents>[0]
            ),
          findContactId: (groupJid, accountId) =>
            useAppStore
              .getState()
              .contacts.find(
                (contact) =>
                  contact.channelAddress === groupJid &&
                  (contact.accountId || contact.boundPhoneId) === accountId
              )?.id,
          openContact: (contactId) =>
            useAppStore.getState().openContactWorkspace(contactId),
        });
        if (!opened) {
          try {
            const synced = await baileysSync(owner, { hydrateGroups: true });
            store.ingestBridgeEvents([
              {
                type: "contacts.sync",
                deviceId: owner,
                payload: { items: synced.contacts, source: "snapshot", accountId: owner },
              },
              {
                type: "messages.sync",
                deviceId: owner,
                payload: {
                  items: synced.messages,
                  source: "snapshot",
                  live: false,
                  accountId: owner,
                },
              },
            ] as unknown as Parameters<typeof store.ingestBridgeEvents>[0]);
            const contactId = useAppStore
              .getState()
              .contacts.find(
                (contact) =>
                  contact.channelAddress === res.groupJid &&
                  (contact.accountId || contact.boundPhoneId) === owner
              )?.id;
            if (contactId) {
              useAppStore.getState().openContactWorkspace(contactId);
              opened = true;
            }
          } catch (syncError) {
            setError(
              t("group.syncFailed", {
                error: syncError instanceof Error ? syncError.message : String(syncError),
              })
            );
          }
        }
        onJoined?.(res.groupJid);
        useAppStore
          .getState()
          .pushToast(
            opened ? t("group.joinedOpen") : t("group.joinedNeedsSync"),
            opened ? "success" : "error"
          );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      useAppStore.getState().pushToast(msg, "error");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div
      className={cn(
        "group-invite-card mt-2 w-full max-w-sm overflow-hidden rounded-xl border border-black/10 bg-black/5 p-3 backdrop-blur-xs transition-all",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/5 pb-2">
        <div className="flex items-center gap-1.5 text-2xs font-semibold text-brand">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/15">
            <Users className="h-3 w-3 text-brand" />
          </div>
          <span>{t("groupInvite.title")}</span>
        </div>
        <a
          href={link.startsWith("http") ? link : `https://${link}`}
          target="_blank"
          rel="noreferrer"
          title={t("tooltip.openLink")}
          className="text-zinc-400 hover:text-brand transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {info ? (
        <div className="mt-2.5 flex items-start gap-3">
          <Avatar
            name={info.subject || t("groupInvite.group")}
            seed={info.jid || info.subject}
            src={info.avatarUrl}
            size="lg"
            variant="accounts"
            className="!h-11 !w-11 text-xs shadow-xs ring-1 ring-black/10"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[13px] font-semibold text-zinc-100 truncate">
              {info.subject || t("groupInvite.unknown")}
            </div>
            {info.desc ? (
              <p className="line-clamp-2 text-2xs leading-relaxed text-zinc-400">
                {info.desc}
              </p>
            ) : null}
            {!!info.participantCount && (
              <div className="inline-flex items-center gap-1 rounded-md bg-black/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                <Users className="h-2.5 w-2.5" />
                <span>{t("groupInvite.members", { count: info.participantCount })}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <span className="block truncate text-[11px] font-mono text-zinc-400 select-all">
            {link}
          </span>
        </div>
      )}

      {error ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-2xs font-medium text-rose-500 border border-rose-500/20">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{error === "bad-request" ? t("group.inviteInvalid") : error}</span>
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2 pt-1">
        <button
          type="button"
          className="group-invite-btn-secondary inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-black/10 bg-black/5 px-2.5 text-2xs font-medium text-zinc-300 hover:bg-black/10 active:scale-95 transition-all disabled:opacity-50"
          disabled={loading}
          onClick={() => void preview()}
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          <span>{loading ? t("groupInvite.parsing") : info ? t("groupInvite.refresh") : t("groupInvite.reparse")}</span>
        </button>

        <button
          type="button"
          className="group-invite-btn-primary inline-flex h-7 flex-1 items-center justify-center rounded-lg bg-brand px-3 text-2xs font-semibold text-brand-foreground shadow-xs hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
          disabled={joining || (Boolean(error) && !info)}
          onClick={() => void join()}
        >
          {joining ? t("groupInvite.joining") : t("groupInvite.join")}
        </button>
      </div>
    </div>
  );
}
