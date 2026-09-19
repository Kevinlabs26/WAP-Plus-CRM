import { useState } from "react";
import {
  baileysGroupInviteCode,
  baileysGroupLeave,
  baileysGroupParticipants,
  baileysGroupRevokeInvite,
  baileysGroupSettings,
  baileysGroupUpdateDescription,
  baileysGroupUpdateSubject,
} from "@/lib/baileysGroups";
import { useAppStore } from "@/store/appStore";
import { parsePhoneEntries } from "@/lib/phoneEntries";
import type { GroupDetails, GroupMember } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  groupJid: string;
  accountId?: string | null;
  details: GroupDetails | null;
  onUpdated: (g: GroupDetails | null) => void;
  onError: (msg: string) => void;
  /** 退群成功后由上层清本地会话 / 关面板 */
  onLeftGroup?: () => void;
};

export function GroupInfoActions({
  groupJid,
  accountId,
  details,
  onUpdated,
  onError,
  onLeftGroup,
}: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState("");
  const [subject, setSubject] = useState("");
  const [desc, setDesc] = useState("");
  const [addPhones, setAddPhones] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [editing, setEditing] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const applyGroup = (g?: GroupDetails | null) => {
    if (g) onUpdated(g);
  };

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-2xs font-medium uppercase tracking-wide text-zinc-500">
          {t("groupActions.title")}
        </div>
        <button
          type="button"
          className="text-2xs text-zinc-400 hover:text-zinc-200"
          onClick={() => {
            setEditing((v) => !v);
            if (!editing) {
              setSubject(details?.subject || "");
              setDesc(details?.desc || "");
            }
          }}
        >
          {editing ? t("groupActions.collapse") : t("groupActions.expand")}
        </button>
      </div>
      {!editing ? (
        <p className="text-2xs leading-4 text-zinc-500">
          {t("groupActions.summary")}
        </p>
      ) : (
        <>
          <label className="block">
            <span className="text-2xs text-zinc-500">{t("groupActions.name")}</span>
            <div className="mt-0.5 flex gap-1">
              <input
                className="ui-control min-w-0 flex-1 px-2 py-1 text-[12px]"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={100}
              />
              <button
                type="button"
                disabled={busy === "subject" || !subject.trim()}
                className="shrink-0 rounded-md bg-brand/90 px-2 text-2xs font-medium text-[var(--brand-foreground)] disabled:opacity-40"
                onClick={() =>
                  void run("subject", async () => {
                    const res = await baileysGroupUpdateSubject(
                      groupJid,
                      subject.trim(),
                      accountId
                    );
                    if (!res.ok) throw new Error(res.error || t("common.save"));
                    applyGroup(res.group || null);
                  })
                }
              >
                {t("groupActions.save")}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-2xs text-zinc-500">{t("groupActions.description")}</span>
            <textarea
              className="ui-control mt-0.5 min-h-[56px] w-full resize-y px-2 py-1 text-[12px]"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={2048}
            />
            <button
              type="button"
              disabled={busy === "desc"}
              className="mt-1 rounded-md border border-zinc-700 px-2 py-0.5 text-2xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              onClick={() =>
                void run("desc", async () => {
                  const res = await baileysGroupUpdateDescription(
                    groupJid,
                    desc,
                    accountId
                  );
                  if (!res.ok) throw new Error(res.error || t("groupActions.saveDescription"));
                  applyGroup(res.group || null);
                })
              }
            >
              {t("groupActions.saveDescription")}</button>
          </label>

          <div>
            <div className="text-2xs text-zinc-500">{t("groupActions.inviteLink")}</div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              <button
                type="button"
                disabled={busy === "invite"}
                className="rounded-md border border-zinc-700 px-2 py-0.5 text-2xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                onClick={() =>
                  void run("invite", async () => {
                    const res = await baileysGroupInviteCode(
                      groupJid,
                      accountId
                    );
                    if (!res.ok) throw new Error(res.error || t("groupActions.getCopy"));
                    setInviteUrl(res.inviteUrl || "");
                    if (!res.inviteUrl) {
                      throw new Error(t("groupActions.noInviteLink"));
                    }
                    try {
                      await navigator.clipboard.writeText(res.inviteUrl);
                      useAppStore
                        .getState()
                        .pushToast(t("group.linkCopied"), "success");
                    } catch {
                      useAppStore
                        .getState()
                        .pushToast(
                          t("group.copyLinkFailed", { url: res.inviteUrl }),
                          "info"
                        );
                    }
                  })
                }
              >
                {t("groupActions.getCopy")}</button>
              <button
                type="button"
                disabled={busy === "revoke"}
                className="rounded-md border border-rose-500/30 px-2 py-0.5 text-2xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-40"
                onClick={() => {
                  void (async () => {
                    const ok = await useAppStore.getState().requestConfirm({
                      title: t("group.resetInviteTitle"),
                      description: t("group.resetInviteDescription"),
                      confirmLabel: t("group.resetInvite"),
                      cancelLabel: t("common.cancel"),
                      tone: "danger",
                    });
                    if (!ok) return;
                    void run("revoke", async () => {
                      const res = await baileysGroupRevokeInvite(
                        groupJid,
                        accountId
                      );
                      if (!res.ok) throw new Error(res.error || t("groupActions.resetLink"));
                      setInviteUrl(res.inviteUrl || "");
                      useAppStore
                        .getState()
                        .pushToast(t("group.inviteReset"), "success");
                    });
                  })();
                }}
              >
                {t("groupActions.resetLink")}
              </button>
            </div>
            {inviteUrl && (
              <div className="mt-1 break-all font-mono text-2xs text-brand">
                {inviteUrl}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-2xs text-zinc-500">
              {t("groupActions.addMembers")}
            </span>
            <div className="mt-0.5 flex gap-1">
              <input
                className="ui-control min-w-0 flex-1 px-2 py-1 text-[12px]"
                placeholder="12025550123 / +12025550124"
                value={addPhones}
                onChange={(e) => setAddPhones(e.target.value)}
              />
              <button
                type="button"
                disabled={busy === "add" || !addPhones.trim()}
                className="shrink-0 rounded-md border border-zinc-700 px-2 text-2xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                onClick={() =>
                  void run("add", async () => {
                    const parts = parsePhoneEntries(addPhones);
                    const res = await baileysGroupParticipants(
                      groupJid,
                      "add",
                      parts,
                      accountId
                    );
                    if (!res.ok) throw new Error(res.error || t("groupActions.add"));
                    applyGroup(res.group || null);
                    setAddPhones("");
                  })
                }
              >
                {t("groupActions.add")}
              </button>
            </div>
          </label>

          <div className="flex flex-wrap gap-1">
            <ToggleChip
              label={t("groupActions.adminMessages")}
              on={Boolean(details?.announce)}
              busy={busy === "ann"}
              onClick={() =>
                void run("ann", async () => {
                  const res = await baileysGroupSettings(
                    groupJid,
                    { announcement: !details?.announce },
                    accountId
                  );
                  if (!res.ok) throw new Error(res.error || t("groupActions.operationFailed"));
                  applyGroup(res.group || null);
                })
              }
            />
            <ToggleChip
              label={t("groupActions.lockInfo")}
              on={Boolean(details?.restrict)}
              busy={busy === "lock"}
              onClick={() =>
                void run("lock", async () => {
                  const res = await baileysGroupSettings(
                    groupJid,
                    { locked: !details?.restrict },
                    accountId
                  );
                  if (!res.ok) throw new Error(res.error || t("groupActions.operationFailed"));
                  applyGroup(res.group || null);
                })
              }
            />
            <ToggleChip
              label={t("groupActions.joinApproval")}
              on={Boolean(details?.joinApprovalMode)}
              busy={busy === "join"}
              onClick={() =>
                void run("join", async () => {
                  const res = await baileysGroupSettings(
                    groupJid,
                    {
                      joinApprovalMode: details?.joinApprovalMode
                        ? "off"
                        : "on",
                    },
                    accountId
                  );
                  if (!res.ok) throw new Error(res.error || t("groupActions.operationFailed"));
                  applyGroup(res.group || null);
                })
              }
            />
            <ToggleChip
              label={t("groupActions.adminAdd")}
              on={Boolean(details?.memberAddMode)}
              busy={busy === "addMode"}
              onClick={() =>
                void run("addMode", async () => {
                  const res = await baileysGroupSettings(
                    groupJid,
                    {
                      memberAddMode: details?.memberAddMode
                        ? "all_member_add"
                        : "admin_add",
                    },
                    accountId
                  );
                  if (!res.ok) throw new Error(res.error || t("groupActions.operationFailed"));
                  applyGroup(res.group || null);
                })
              }
            />
          </div>

          <button
            type="button"
            disabled={busy === "leave"}
            className="w-full rounded-md border border-rose-500/40 bg-rose-500/10 py-1 text-[11px] text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
            onClick={() => {
              void (async () => {
                const ok = await useAppStore.getState().requestConfirm({
                  title: t("group.leaveTitle"),
                  description: t("group.leaveDescription"),
                  confirmLabel: t("group.leave"),
                  cancelLabel: t("common.cancel"),
                  tone: "danger",
                });
                if (!ok) return;
                void run("leave", async () => {
                  const res = await baileysGroupLeave(groupJid, accountId);
                  if (!res.ok) throw new Error(res.error || t("groupActions.leave"));
                  onError("");
                  onLeftGroup?.();
                  useAppStore.getState().pushToast(t("group.left"), "info");
                });
              })();
            }}
          >
            {t("groupActions.leave")}</button>
        </>
      )}
    </div>
  );
}

