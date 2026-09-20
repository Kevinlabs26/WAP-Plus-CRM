import { useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import type { ChatPreview, Contact } from "@/types/crm";
import type { WaAccount } from "@/types/account";
import {
  CHAT_SORT_OPTIONS,
  countGroupChats,
  filterAndSortSidebarChats,
  filterSidebarContacts,
  filterGroupChats,
  findUnreadMentionedChatIds,
  type GroupChatFilter,
  type ChatSortMode,
} from "./chatSidebarUtils";
import {
  buildSidebarItems,
  type SidebarVirtItem,
} from "./buildSidebarItems";
import type { ChatFolder, ChatFolderClone } from "@/store/appStore";
import { chatInView } from "@/store/accountScope";
import {
  leadCandidateForChat,
  leadDateBucket,
  leadDateLabel,
  type LeadCandidate,
} from "@/lib/leadInbox";
import { normalizeLocale } from "@/i18n";

const EMPTY_WA: WaAccount[] = [];
const EMPTY_FOLDERS: ChatFolder[] = [];
const EMPTY_CLONES: ChatFolderClone[] = [];
const EMPTY_CHAT_BY_CONTACT = new Map<string, ChatPreview>();

export type UseSidebarDataArgs = {
  listTab: "chats" | "contacts";
  query: string;
  showArchived: boolean;
  chatSort: ChatSortMode;
  ungroupedCollapsed: boolean;
  groupFilter: GroupChatFilter;
};

/**
 * 侧栏全部派生数据：过滤/排序会话、联系人、分组、账号标签与
 * Virtuoso 虚拟列表项。仅订阅所需 slice，不订整包 settings。
 */
export function useSidebarData({
  listTab,
  query,
  showArchived,
  chatSort,
  ungroupedCollapsed,
  groupFilter,
}: UseSidebarDataArgs) {
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  const chatListFilter = useAppStore((s) => s.chatListFilter);
  const setChatListFilter = useAppStore((s) => s.setChatListFilter);
  const userName = useAppStore((s) => s.baileysUi.userName);
  const uiLanguage = useAppStore((s) => s.settings.uiLanguage);
  const leadInbox = useAppStore((s) => s.settings.leadInbox);
  const messagesByChatId = useAppStore((s) => s.messagesByChatId);
  const sidebarMessages = useMemo(
    () => Object.values(messagesByChatId).flat(),
    [messagesByChatId]
  );

  const { accountViewMode, activeAccountId, liveBaileysAccountId, waAccounts, chatFoldersAll, chatFolderClones } =
    useAppStore(
      useShallow((s) => ({
        accountViewMode: s.settings.accountViewMode,
        activeAccountId: s.settings.activeAccountId,
        liveBaileysAccountId: s.settings.liveBaileysAccountId,
        waAccounts: s.settings.waAccounts ?? EMPTY_WA,
        chatFoldersAll: s.settings.chatFolders ?? EMPTY_FOLDERS,
        chatFolderClones: s.settings.chatFolderClones ?? EMPTY_CLONES,
      }))
    );

  const selfName = (userName || "").trim();
  // 无 accountId 的旧会话：仅在「看默认发送号」时归到 live；看其它号时不要混入
  const viewMode = accountViewMode || {
    type: "account" as const,
    accountId: liveBaileysAccountId || activeAccountId || "wa-default",
  };
  const dataAccountId = liveBaileysAccountId || activeAccountId || "wa-default";
  const viewAccountId =
    viewMode.type === "account" ? viewMode.accountId : dataAccountId;
  const viewingLiveSlot =
    viewMode.type === "all" || viewAccountId === dataAccountId;
  // 浏览账号2 时 fallback 必须是账号2，否则孤儿数据会全算到账号1
  const filterFallback = viewingLiveSlot ? dataAccountId : viewAccountId;
  const filterLive = viewingLiveSlot ? dataAccountId : viewAccountId;

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const leadCandidates = useMemo(() => {
    const candidates = new Map<string, LeadCandidate>();
    if (!leadInbox.enabled) return candidates;
    const rangeStart =
      leadInbox.dateRangeDays > 0
        ? Date.now() - leadInbox.dateRangeDays * 24 * 60 * 60 * 1000
        : 0;
    const currentAccountId =
      viewMode.type === "account" ? viewMode.accountId : filterFallback;
    for (const chat of chats) {
      const contact = contactById.get(chat.contactId);
      const accountId =
        chat.accountId || contact?.accountId || chat.phoneId || filterFallback;
      if (
        leadInbox.accountScope === "selected" &&
        !leadInbox.selectedAccountIds.includes(accountId)
      ) {
        continue;
      }
      if (
        leadInbox.accountScope === "view" &&
        viewMode.type === "account" &&
        !chatInView(
          chat,
          { type: "account", accountId: currentAccountId },
          filterFallback,
          filterLive
        )
      ) {
        continue;
      }
      const candidate = leadCandidateForChat(
        chat,
        contact,
        messagesByChatId[chat.id] || [],
        leadInbox,
        accountId
      );
      if (!candidate) continue;
      if (rangeStart && Date.parse(candidate.firstInboundAt) < rangeStart) continue;
      if (leadInbox.statusFilter === "pending" && candidate.status !== "pending") continue;
      if (leadInbox.statusFilter === "replied" && candidate.status !== "replied") continue;
      candidates.set(chat.id, candidate);
    }
    return candidates;
  }, [
    chats,
    contactById,
    filterFallback,
    filterLive,
    leadInbox,
    messagesByChatId,
    viewMode,
  ]);

  const leadDateGroupByChatId = useMemo(() => {
    const locale = normalizeLocale(uiLanguage);
    const out = new Map<string, string>();
    for (const candidate of leadCandidates.values()) {
      const bucket = leadDateBucket(candidate.firstInboundAt, leadInbox.dateGrouping);
      if (bucket) {
        out.set(
          candidate.chatId,
          leadDateLabel(bucket, leadInbox.dateGrouping, locale)
        );
      }
    }
    return out;
  }, [leadCandidates, leadInbox.dateGrouping, uiLanguage]);

  const filteredContacts = useMemo(
    () =>
      filterSidebarContacts(
        contacts,
        listTab === "contacts" ? query : "",
        selfName,
        viewMode,
        filterFallback,
        filterLive
      ),
    [
      contacts,
      listTab,
      query,
      selfName,
      viewMode,
      filterFallback,
      filterLive,
    ]
  );

  const {
    filteredChats: allFilteredChats,
    lastBodyByChat,
    lastMsgAtByChat,
    lastDirByChat,
    lastDeliveryStatusByChat,
    archivedCount,
  } = useMemo(
    () =>
      filterAndSortSidebarChats({
        chats,
        contacts,
        contactById,
        messages: sidebarMessages,
        query,
        showArchived,
        selfName,
        sortMode: chatSort,
        listFilter: chatListFilter,
        leadCandidates,
        leadSort: leadInbox.sort,
        accountView:
          chatListFilter === "leads" && leadInbox.accountScope !== "view"
            ? { type: "all" }
            : viewMode,
        fallbackAccountId: filterFallback,
        liveAccountId: filterLive,
      }),
    [
      chats,
      contacts,
      contactById,
      query,
      showArchived,
      selfName,
      chatSort,
      chatListFilter,
      leadCandidates,
      leadInbox.accountScope,
      leadInbox.sort,
      sidebarMessages,
      viewMode,
      filterFallback,
      filterLive,
    ]
  );

  const mentionedChatIds = useMemo(
    () =>
      groupFilter === "mentions"
        ? findUnreadMentionedChatIds(allFilteredChats, messagesByChatId)
        : new Set<string>(),
    [allFilteredChats, groupFilter, messagesByChatId]
  );

  const { chats: filteredChats, hiddenCount: hiddenGroupCount } = useMemo(
    () =>
      filterGroupChats(
        allFilteredChats,
        contactById,
        groupFilter,
        query,
        mentionedChatIds
      ),
    [allFilteredChats, contactById, groupFilter, query, mentionedChatIds]
  );

  const getGroupFilterCounts = useCallback(() => {
    const mentioned = findUnreadMentionedChatIds(
      allFilteredChats,
      useAppStore.getState().messagesByChatId
    );
    return countGroupChats(allFilteredChats, contactById, mentioned);
  }, [allFilteredChats, contactById]);

  const chatByContactId = useMemo(() => {
    if (listTab !== "contacts") return EMPTY_CHAT_BY_CONTACT;
    const m = new Map<string, ChatPreview>();
    for (const ch of chats) {
      if (!m.has(ch.contactId)) m.set(ch.contactId, ch);
    }
    return m;
  }, [chats, listTab]);

  const chatFolders = useMemo(
    () =>
      chatFoldersAll
        .filter((f) => {
          const scope = f.scope;
          if (viewMode.type === "all") {
            // 全部：号内夹子 + 跨号夹子都显示
            return true;
          }
          // 单号：号内分组；wa-default 与直播槽视为同一号
          if (!scope || scope.type === "account") {
            const aid =
              scope?.type === "account" ? scope.accountId : dataAccountId;
            if (aid === viewMode.accountId) return true;
            if (aid === dataAccountId && viewMode.accountId === dataAccountId)
              return true;
            if (
              (aid === "wa-default" || aid === dataAccountId) &&
              (viewMode.accountId === "wa-default" ||
                viewMode.accountId === dataAccountId)
            )
              return true;
            return false;
          }
          // 单号视图不显示纯跨号夹子
          return false;
        })
        .slice()
        .sort((a, b) => {
          // 全部视图：先按账号、再按 sort/名称，便于「夹子都合过来」扫一眼
          if (viewMode.type === "all") {
            const scopeKey = (f: (typeof chatFoldersAll)[number]) => {
              if (f.scope?.type === "all") return "\0all";
              if (f.scope?.type === "account") return f.scope.accountId;
              return dataAccountId;
            };
            const c = scopeKey(a).localeCompare(scopeKey(b));
            if (c) return c;
          }
          return (
            (a.sort || 0) - (b.sort || 0) ||
            a.name.localeCompare(b.name, "zh")
          );
        }),
    [chatFoldersAll, viewMode, dataAccountId]
  );

  const isAllAccountsView =
    viewMode.type === "all" ||
    (chatListFilter === "leads" && leadInbox.accountScope !== "view");
  const accountLabelOf = (accountId?: string | null) => {
    const id = (accountId || dataAccountId || "").trim();
    const acc = waAccounts.find((a) => a.id === id);
    if (acc?.userName?.trim()) return acc.userName.trim();
    if (acc?.label?.trim() && acc.label !== "主账号") return acc.label.trim();
    if (id === dataAccountId && userName) return userName;
    if (!id || id === "wa-default") return "WhatsApp";
    return id.slice(0, 6);
  };
  const accountShortOf = (accountId?: string | null) => {
    const full = accountLabelOf(accountId);
    return full.slice(0, 1).toUpperCase();
  };
  const folderDisplayName = (folder: (typeof chatFolders)[number]) => {
    if (!isAllAccountsView) return folder.name;
    if (folder.scope?.type === "all") return `${folder.name} · 全部`;
    const aid =
      folder.scope?.type === "account"
        ? folder.scope.accountId
        : dataAccountId;
    return `${folder.name} · ${accountLabelOf(aid)}`;
  };
  const chatSortLabel =
    CHAT_SORT_OPTIONS.find((o) => o.id === chatSort)?.label || "最近消息";

  const primaryFolderIdOf = (chatId: string) => {
    const f = chatFolders.find((x) => x.chatIds.includes(chatId));
    return f?.id ?? null;
  };

  const sidebarItems: SidebarVirtItem[] = useMemo(
    () =>
      buildSidebarItems({
        listTab,
        archivedCount,
        showArchived,
        isAllAccountsView,
        filteredChats,
        chatFolders,
        chatFolderClones,
        leadView: chatListFilter === "leads",
        leadMergeAccounts: leadInbox.mergeAccounts,
        leadDateGroupByChatId,
        contactById,
        ungroupedCollapsed,
        query,
        folderDisplayName,
      }),
    [
      listTab,
      archivedCount,
      showArchived,
      isAllAccountsView,
      filteredChats,
      query,
      chatFolders,
      chatFolderClones,
      chatListFilter,
      leadDateGroupByChatId,
      leadInbox.mergeAccounts,
      contactById,
      ungroupedCollapsed,
      waAccounts,
      dataAccountId,
      userName,
    ]
  );

  return {
    selfName,
    viewMode,
    dataAccountId,
    viewAccountId,
    viewingLiveSlot,
    filterFallback,
    filterLive,
    filteredContacts,
    filteredChats,
    hiddenGroupCount,
    getGroupFilterCounts,
    lastBodyByChat,
    lastMsgAtByChat,
    lastDirByChat,
    lastDeliveryStatusByChat,
    archivedCount,
    contactById,
    chatByContactId,
    chatFolders,
    isAllAccountsView,
    accountLabelOf,
    accountShortOf,
    folderDisplayName,
    leadCount: leadCandidates.size,
    chatSortLabel,
    primaryFolderIdOf,
    sidebarItems,
    chatListFilter,
    setChatListFilter,
  };
}
