import { useCallback, useEffect, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import type { ChatPreview, Contact } from "@/types/crm";
import type { WaAccount } from "@/types/account";
import {
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
import { LEAD_INBOX_FOLDER_ID } from "@/store/settingsDefaults";
import { chatInView } from "@/store/accountScope";
import {
  leadCandidatesForChats,
  leadDateBucket,
  leadDateLabel,
  type LeadCandidate,
} from "@/lib/leadInbox";
import { normalizeLocale, translate } from "@/i18n";
import { hideEmptySiblingChats } from "@/lib/chatActivity";

const EMPTY_WA: WaAccount[] = [];
const EMPTY_FOLDERS: ChatFolder[] = [];
const EMPTY_CLONES: ChatFolderClone[] = [];
const EMPTY_CHAT_BY_CONTACT = new Map<string, ChatPreview>();

export type UseSidebarDataArgs = {
  listTab: "chats" | "contacts" | "manage";
  query: string;
  showArchived: boolean;
  chatSort: ChatSortMode;
  ungroupedCollapsed: boolean;
  groupFilter: GroupChatFilter;
  collapsedLeadDateIds: ReadonlySet<string>;
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
  collapsedLeadDateIds,
}: UseSidebarDataArgs) {
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const chatListFilter = useAppStore((s) => s.chatListFilter);
  const setChatListFilter = useAppStore((s) => s.setChatListFilter);
  const userName = useAppStore((s) => s.baileysUi.userName);
  const uiLanguage = useAppStore((s) => s.settings.uiLanguage);
  const leadInbox = useAppStore((s) => s.settings.leadInbox);
  const messagesByChatId = useAppStore((s) => s.messagesByChatId);
  const updateSettings = useAppStore((s) => s.updateSettings);

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
    if (!leadInbox.enabled && !leadInbox.collectedChatIds?.length) return candidates;
    const dismissed = new Set(leadInbox.dismissedChatIds || []);
    const collected = new Set(leadInbox.collectedChatIds || []);
    const rangeStart =
      leadInbox.dateRangeDays > 0
        ? Date.now() - leadInbox.dateRangeDays * 24 * 60 * 60 * 1000
        : 0;
    const currentAccountId =
      viewMode.type === "account" ? viewMode.accountId : filterFallback;
    const eligible = leadCandidatesForChats(chats, contactById, messagesByChatId, {
      ...leadInbox,
      enabled: true,
      removeAfterReply: leadInbox.enabled ? leadInbox.removeAfterReply : false,
    }, filterFallback);
    for (const chat of chats) {
      if (dismissed.has(chat.id)) continue;
      if (!leadInbox.enabled && !collected.has(chat.id)) continue;
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
      const candidate = eligible.get(chat.id);
      if (!candidate) continue;
      if (rangeStart && Date.parse(candidate.firstInboundAt) < rangeStart) continue;
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

  useEffect(() => {
    if (!leadInbox.enabled || !leadCandidates.size) return;
    const current = useAppStore.getState().settings.leadInbox;
    const collected = new Set(current.collectedChatIds || []);
    for (const chatId of leadCandidates.keys()) collected.add(chatId);
    if (collected.size === (current.collectedChatIds || []).length) return;
    updateSettings({ leadInbox: { ...current, collectedChatIds: [...collected].slice(-20_000) } });
  }, [leadCandidates, leadInbox.enabled, updateSettings]);

  const leadDateGroupByChatId = useMemo(() => {
    const locale = normalizeLocale(uiLanguage);
    const out = new Map<string, { id: string; label: string }>();
    const alreadyFiled = new Set(chatFoldersAll.filter((folder) => folder.id !== LEAD_INBOX_FOLDER_ID).flatMap((folder) => folder.chatIds));
    for (const candidate of leadCandidates.values()) {
      if (alreadyFiled.has(candidate.chatId)) continue;
      const bucket = leadDateBucket(candidate.firstInboundAt, leadInbox.dateGrouping);
      if (bucket) {
        out.set(
          candidate.chatId,
          {
            id: bucket,
            label: leadDateLabel(bucket, leadInbox.dateGrouping, locale),
          }
        );
      }
    }
    return out;
  }, [chatFoldersAll, leadCandidates, leadInbox.dateGrouping, uiLanguage]);

  const filteredContacts = useMemo(
    () =>
      filterSidebarContacts(
        contacts,
        listTab !== "chats" ? query : "",
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
        messagesByChatId,
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
      viewMode,
      filterFallback,
      filterLive,
      messagesByChatId,
    ]
  );

  const mentionedChatIds = useMemo(
    () =>
      groupFilter === "mentions"
        ? findUnreadMentionedChatIds(allFilteredChats, messagesByChatId)
        : new Set<string>(),
    [allFilteredChats, groupFilter, messagesByChatId]
  );

  const { chats: groupFilteredChats, hiddenCount: hiddenGroupCount } = useMemo(
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
  const folderChatIds = useMemo(
    () => new Set([
      ...chatFoldersAll.flatMap((folder) => folder.chatIds),
      ...chatFolderClones.map((clone) => clone.sourceChatId),
      ...leadCandidates.keys(),
    ]),
    [chatFoldersAll, chatFolderClones, leadCandidates]
  );
  const filteredChats = useMemo(
    () => hideEmptySiblingChats(groupFilteredChats, chats, contactById, folderChatIds),
    [groupFilteredChats, chats, contactById, folderChatIds]
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

  const chatFolders = useMemo(() => {
    const root = chatFoldersAll.find((folder) => folder.id === LEAD_INBOX_FOLDER_ID);
    const allById = new Map(chatFoldersAll.map((folder) => [folder.id, folder]));
    const isInLeadTree = (folder: ChatFolder) => {
      let current: ChatFolder | undefined = folder;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        if (current.id === LEAD_INBOX_FOLDER_ID) return true;
        seen.add(current.id);
        current = current.parentId ? allById.get(current.parentId) : undefined;
      }
      return false;
    };
    const rootChildren = root ? chatFoldersAll.filter((folder) => folder.id !== root.id && isInLeadTree(folder)) : [];
    const nestedIds = new Set(rootChildren.flatMap((folder) => folder.chatIds));
    const outsideIds = new Set(chatFoldersAll.filter((folder) => !isInLeadTree(folder)).flatMap((folder) => folder.chatIds));
    const candidates = [...leadCandidates.keys()].filter((chatId) => !nestedIds.has(chatId) && !outsideIds.has(chatId));
    const collected = new Set(leadInbox.collectedChatIds || []);
    const foldersWithLeadRoot = chatFoldersAll.map((folder) => {
      if (folder.id !== LEAD_INBOX_FOLDER_ID) return folder;
      const chatIds = leadInbox.dateGrouping === "none"
        ? [...new Set([...folder.chatIds, ...candidates])]
        : folder.chatIds.filter((chatId) => !collected.has(chatId));
      return { ...folder, chatIds };
    });
    return foldersWithLeadRoot
        .filter((f) => {
          if (f.id === LEAD_INBOX_FOLDER_ID || isInLeadTree(f)) return true;
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
          if (a.id === LEAD_INBOX_FOLDER_ID) return -1;
          if (b.id === LEAD_INBOX_FOLDER_ID) return 1;
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
        });
  }, [chatFoldersAll, viewMode, dataAccountId, leadCandidates, leadInbox.dateGrouping, leadInbox.collectedChatIds]);

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
    return folder.systemType === "leadInbox" && folder.name === "主动联系"
      ? translate(normalizeLocale(uiLanguage), "leadInbox.title")
      : folder.name;
  };
  const primaryFolderIdOf = (chatId: string) => {
    const f = chatFolders.find((x) => x.chatIds.includes(chatId));
    return f?.id ?? (leadCandidates.has(chatId) ? LEAD_INBOX_FOLDER_ID : null);
  };

  const sidebarItems: SidebarVirtItem[] = useMemo(
    () =>
      buildSidebarItems({
        listTab: listTab === "manage" ? "contacts" : listTab,
        archivedCount,
        showArchived,
        isAllAccountsView,
        filteredChats,
        chatFolders,
        chatFolderClones,
        leadView: false,
        leadMergeAccounts: leadInbox.mergeAccounts,
        leadDateGroupByChatId,
        collapsedLeadDateIds,
        contactById,
        lastMsgAtByChat,
        ungroupedCollapsed,
        query,
        folderDisplayName,
        selectedChatId,
      }),
    [
      listTab,
      selectedChatId,
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
      collapsedLeadDateIds,
      contactById,
      lastMsgAtByChat,
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
    primaryFolderIdOf,
    sidebarItems,
    chatListFilter,
    setChatListFilter,
  };
}
