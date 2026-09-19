import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { baileysGroupMetadata } from "@/lib/baileysGroups";
import {
  GroupInfoActions,
  GroupMemberRowActions,
} from "@/components/chat/GroupInfoActions";
import { GroupJoinRequests } from "@/components/chat/GroupJoinRequests";
import {
  buildDmContact,
  findExistingDmContact,
  memberToDmTarget,
} from "@/lib/groupDm";
import { cn } from "@/lib/utils";
import { enrichGroupMembers } from "@/lib/groupMemberDisplay";
import { useAppStore } from "@/store/appStore";
import type { Contact, GroupDetails, GroupMember } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  contact: Contact | null | undefined;
  accountId?: string | null;
  groupJid?: string;
  onLeftGroup?: () => void;
};

const MEMBER_PAGE_SIZE = 60;

function roleLabel(m: GroupMember) {
  if (m.isSuperAdmin || m.role === "superadmin") return "superadmin";
  if (m.isAdmin || m.role === "admin") return "admin";
  return "";
}

function formatCreated(ts?: number) {
  if (!ts) return "";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

export const GroupInfoPanel = memo(function GroupInfoPanel({
  open,
  onClose,
  contact,
  accountId,
  groupJid,
  onLeftGroup,
}: Props) {
  const { t } = useI18n();
  const openContactWorkspace = useAppStore((s) => s.openContactWorkspace);
  const pushToast = useAppStore((s) => s.pushToast);
  const updateContact = useAppStore((s) => s.updateContact);
  // 成员备注匹配用快照，不订阅整表 contacts（避免每次 ingest 重渲染导致闪烁）
  const contactsRef = useRef<Contact[]>(useAppStore.getState().contacts);
  const contacts = contactsRef.current;
  const ensureDmContact = useCallback(
    (contact: Contact) => {
      const state = useAppStore.getState();
      const exists = state.contacts.some((c) => c.id === contact.id);
      if (exists) {
        openContactWorkspace(contact.id);
        return;
      }
      const owner =
        contact.accountId ||
        contact.boundPhoneId ||
        state.settings.liveBaileysAccountId ||
        state.settings.activeAccountId ||
        "wa-default";
      const chatId = `bridge-chat-${contact.id}`;
      useAppStore.setState((s) => {
        const hasContact = s.contacts.some((c) => c.id === contact.id);
        const hasChat = s.chats.some(
          (c) =>
            c.contactId === contact.id &&
            (c.accountId || c.phoneId || owner) === owner
        );
        return {
          contacts: hasContact ? s.contacts : [...s.contacts, contact],
          chats: hasChat
            ? s.chats
            : [
                {
                  id: chatId,
                  contactId: contact.id,
                  contactName: contact.name,
                  lastMessage: "",
                  unread: 0,
                  updatedAt: new Date().toISOString(),
                  phoneId: owner,
                  accountId: owner,
                },
                ...s.chats,
              ],
        };
      });
      openContactWorkspace(contact.id);
    },
    [openContactWorkspace]
  );

  const openMemberDm = useCallback(
    (m: GroupMember & { displayName?: string; contactId?: string }) => {
      const aid =
        accountId ||
        contact?.accountId ||
        contact?.boundPhoneId ||
        useAppStore.getState().settings.liveBaileysAccountId ||
        useAppStore.getState().settings.activeAccountId ||
        "wa-default";
      const target = memberToDmTarget(m, aid);
      if (!target) {
        pushToast(t("groupPanel.memberAddressUnknown"), "error");
        return;
      }
      const all = useAppStore.getState().contacts;
      // 严格匹配；enrich 的 contactId 也必须通过同一套规则，防止误绑
      let existing = findExistingDmContact(all, target);
      if (!existing && m.contactId) {
        const hinted = all.find((c) => c.id === m.contactId);
        if (hinted && findExistingDmContact([hinted], target)) {
          existing = hinted;
        }
      }
      if (existing) {
        openContactWorkspace(existing.id);
        onClose();
        pushToast(t("groupPanel.openedDm", { name: existing.name || t("groupPanel.member") }), "success");
        return;
      }
      const dm = buildDmContact(target);
      ensureDmContact(dm);
      onClose();
      pushToast(
        target.phoneE164
          ? t("groupPanel.createdDm", { name: dm.name })
          : t("groupPanel.openedTemporaryDm"),
        "success"
      );
    },
    [
      accountId,
      contact?.accountId,
      contact?.boundPhoneId,
      ensureDmContact,
      onClose,
      openContactWorkspace,
      pushToast,
    ]
  );

  const jid =
    groupJid ||
    contact?.channelAddress ||
    (contact?.id?.includes("@g.us") ? contact.id.replace(/^bridge-contact-/, "") : "") ||
    "";
  const decodedJid = useMemo(() => {
    const raw = jid.includes("%") ? decodeURIComponent(jid) : jid;
    if (raw.endsWith("@g.us")) return raw;
    // contact.id 可能是 encode 过的 baileys:xxx@g.us
    const m = raw.match(/[\w.-]+@g\.us/);
    return m?.[0] || raw;
  }, [jid]);

  const applyGroupDetails = useCallback(
    (group: GroupDetails) => {
      setDetails(group);
      setError("");
      const state = useAppStore.getState();
      const owner = accountId || contact?.accountId || contact?.boundPhoneId || "";
      const target = state.contacts.find(
        (item) =>
          item.id === contact?.id ||
          (item.channelAddress === decodedJid &&
            (!owner || (item.accountId || item.boundPhoneId) === owner))
      );
      if (!target) return;
      const patch: Partial<Contact> = { isGroup: true };
      if (group.subject?.trim()) patch.name = group.subject.trim();
      if (group.participantCount !== undefined) patch.participantCount = group.participantCount;
      if (group.desc !== undefined) patch.groupDesc = group.desc;
      if (group.owner !== undefined) patch.groupOwner = group.owner;
      if (group.announce !== undefined) patch.groupAnnounce = group.announce;
      if (group.restrict !== undefined) patch.groupRestrict = group.restrict;
      if (group.ephemeralDuration !== undefined) patch.groupEphemeral = group.ephemeralDuration;
      if (group.joinApprovalMode !== undefined) patch.groupJoinApproval = group.joinApprovalMode;
      if (group.linkedParent !== undefined) patch.groupLinkedParent = group.linkedParent;
      if (group.isCommunity !== undefined) patch.groupIsCommunity = group.isCommunity;
      updateContact(target.id, patch);
    },
    [accountId, contact?.accountId, contact?.boundPhoneId, contact?.id, decodedJid, updateContact]
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<GroupDetails | null>(null);
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [memberLimit, setMemberLimit] = useState(MEMBER_PAGE_SIZE);
  // 按群 JID + 账号去重，避免父组件重渲染触发重复请求。
  const loadedKeyRef = useRef("");

  const load = useCallback(async () => {
    if (!decodedJid.endsWith("@g.us")) {
      setError(t("groupPanel.notGroup"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await baileysGroupMetadata(decodedJid, accountId);
      if (!res.ok || !res.group) {
        setError(res.error || t("groupPanel.loadFailed"));
        setDetails(null);
        return;
      }
      // 内容未变则不 setState（避免新对象引用引发反复渲染）
      setDetails((prev) => {
        const g = res.group as GroupDetails;
        if (
          prev &&
          prev.subject === g.subject &&
          prev.participantCount === g.participantCount &&
          prev.participants === g.participants &&
          prev.desc === g.desc &&
          prev.announce === g.announce &&
          prev.restrict === g.restrict
        ) {
          return prev;
        }
        return g;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetails(null);
    } finally {
      setLoading(false);
    }
  }, [decodedJid, accountId]);

  useEffect(() => {
    if (!open) {
      loadedKeyRef.current = "";
      return;
    }
    // 打开时取一次最新通讯录（成员备注匹配），之后保持快照避免闪烁
    contactsRef.current = useAppStore.getState().contacts;
    const loadKey = `${decodedJid}|${accountId || ""}`;
    if (loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;
    void load();
  }, [open, decodedJid, accountId, load]);

  const members = useMemo(() => {
    const enriched = enrichGroupMembers(
      details?.participants,
      contacts,
      accountId
    );
    const q = deferredFilter.trim().toLowerCase();
    const sorted = [...enriched].sort((a, b) => {
      const ra = a.isSuperAdmin ? 0 : a.isAdmin ? 1 : 2;
      const rb = b.isSuperAdmin ? 0 : b.isAdmin ? 1 : 2;
      if (ra !== rb) return ra - rb;
      // 有本地备注的排前面一点，再按显示名
      if (Boolean(a.matchedContact) !== Boolean(b.matchedContact)) {
        return a.matchedContact ? -1 : 1;
      }
      return (a.displayName || a.phoneE164 || a.jid).localeCompare(
        b.displayName || b.phoneE164 || b.jid,
        "zh"
      );
    });
    if (!q) return sorted;
    return sorted.filter((m) => {
      const blob =
        `${m.displayName || ""} ${m.name || ""} ${m.phoneE164 || ""} ${m.jid}`.toLowerCase();
      return blob.includes(q);
    });
  }, [details?.participants, deferredFilter, contacts, accountId]);

  useEffect(() => {
    setMemberLimit(MEMBER_PAGE_SIZE);
  }, [decodedJid, deferredFilter]);

  if (!open) return null;

  const title =
    details?.subject ||
    contact?.name ||
    t("groupPanel.title");
  const count =
    details?.participantCount ||
    details?.participants?.length ||
    contact?.participantCount ||
    0;

  return (
    <aside className="flex w-full max-w-sm shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-zinc-100">
            {t("groupPanel.title")}
          </div>
          <div className="truncate text-[11px] text-zinc-500">
            {count ? t("groupPanel.members", { count }) : t("groupPanel.fromWhatsApp")}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
        >
          {t("groupPanel.close")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-4 flex items-center gap-3">
          <Avatar
            name={title}
            seed={decodedJid || contact?.phone || title}
            src={contact?.avatarUrl}
            size="lg"
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-zinc-100">
              {title}
            </div>
            <div className="mt-0.5 truncate font-mono text-2xs text-zinc-600">
              {decodedJid}
            </div>
          </div>
        </div>

        {(details?.desc || contact?.groupDesc) && (
          <section className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-zinc-500">
              {t("groupPanel.description")}
            </div>
            <p className="whitespace-pre-wrap text-[12px] leading-5 text-zinc-300">
              {details?.desc || contact?.groupDesc}
            </p>
          </section>
        )}

        <section className="mb-3 flex flex-wrap gap-1.5">
          {(details?.announce ?? contact?.groupAnnounce) && (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-2xs text-amber-200">
              {t("groupPanel.adminOnlyMessages")}
            </span>
          )}
          {(details?.restrict ?? contact?.groupRestrict) && (
            <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-2xs text-sky-200">
              {t("groupPanel.adminOnlyInfo")}
            </span>
          )}
          {(details?.joinApprovalMode ?? contact?.groupJoinApproval) && (
            <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-2xs text-violet-200">
              {t("groupPanel.joinApproval")}
            </span>
          )}
          {Number(details?.ephemeralDuration || contact?.groupEphemeral) >
            0 && (
            <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-2xs text-rose-200">
              {t("groupPanel.ephemeral")} {" "}
              {Number(details?.ephemeralDuration || contact?.groupEphemeral)}s
            </span>
          )}
          {(details?.isCommunity || contact?.groupIsCommunity) && (
            <span className="rounded-full border border-zinc-600 bg-zinc-800/80 px-2 py-0.5 text-2xs text-zinc-300">
              {t("groupPanel.community")}
            </span>
          )}
        </section>

        {decodedJid.endsWith("@g.us") && (
          <GroupJoinRequests
            groupJid={decodedJid}
            accountId={accountId}
            enabled
            onUpdated={(g) => {
              if (g) applyGroupDetails(g);
              else void load();
            }}
            onError={setError}
          />
        )}

        {decodedJid.endsWith("@g.us") && (
          <GroupInfoActions
            groupJid={decodedJid}
            accountId={accountId}
            details={details}
            onUpdated={(g) => {
              if (g) applyGroupDetails(g);
              else void load();
            }}
            onError={setError}
            onLeftGroup={onLeftGroup}
          />
        )}

        {formatCreated(details?.creation) && (
          <div className="mb-3 text-[11px] text-zinc-500">
            {t("groupPanel.createdAt", { date: formatCreated(details?.creation) })}
          </div>
        )}

        <div className="mb-2 flex items-center gap-2">
          <input
            className="ui-control min-w-0 flex-1 px-2.5 py-1.5 text-[12px]"
            placeholder={t("groupPanel.searchMembers")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            type="button"
            className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "…" : t("groupPanel.refresh")}
          </button>
        </div>

        {error && (
          <div className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
            {error}
          </div>
        )}

        <ul className="space-y-0.5">
          {members.slice(0, memberLimit).map((m) => {
            const label = m.displayName;
            const role = roleLabel(m);
            const phoneLine = m.phoneE164 || m.jid;
            const canDm = Boolean(m.jid || m.pnJid || m.lid);
            return (
              <li key={m.jid}>
                <div className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-zinc-900/80">
                  <button
                    type="button"
                    disabled={!canDm}
                    title={canDm ? t("tooltip.dmMember") : t("tooltip.cannotDmMember")}
                    onClick={() => openMemberDm(m)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 text-left",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    <Avatar
                      name={label}
                      seed={m.phoneE164 || m.jid}
                      src={m.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-zinc-200">
                        {label}
                        {m.matchedContact ? (
                          <span className="ml-1 text-2xs text-zinc-600">{t("groupPanel.directory")}</span>
                        ) : null}
                      </div>
                      <div className="truncate font-mono text-2xs text-zinc-600">
                        {phoneLine}
                      </div>
                      <div className="truncate text-2xs text-zinc-500">
                        {t("groupPanel.openDm")}
                      </div>
                    </div>
                    {role && (
                      <span className="shrink-0 text-2xs text-brand">{role === "superadmin" ? t("groupPanel.superAdmin") : role === "admin" ? t("groupPanel.admin") : role}</span>
                    )}
                  </button>
                  <GroupMemberRowActions
                    groupJid={decodedJid}
                    accountId={accountId}
                    member={m}
                    onUpdated={(g) => {
                      if (g) applyGroupDetails(g);
                      else void load();
                    }}
                    onError={setError}
                  />
                </div>
              </li>
            );
          })}
          {members.length > memberLimit && (
            <li>
              <button
                type="button"
                className="w-full rounded-md py-2 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                onClick={() => setMemberLimit((n) => n + MEMBER_PAGE_SIZE)}
              >
                {t("groupPanel.moreMembers")}
              </button>
            </li>
          )}
          {!loading && !error && members.length === 0 && (
            <li className="px-2 py-6 text-center text-[12px] text-zinc-500">
              {t("groupPanel.noMembers")}
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
});
