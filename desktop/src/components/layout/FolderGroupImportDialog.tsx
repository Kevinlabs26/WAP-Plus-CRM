import { useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Search, Users } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import type { ChatPreview, GroupDetails } from "@/types/crm";
import type { WaAccount } from "@/types/account";
import {
  baileysGroupAcceptInvite,
  baileysGroupInviteInfo,
} from "@/lib/baileysGroups";
import { extractWhatsAppInvites } from "@/lib/whatsappGroupInvite";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

type InviteRow = {
  link: string;
  info?: GroupDetails;
  error?: string;
  existingChatId?: string;
  existingAccountId?: string;
  joinedJid?: string;
  status?: "joining" | "joined" | "already" | "pending" | "failed" | "account-mismatch";
};

type Props = {
  mode: "links" | "existing";
  folderName: string;
  groups: ChatPreview[];
  accounts: WaAccount[];
  connectedAccountIds: string[];
  existingGroupChatIds: Record<string, string>;
  accountLabelOf: (accountId?: string | null) => string;
  initialAccountId: string;
  fixedAccountId?: string;
  onClose: () => void;
  onMoveGroups: (chatIds: string[]) => void;
  onJoined: (groupJid: string, info: GroupDetails, accountId: string) => void | Promise<void>;
  onAlreadyJoined: (chatId: string) => void | Promise<void>;
};