function ToggleChip({
  label,
  on,
  busy,
  onClick,
}: {
  label: string;
  on: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={
        on
          ? "rounded-full border border-brand/40 bg-brand/15 px-2 py-0.5 text-2xs text-brand disabled:opacity-40"
          : "rounded-full border border-zinc-700 px-2 py-0.5 text-2xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
      }
    >
      {label}
      {on ? ` · ${t("groupActions.on")}` : ` · ${t("groupActions.off")}`}
    </button>
  );
}

/** 单行成员：提升/降级/移除 */
export function GroupMemberRowActions({
  groupJid,
  accountId,
  member,
  onUpdated,
  onError,
}: {
  groupJid: string;
  accountId?: string | null;
  member: GroupMember;
  onUpdated: (g: GroupDetails | null) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const act = async (action: "promote" | "demote" | "remove") => {
    if (action === "remove") {
      const ok = await useAppStore.getState().requestConfirm({
        title: t("group.removeMemberTitle"),
        description: t("group.removeMemberDescription"),
        confirmLabel: t("group.removeMember"),
        cancelLabel: t("common.cancel"),
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await baileysGroupParticipants(
        groupJid,
        action,
        [member.jid],
        accountId
      );
      if (!res.ok) throw new Error(res.error || t("groupRequests.operationFailed"));
      onUpdated(res.group || null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const isAdmin = member.isAdmin || member.role === "admin";
  const isSuper = member.isSuperAdmin || member.role === "superadmin";
  if (isSuper) return null;
  return (
    <div className="flex shrink-0 gap-0.5">
      <button
        type="button"
        disabled={busy}
        title={isAdmin ? t("tooltip.groupAdminOff") : t("tooltip.groupAdminOn")}
        className="rounded px-1 text-2xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
        onClick={() => void act(isAdmin ? "demote" : "promote")}
      >
        {isAdmin ? t("groupActions.demote") : t("groupActions.promote")}
      </button>
      <button
        type="button"
        disabled={busy}
        title={t("tooltip.removeGroupMember")}
        className="rounded px-1 text-2xs text-rose-400/80 hover:bg-rose-500/10 disabled:opacity-40"
        onClick={() => void act("remove")}
      >
        {t("groupActions.remove")}
      </button>
    </div>
  );
}