export function FolderGroupImportDialog({
  mode,
  folderName,
  groups,
  accounts,
  connectedAccountIds,
  existingGroupChatIds,
  accountLabelOf,
  initialAccountId,
  fixedAccountId,
  onClose,
  onMoveGroups,
  onJoined,
  onAlreadyJoined,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [text, setText] = useState("");
  const [accountId, setAccountId] = useState(fixedAccountId || initialAccountId);
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [joining, setJoining] = useState(false);
  const busy=useRef(false);
  const links=extractWhatsAppInvites(text);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return groups.filter((group) =>
      !needle || group.contactName.toLocaleLowerCase().includes(needle)
    );
  }, [groups, query]);

  const readInvites = async ():Promise<InviteRow[]> => {
    if (!links.length) {
      setRows([{ link: "", error: t("folderGroups.noLinks") }]);
      return [];
    }
    setPreviewing(true);
    const next:InviteRow[]=links.map(link=>({link,joinedJid:rows.find(row=>row.link===link)?.joinedJid}));
    setRows([...next]);
    for (const [index,link] of links.entries()) {
      try {
        const result = await baileysGroupInviteInfo(link, accountId);
        if (result.ok && result.invite) {
          const jid = result.invite.jid;
          const exact = existingGroupChatIds[`${accountId}|${jid}`];
          const other = exact ? undefined : Object.entries(existingGroupChatIds)
            .find(([key]) => key.slice(key.lastIndexOf("|") + 1) === jid);
          const existingAccountId = exact
            ? accountId
            : other?.[0].slice(0, other[0].lastIndexOf("|"));
          const existingChatId = exact || other?.[1];
          const accountMismatch = Boolean(fixedAccountId && existingChatId && existingAccountId !== fixedAccountId);
          next[index] = {
            ...next[index]!,
            info: result.invite as GroupDetails,
            existingAccountId,
            existingChatId,
            status: accountMismatch ? "account-mismatch" : undefined,
            error: accountMismatch
              ? t("folderGroups.groupInOtherAccount", { account: accountLabelOf(existingAccountId) })
              : undefined,
          };
        } else {
          next[index] = { ...next[index]!, error: result.error || t("folderGroups.previewFailed") };
        }
      } catch (error) {
        next[index]={...next[index]!,error:error instanceof Error?error.message:String(error)};
      }
      setRows([...next]);
    }
    setPreviewing(false);
    return next;
  };

  const previewInvites = async () => {
    if(busy.current)return;
    busy.current=true;
    try{await readInvites();}finally{busy.current=false;setPreviewing(false);}
  };

  const joinInvites = async () => {
    if(busy.current||!connectedAccountIds.includes(accountId))return;
    busy.current=true;
    setJoining(true);
    try{
    const available=rows.length?rows:await readInvites();
    const eligible = available.filter(
      (row) => row.info && !["joined", "already", "pending", "account-mismatch"].includes(row.status || "")
    );
    if (!eligible.length) return;
    let successful = 0;
    let alreadyFiled = 0;
    let pending = 0;
    let failed = 0;
    for (const row of eligible) {
      setRows((current) =>
        current.map((item) =>
          item.link === row.link ? { ...item, status: "joining", error: undefined } : item
        )
      );
      try {
        if (row.existingChatId) {
          await onAlreadyJoined(row.existingChatId);
          alreadyFiled += 1;
          setRows((current) =>
            current.map((item) =>
              item.link === row.link
                ? { ...item, status: "already", error: undefined }
                : item
            )
          );
          continue;
        }
        const result = row.joinedJid
          ?{ok:true,groupJid:row.joinedJid,group:row.info}
          :await baileysGroupAcceptInvite(row.link, accountId);
        if (result.ok && !result.groupJid && row.info?.joinApprovalMode) {
          pending += 1;
          setRows((current) =>
            current.map((item) =>
              item.link === row.link
                ? { ...item, status: "pending", error: undefined }
                : item
            )
          );
          continue;
        }
        if (!result.ok || !result.groupJid) {
          throw new Error(result.error || t("folderGroups.joinFailed"));
        }
        setRows(current=>current.map(item=>item.link===row.link?{...item,joinedJid:result.groupJid,info:result.group||row.info}:item));
        await onJoined(result.groupJid, result.group || row.info!, accountId);
        successful += 1;
        setRows((current) =>
          current.map((item) =>
            item.link === row.link ? { ...item, status: "joined", error: undefined } : item
          )
        );
      } catch (error) {
        failed += 1;
        setRows((current) =>
          current.map((item) =>
            item.link === row.link
              ? {
                  ...item,
                  status: "failed",
                  error: error instanceof Error ? error.message : String(error),
                }
              : item
          )
        );
      }
    }
    if (successful || alreadyFiled || pending || failed) {
      useAppStore.getState().pushToast(
        t("folderGroups.joinSummary", {
          joined: successful,
          already: alreadyFiled,
          pending,
          failed,
        }),
        failed || pending ? "info" : "success"
      );
    }
    }finally{busy.current=false;setJoining(false);setPreviewing(false);}
  };

  const filedCount = rows.filter((row) => ["joined", "already"].includes(row.status || "")).length;
  const readyCount = rows.filter(
    (row) => row.info && !["joined", "already", "pending", "account-mismatch"].includes(row.status || "")
  ).length;
  const canRetryOnlyFailures =
    rows.some((row) => row.info && row.status === "failed") &&
    !rows.some((row) => row.info && !row.status);
  const accountConnected = connectedAccountIds.includes(accountId);
  const multipleGroupAccounts =
    new Set(groups.map((group) => group.accountId || group.phoneId)).size > 1;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={joining || previewing ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-900 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !joining && !previewing) onClose();
        }}
      >
        <div className="shrink-0 border-b border-zinc-800 px-5 py-4">
          <h3 className="text-[15px] font-semibold text-zinc-100">
            {mode === "links"
              ? t("folderGroups.inviteTitle", { name: folderName })
              : t("folderGroups.selectTitle", { name: folderName })}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            {mode === "links"
              ? t("folderGroups.inviteHint")
              : t("folderGroups.selectHint")}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {mode === "links" ? (
            <>
              {!fixedAccountId && (
                <label className="block text-[11px] text-zinc-500">
                  {t("folderGroups.account")}
                  <select
                    className="ui-control mt-1 h-9 w-full px-3 text-[12px]"
                    value={accountId}
                    onChange={(event) => {
                      setAccountId(event.target.value);
                      setRows([]);
                    }}
                    disabled={joining || previewing}
                  >
                    {accounts
                      .filter((account) => connectedAccountIds.includes(account.id))
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.userName || account.label || account.id}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setRows([]);
                }}
                rows={5}
                disabled={joining || previewing}
                placeholder="https://chat.whatsapp.com/..."
                className="ui-control w-full resize-y px-3 py-2.5 text-[12px] leading-5"
              />
              <button
                type="button"
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                onClick={() => void previewInvites()}
                disabled={!text.trim() || previewing || joining || !accountConnected}
              >
                {previewing ? t("folderGroups.previewing") : t("folderGroups.preview")}
              </button>
              {!accountConnected && (
                <div className="text-[11px] text-amber-300">
                  {t("folderGroups.accountDisconnected")}
                </div>
              )}
              {rows.length > 0 && (
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div
                      key={row.link || "invalid"}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-zinc-200">
                          {row.info?.subject || row.link || t("folderGroups.invalidLink")}
                        </span>
                        <span className="shrink-0 text-zinc-500">
                          {row.status === "joining" ? t("folderGroups.joining") : null}
                          {row.status === "joined" ? t("folderGroups.joined") : null}
                          {row.status === "already" ? t("folderGroups.alreadyFiled") : null}
                          {row.status === "pending" ? t("folderGroups.pendingApproval") : null}
                          {row.existingChatId && !row.status
                            ? t("folderGroups.alreadyInAccount", { account: accountLabelOf(row.existingAccountId) })
                            : null}
                          {row.error || (!row.info && !row.status ? t("folderGroups.previewing") : null)}
                        </span>
                      </div>
                      {row.error && row.link && (
                        <div className="mt-1 break-all text-[11px] text-rose-300">{row.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("folderGroups.search")}
                  className="ui-control h-9 w-full pl-9 pr-3 text-[12px]"
                />
              </div>
              {filteredGroups.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-brand hover:underline"
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      const allVisibleSelected = filteredGroups.every((group) =>
                        next.has(group.id)
                      );
                      filteredGroups.forEach((group) =>
                        allVisibleSelected ? next.delete(group.id) : next.add(group.id)
                      );
                      return next;
                    })
                  }
                >
                  {filteredGroups.every((group) => selected.has(group.id))
                    ? t("folderGroups.clearVisible")
                    : t("folderGroups.selectVisible")}
                </button>
              )}
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {filteredGroups.map((group) => {
                  const checked = selected.has(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-800",
                        checked && "bg-brand/10"
                      )}
                      onClick={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(group.id)) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-600 text-brand">
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <Users className="h-4 w-4 shrink-0 text-zinc-500" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">
                        {group.contactName}
                      </span>
                      {multipleGroupAccounts && (
                        <span className="shrink-0 text-[10px] text-zinc-500">
                          {accountLabelOf(group.accountId || group.phoneId)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {filteredGroups.length === 0 && (
                  <div className="py-8 text-center text-[12px] text-zinc-500">
                    {groups.length ? t("folderGroups.noMatches") : t("folderGroups.noGroups")}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/40 px-5 py-3">
          {mode === "links" ? (
            <span className="text-[11px] text-zinc-500">
              {filedCount > 0
                ? t("folderGroups.joinProgress", { joined: filedCount })
                : rows.some((row) => row.status === "pending")
                  ? t("folderGroups.pendingCount", {
                      count: rows.filter((row) => row.status === "pending").length,
                    })
                : readyCount > 0
                  ? t("folderGroups.readyCount", { count: readyCount })
                  : ""}
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500">
              {t("folderGroups.selectedCount", { count: selected.size })}
            </span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              onClick={onClose}
              disabled={joining || previewing}
            >
              {t("dialog.cancel")}
            </button>
            {mode === "links" ? (
              <button
                type="button"
                className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
                onClick={() => void joinInvites()}
                disabled={!(rows.length?readyCount:links.length) || !accountConnected || joining || previewing}
              >
                {joining ? <LoaderCircle className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
                {canRetryOnlyFailures
                  ? t("folderGroups.retryFailed", { count: readyCount })
                  : t("folderGroups.joinAndMove", { count: rows.length?readyCount:links.length })}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-[var(--brand-foreground)] hover:brightness-110 disabled:opacity-40"
                onClick={() => onMoveGroups([...selected])}
                disabled={!selected.size}
              >
                {t("folderGroups.moveSelected", { count: selected.size })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
