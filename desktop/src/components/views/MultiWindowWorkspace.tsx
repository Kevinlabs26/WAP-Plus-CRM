import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDownUp,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { scopeTodayBoard } from "@/lib/todayBoard";
import { markChatReadRemote } from "@/lib/markChatRead";
import type { ChatPreview, Message } from "@/types/crm";
import type { ChatFolder, ChatFolderClone } from "@/store/appStore";
import { MultiWindowCard } from "@/features/multiWindow/components/MultiWindowCard";
import { MultiWindowLayoutControls } from "@/features/multiWindow/components/MultiWindowLayoutControls";
import { MultiWindowQuickReplies } from "@/features/multiWindow/components/MultiWindowQuickReplies";
import { MAX_VISIBLE_WINDOWS, type FolderWindow, type LayoutMode, type SortMode } from "@/features/multiWindow/types";
import {
  FOLDER_STORAGE_KEY,
  readCompactMode,
  readStoredCollapsedWindowIds,
  readStoredPinnedWindowIds,
  readStoredActiveMembers,
  readIgnoreGroups,
  readLayoutMode,
  readRecentQueueIds,
  readSortMode,
  readStoredChatIds,
  readStoredFolderIds,
  readStoredManualMembers,
  scopedStorageKey,
  STORAGE_KEY,
} from "@/features/multiWindow/storage";
import { phoneIdentity, titleOf } from "@/features/multiWindow/identity";
import { useMultiWindowDataEffects } from "@/features/multiWindow/hooks/useMultiWindowDataEffects";
import { useMultiWindowHistory } from "@/features/multiWindow/hooks/useMultiWindowHistory";
import { useMultiWindowReorder } from "@/features/multiWindow/hooks/useMultiWindowReorder";
import { useMultiWindowRefresh } from "@/features/multiWindow/hooks/useMultiWindowRefresh";
import { useMultiWindowShortcuts } from "@/features/multiWindow/hooks/useMultiWindowShortcuts";
import { useMultiWindowPersistence } from "@/features/multiWindow/hooks/useMultiWindowPersistence";
import {
  buildLastMessageDirectionByChatId,
  buildPendingChatIds,
  filterCandidateChats,
} from "@/features/multiWindow/lib/selectors";
import { collectUnreadChatIdsForWindows } from "@/features/multiWindow/lib/bulkActions";
import { multiWindowGridClass } from "@/features/multiWindow/lib/layout";
import { prioritizePinned } from "@/features/multiWindow/lib/pinned";
import { selectVisibleLoadIds } from "@/features/multiWindow/lib/loading";
import { updateCollapsedWindowIds } from "@/features/multiWindow/lib/collapse";
import { useI18n } from "@/i18n";

export function MultiWindowWorkspace({
  onBack,
  folderRequestId,
  accountScopeId,
  onOpenDevices,
}: {
  onBack: () => void;
  folderRequestId?: string | null;
  accountScopeId?: string;
  onOpenDevices?: () => void;
}) {
  const { t } = useI18n();
  const allChats = useAppStore((s) => s.chats);
  const allContacts = useAppStore((s) => s.contacts);
  const allMessages = useAppStore((s) => s.messages);
  const waAccounts = useAppStore((s) => s.settings.waAccounts || []);
  const chatFolders = useAppStore((s) => s.settings.chatFolders || []);
  const chatFolderClones = useAppStore((s) => s.settings.chatFolderClones || []);
  const selectedChatId = useAppStore((s) => s.selectedChatId);
  const setSelectedChat = useAppStore((s) => s.setSelectedChat);
  const setChatDraft = useAppStore((s) => s.setChatDraft);
  const goToChats = useAppStore((s) => s.goToChats);
  const pushToast = useAppStore((s) => s.pushToast);
  const { chats, contacts, messages } = useMemo(
    () => scopeTodayBoard({ contacts: allContacts, chats: allChats, messages: allMessages, followUps: [] }, accountScopeId),
    [accountScopeId, allChats, allContacts, allMessages]
  );
  const initialSourceFolderIds = readStoredFolderIds(accountScopeId);
  const [openChatIds, setOpenChatIds] = useState<string[]>(() => {
    const available = new Set(chats.map((chat) => chat.id));
    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
    const seen = new Set<string>();
    const stored = readStoredChatIds(
      scopedStorageKey(
        initialSourceFolderIds.length ? FOLDER_STORAGE_KEY : STORAGE_KEY,
        accountScopeId
      )
    )
      .filter((id) => available.has(id))
      .filter((id) => {
        const chat = chats.find((item) => item.id === id);
        if (!chat) return false;
        const key = phoneIdentity(chat, contactMap.get(chat.contactId));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (stored.length) return stored;
    const seeded = [...chats]
      .sort((a, b) => {
        if (a.unread !== b.unread) return b.unread - a.unread;
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      })
      .filter((chat) => {
        const key = phoneIdentity(chat, contactMap.get(chat.contactId));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_VISIBLE_WINDOWS)
      .map((chat) => chat.id);
    return selectedChatId && available.has(selectedChatId)
      ? [selectedChatId, ...seeded.filter((id) => id !== selectedChatId)]
      : seeded;
  });
  const [page, setPage] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quickRepliesWindowId, setQuickRepliesWindowId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(() => readSortMode(accountScopeId));
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => readLayoutMode(accountScopeId));
  const [compactMode, setCompactMode] = useState(() => readCompactMode(accountScopeId));
  const [collapsedWindowIds, setCollapsedWindowIds] = useState<string[]>(() => readStoredCollapsedWindowIds(accountScopeId));
  const [pinnedWindowIds, setPinnedWindowIds] = useState<string[]>(() => readStoredPinnedWindowIds(accountScopeId));
  const [ignoreGroups, setIgnoreGroups] = useState(() => readIgnoreGroups(accountScopeId));
  const [recentQueueIds, setRecentQueueIds] = useState<string[]>(() => readRecentQueueIds(accountScopeId));
  const [sourceFolderIds, setSourceFolderIds] = useState<string[]>(initialSourceFolderIds);
  const [folderPrompt, setFolderPrompt] = useState<{ id: string; name: string } | null>(null);
  const [activeMemberChatByWindow, setActiveMemberChatByWindow] = useState<Record<string, string>>(() => readStoredActiveMembers(accountScopeId));
  const [manualMemberChatIdsByWindow, setManualMemberChatIdsByWindow] = useState<Record<string, string[]>>(() => readStoredManualMembers(accountScopeId));
  const [newPendingCount, setNewPendingCount] = useState(0);
  const previousPendingIdsRef = useRef<Set<string> | null>(null);
  const stableDisplayIdsRef = useRef<string[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [diskMessagesByChatId, setDiskMessagesByChatId] = useState<
    Record<string, Message[]>
  >({});

  useMultiWindowPersistence({
    openChatIds,
    sourceFolderIds,
    manualMemberChatIdsByWindow,
    activeMemberChatByWindow,
    sortMode,
    layoutMode,
    compactMode,
    collapsedWindowIds,
    pinnedWindowIds,
    ignoreGroups,
    recentQueueIds,
    accountScopeId,
  });

  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts]
  );
  const messagesByChatId = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const message of messages) {
      if (!message.chatId) continue;
      const bucket = map.get(message.chatId) || [];
      bucket.push(message);
      map.set(message.chatId, bucket);
    }
    return map;
  }, [messages]);
  const chatById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats]
  );
  const quickRepliesChat = quickRepliesWindowId ? chatById.get(quickRepliesWindowId) : undefined;
  const quickRepliesTitle = quickRepliesChat
    ? titleOf(quickRepliesChat, contactById.get(quickRepliesChat.contactId))
    : "";
  useEffect(() => {
    if (quickRepliesWindowId && !chatById.has(quickRepliesWindowId)) setQuickRepliesWindowId(null);
  }, [chatById, quickRepliesWindowId]);
  const folderChatIds = useMemo(() => {
    const clonesByFolder = new Map<string, ChatFolderClone[]>();
    for (const clone of chatFolderClones) {
      const items = clonesByFolder.get(clone.folderId) || [];
      items.push(clone);
      clonesByFolder.set(clone.folderId, items);
    }
    const childrenByParent = new Map<string, ChatFolder[]>();
    for (const folder of chatFolders) {
      if (!folder.parentId) continue;
      const items = childrenByParent.get(folder.parentId) || [];
      items.push(folder);
      childrenByParent.set(folder.parentId, items);
    }
    const collect = (folderId: string, seen = new Set<string>()) => {
      if (seen.has(folderId)) return [];
      seen.add(folderId);
      const folder = chatFolders.find((item) => item.id === folderId);
      if (!folder) return [];
      const ids = [...folder.chatIds, ...(clonesByFolder.get(folderId) || []).map((item) => item.sourceChatId)];
      for (const child of childrenByParent.get(folderId) || []) ids.push(...collect(child.id, new Set(seen)));
      return [...new Set(ids)];
    };
    return new Map(chatFolders.map((folder) => [folder.id, collect(folder.id)]));
  }, [chatFolderClones, chatFolders]);
  const candidateChats = useMemo(
    () => filterCandidateChats(chats, contactById, ignoreGroups),
    [chats, contactById, ignoreGroups]
  );
  const lastMessageDirectionByChatId = useMemo(
    () => buildLastMessageDirectionByChatId(messages),
    [messages]
  );
  const pendingChatIds = useMemo(
    () => buildPendingChatIds(candidateChats, lastMessageDirectionByChatId),
    [candidateChats, lastMessageDirectionByChatId]
  );
  useEffect(() => {
    const previous = previousPendingIdsRef.current;
    previousPendingIdsRef.current = pendingChatIds;
    if (!previous) return;
    const added = [...pendingChatIds].filter((id) => !previous.has(id));
    const addedPeople = new Set(
      added.map((id) => {
        const chat = chatById.get(id);
        return chat ? phoneIdentity(chat, contactById.get(chat.contactId)) : id;
      })
    );
    if (addedPeople.size) setNewPendingCount((count) => count + addedPeople.size);
  }, [chatById, contactById, pendingChatIds]);
  const sourceChatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const folderId of sourceFolderIds) {
      for (const chatId of folderChatIds.get(folderId) || []) ids.add(chatId);
    }
    return ids;
  }, [folderChatIds, sourceFolderIds]);
  const folderChatIdsForDisplay = useMemo(
    () => candidateChats.filter((chat) => sourceChatIds.has(chat.id)),
    [candidateChats, sourceChatIds]
  );
  const folderWindows = useMemo<FolderWindow[]>(() => {
    const grouped = new Map<string, FolderWindow>();
    for (const chat of folderChatIdsForDisplay) {
      const contact = contactById.get(chat.contactId);
      const rawAddress = contact?.phone || contact?.channelAddress || "";
      const digits = rawAddress.replace(/\D/g, "");
      const key = !contact?.isGroup && digits.length >= 7 ? `phone:${digits}` : `chat:${chat.id}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          chat,
          memberChatIds: [chat.id],
          accountCount: 1,
          unreadCount: chat.unread || 0,
        });
        continue;
      }
      current.memberChatIds.push(chat.id);
      current.unreadCount += chat.unread || 0;
      const accountIds = new Set(
        current.memberChatIds.map((id) => {
          const member = chatById.get(id);
          const memberContact = member ? contactById.get(member.contactId) : undefined;
          return member?.accountId || member?.phoneId || memberContact?.accountId || memberContact?.boundPhoneId || id;
        })
      );
      current.accountCount = accountIds.size;
      const currentPending = pendingChatIds.has(current.chat.id);
      const nextPending = pendingChatIds.has(chat.id);
      if ((nextPending && !currentPending) || (nextPending === currentPending && (chat.updatedAt || "") > (current.chat.updatedAt || ""))) {
        current.chat = chat;
      }
    }
    return [...grouped.values()];
  }, [chatById, contactById, folderChatIdsForDisplay, pendingChatIds]);
  const folderWindowByChatId = useMemo(
    () => new Map(folderWindows.map((item) => [item.chat.id, item])),
    [folderWindows]
  );
  const manualWindows = useMemo<FolderWindow[]>(() => {
    return Object.entries(manualMemberChatIdsByWindow)
      .map(([windowId, memberIds]) => {
        const members = [windowId, ...memberIds]
          .map((id) => chatById.get(id))
          .filter((chat): chat is ChatPreview => Boolean(chat));
        if (!members.length) return null;
        const selected = [...members].sort((a, b) => {
          const aPending = pendingChatIds.has(a.id) ? 1 : 0;
          const bPending = pendingChatIds.has(b.id) ? 1 : 0;
          return bPending - aPending || (b.updatedAt || "").localeCompare(a.updatedAt || "");
        })[0];
        const accountIds = new Set(
          members.map((member) => {
            const contact = contactById.get(member.contactId);
            return member.accountId || member.phoneId || contact?.accountId || contact?.boundPhoneId || member.id;
          })
        );
        return {
          chat: selected,
          memberChatIds: members.map((member) => member.id),
          accountCount: accountIds.size,
          unreadCount: members.reduce((sum, member) => sum + (member.unread || 0), 0),
        };
      })
      .filter((item): item is FolderWindow => Boolean(item));
  }, [chatById, contactById, manualMemberChatIdsByWindow, pendingChatIds]);
  const manualWindowByChatId = useMemo(
    () => new Map(manualWindows.flatMap((item) => item.memberChatIds.map((id) => [id, item] as const))),
    [manualWindows]
  );
  const windowByChatId = sourceFolderIds.length ? folderWindowByChatId : manualWindowByChatId;
  useEffect(() => {
    setActiveMemberChatByWindow((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([windowId, memberId]) =>
          windowByChatId.get(windowId)?.memberChatIds.includes(memberId)
        )
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [windowByChatId]);
  useEffect(() => {
    setCollapsedWindowIds((current) => {
      const next = current.filter((id) => windowByChatId.has(id));
      return next.length === current.length ? current : next;
    });
  }, [windowByChatId]);
  useEffect(() => {
    setPinnedWindowIds((current) => {
      const next = current.filter((id) => windowByChatId.has(id));
      return next.length === current.length ? current : next;
    });
  }, [windowByChatId]);
  const folderName = useMemo(
    () =>
      sourceFolderIds
        .map((id) => chatFolders.find((folder) => folder.id === id)?.name)
        .filter((name): name is string => Boolean(name))
        .join(" + "),
    [chatFolders, sourceFolderIds]
  );
  const folderRequest = useMemo(
    () => (folderRequestId ? chatFolders.find((folder) => folder.id === folderRequestId) : undefined),
    [chatFolders, folderRequestId]
  );
  const folderIdsToOpen = useCallback(
    (folderIds: string[]) => {
      const ids = new Set<string>();
      for (const folderId of folderIds) {
        for (const chatId of folderChatIds.get(folderId) || []) ids.add(chatId);
      }
      return folderWindows
        .filter((item) => item.memberChatIds.some((chatId) => ids.has(chatId)))
        .sort((a, b) => {
          const aPending = pendingChatIds.has(a.chat.id) ? 1 : 0;
          const bPending = pendingChatIds.has(b.chat.id) ? 1 : 0;
          return bPending - aPending || (b.chat.updatedAt || "").localeCompare(a.chat.updatedAt || "");
        })
        .map((item) => item.chat.id);
    }, [folderChatIds, folderWindows, pendingChatIds]);
  const applyFolderRequest = useCallback(
    (mode: "replace" | "append") => {
      if (!folderRequest) return;
      const nextFolderIds = mode === "replace"
        ? [folderRequest.id]
        : [...sourceFolderIds, folderRequest.id].filter((id, index, ids) => ids.indexOf(id) === index);
      const nextChatIds = folderIdsToOpen(nextFolderIds);
      setSourceFolderIds(nextFolderIds);
      setOpenChatIds(nextChatIds);
      setSortMode("priority");
      setPage(0);
      setNewPendingCount(0);
      previousPendingIdsRef.current = pendingChatIds;
      setFolderPrompt(null);
    }, [folderIdsToOpen, folderRequest, pendingChatIds, sourceFolderIds]
  );
  useEffect(() => {
    if (!folderRequest) return;
    if (!sourceFolderIds.length) {
      applyFolderRequest("replace");
      return;
    }
    if (!sourceFolderIds.includes(folderRequest.id)) {
      setFolderPrompt({ id: folderRequest.id, name: folderRequest.name });
    }
  }, [applyFolderRequest, folderRequest, sourceFolderIds]);
  useEffect(() => {
    const activeIds = recentQueueIds.filter((id) => pendingChatIds.has(id));
    const fillIds = [...candidateChats]
      .filter((chat) => pendingChatIds.has(chat.id) && !activeIds.includes(chat.id))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((chat) => chat.id);
    const nextIds = [...activeIds, ...fillIds].slice(0, MAX_VISIBLE_WINDOWS);
    if (nextIds.length !== recentQueueIds.length || nextIds.some((id, i) => id !== recentQueueIds[i])) {
      setRecentQueueIds(nextIds);
    }
  }, [candidateChats, pendingChatIds, recentQueueIds]);
  const filteredPickerChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...candidateChats]
      .filter((chat) => pendingChatIds.has(chat.id))
      .filter((chat) => !q || titleOf(chat, contactById.get(chat.contactId)).toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [candidateChats, contactById, pendingChatIds, query]);
  const liveDisplayChatIds = useMemo(() => {
    if (sourceFolderIds.length) {
      if (sortMode === "opened") {
        return openChatIds.filter((id) => folderWindowByChatId.has(id));
      }
      return [...folderWindows]
        .sort((a, b) => {
          const aPinned = pinnedWindowIds.includes(a.chat.id) ? 1 : 0;
          const bPinned = pinnedWindowIds.includes(b.chat.id) ? 1 : 0;
          if (aPinned !== bPinned) return bPinned - aPinned;
          if (sortMode === "priority") {
            const aPending = pendingChatIds.has(a.chat.id) ? 1 : 0;
            const bPending = pendingChatIds.has(b.chat.id) ? 1 : 0;
            if (aPending !== bPending) return bPending - aPending;
          }
          return (b.chat.updatedAt || "").localeCompare(a.chat.updatedAt || "");
        })
        .map((item) => item.chat.id);
    }
    if (sortMode === "opened") {
      const available = new Set(candidateChats.map((chat) => chat.id));
      return openChatIds.filter((id) => available.has(id));
    }
    if (sortMode === "recent") {
      return prioritizePinned(
        recentQueueIds.filter((id) => pendingChatIds.has(id)).slice(0, MAX_VISIBLE_WINDOWS),
        new Set(pinnedWindowIds)
      );
    }
    return [...candidateChats]
      .filter((chat) => pendingChatIds.has(chat.id))
      .sort((a, b) => {
        const aPinned = pinnedWindowIds.includes(a.id) ? 1 : 0;
        const bPinned = pinnedWindowIds.includes(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      })
      .map((chat) => chat.id);
  }, [candidateChats, folderChatIdsForDisplay, folderWindowByChatId, folderWindows, openChatIds, pendingChatIds, pinnedWindowIds, recentQueueIds, sortMode, sourceChatIds, sourceFolderIds]);
  const unseenPendingCount = previousPendingIdsRef.current
    ? [...pendingChatIds].filter((id) => !previousPendingIdsRef.current?.has(id)).length
    : 0;
  const holdDisplayOrder = newPendingCount > 0 || unseenPendingCount > 0;
  const displayChatIds = holdDisplayOrder && stableDisplayIdsRef.current.length
    ? stableDisplayIdsRef.current
    : liveDisplayChatIds;
  useEffect(() => {
    if (!holdDisplayOrder) stableDisplayIdsRef.current = liveDisplayChatIds;
  }, [holdDisplayOrder, liveDisplayChatIds]);
  const totalPages = Math.max(1, Math.ceil(displayChatIds.length / MAX_VISIBLE_WINDOWS));
  const visibleIds = displayChatIds.slice(
    page * MAX_VISIBLE_WINDOWS,
    (page + 1) * MAX_VISIBLE_WINDOWS
  );
  const visibleIdsKey = visibleIds.join("|");
  const allVisibleCollapsed = visibleIds.length > 0 && visibleIds.every((id) => collapsedWindowIds.includes(id));
  const visibleLoadIds = useMemo(() => {
    return selectVisibleLoadIds(
      visibleIdsKey ? visibleIdsKey.split("|") : [],
      activeMemberChatByWindow,
      new Set(collapsedWindowIds)
    );
  }, [activeMemberChatByWindow, collapsedWindowIds, visibleIdsKey]);
  const { draggingId, beginDrag, dropOn, endDrag, moveByKeyboard } = useMultiWindowReorder({
    enabled: sortMode === "opened",
    setOpenChatIds,
    setSortMode,
  });
  useMultiWindowShortcuts({ visibleIds, page, totalPages, setPage, cardRefs });

  const messagesForChat = useCallback((chatId: string) => {
    const merged = new Map<string, Message>();
    for (const message of diskMessagesByChatId[chatId] || []) merged.set(message.id, message);
    for (const message of messagesByChatId.get(chatId) || []) merged.set(message.id, message);
    return [...merged.values()].sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
  }, [diskMessagesByChatId, messagesByChatId]);
  const { historyByChatId, registerInitialPage, loadOlder } = useMultiWindowHistory({
    getMessages: messagesForChat,
  });
  const { refreshingChatId, refreshWindow } = useMultiWindowRefresh({
    setDiskMessagesByChatId,
    onPageLoaded: registerInitialPage,
    onError: (message) => pushToast(message, "error"),
  });

  const { loadErrorByChatId } = useMultiWindowDataEffects({
    pickerOpen,
    pickerRef,
    setPickerOpen,
    setQuery,
    visibleLoadIds,
    totalPages,
    setPage,
    setDiskMessagesByChatId,
    onPageLoaded: registerInitialPage,
  });

  const markWindowRead = (windowId: string) => {
    const memberIds = windowByChatId.get(windowId)?.memberChatIds || [windowId];
    const state = useAppStore.getState();
    for (const memberId of memberIds) {
      const chat = state.chats.find((item) => item.id === memberId);
      if (!chat?.unread) continue;
      void markChatReadRemote(chat, contactById.get(chat.contactId));
    }
  };
  const visibleUnreadChatIds = useMemo(
    () => collectUnreadChatIdsForWindows(visibleIds, windowByChatId, chatById),
    [chatById, visibleIds, windowByChatId]
  );
  const markVisibleWindowsRead = useCallback(() => {
    for (const chatId of visibleUnreadChatIds) {
      const chat = chatById.get(chatId);
      if (!chat) continue;
      void markChatReadRemote(chat, contactById.get(chat.contactId));
    }
  }, [chatById, contactById, visibleUnreadChatIds]);

  const addChat = (chatId: string) => {
    const chat = chatById.get(chatId);
    if (chat) {
      const key = phoneIdentity(chat, contactById.get(chat.contactId));
      const duplicate = openChatIds.some((openId) => {
        const openChat = chatById.get(openId);
        return openChat && phoneIdentity(openChat, contactById.get(openChat.contactId)) === key;
      });
      if (duplicate) {
        if (!sourceFolderIds.length) {
          const windowId = openChatIds.find((openId) => {
            const openChat = chatById.get(openId);
            return openChat && phoneIdentity(openChat, contactById.get(openChat.contactId)) === key;
          }) || chatId;
          setManualMemberChatIdsByWindow((current) => ({
            ...current,
            [windowId]: [...new Set([...(current[windowId] || []), chatId])],
          }));
          setActiveMemberChatByWindow((current) => ({ ...current, [windowId]: chatId }));
          pushToast(t("multi.accountAdded"), "success");
        } else {
          pushToast(t("multi.accountAlreadyIncluded"), "info");
        }
        setPickerOpen(false);
        setQuery("");
        return;
      }
    }
    setOpenChatIds((current) =>
      current.includes(chatId) ? current : [...current, chatId]
    );
    setSortMode("opened");
    setPickerOpen(false);
    setQuery("");
    setPage(0);
  };

  const removeChat = (windowId: string) => {
    if (sortMode !== "opened") {
      setOpenChatIds(displayChatIds.filter((id) => id !== windowId));
      setSortMode("opened");
      setPage(0);
    } else {
      setOpenChatIds((current) => current.filter((id) => id !== windowId));
    }
    setActiveMemberChatByWindow((current) => {
      if (!(windowId in current)) return current;
      const next = { ...current };
      delete next[windowId];
      return next;
    });
    setManualMemberChatIdsByWindow((current) => {
      if (!(windowId in current)) return current;
      const next = { ...current };
      delete next[windowId];
      return next;
    });
  };

  const changeSortMode = (mode: SortMode) => {
    setSortMode(mode);
    setPage(0);
    setNewPendingCount(0);
    previousPendingIdsRef.current = pendingChatIds;
  };

  const refreshPendingOrder = () => {
    setNewPendingCount(0);
    previousPendingIdsRef.current = pendingChatIds;
    setPage(0);
  };

  const maximize = (chat: ChatPreview) => {
    setSelectedChat(chat.id, chat.accountId || chat.phoneId);
    goToChats("all");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <header className="flex min-h-11 shrink-0 items-center gap-3 border-b border-zinc-800/90 px-4 py-2">
        <Button variant="ghost" className="!min-h-8 gap-1.5 !px-2" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("multi.workspace")}
        </Button>
        <div className="h-4 w-px bg-zinc-800" />
        <div className="w-44 shrink-0">
          <div className="truncate whitespace-nowrap text-[13px] font-semibold">{t("multi.title")}</div>
          <div className="truncate text-2xs text-zinc-600">
            {folderName ? `${t("multi.folder", { name: folderName })} · ` : ""}
            {sortMode === "priority"
              ? sourceFolderIds.length
                ? t("multi.replyPriority")
                : t("multi.awaitingReply")
              : sortMode === "recent"
                ? t("multi.recentMessages")
                : t("multi.openedWindows", { count: openChatIds.length })}
            {" · "}{t("multi.visibleWindows", { visible: visibleIds.length, max: MAX_VISIBLE_WINDOWS })}
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative ml-auto flex w-max items-center gap-1.5">
          {newPendingCount > 0 && (
            <button
              type="button"
              onClick={refreshPendingOrder}
              className="shrink-0 whitespace-nowrap rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-2xs text-brand hover:bg-brand/20"
            >
              {t("multi.newPending", { count: newPendingCount })}
            </button>
          )}
          <button
            type="button"
            disabled={!visibleUnreadChatIds.length}
            onClick={markVisibleWindowsRead}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-2xs text-zinc-500 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35"
            title={t("multi.markPageReadTitle")}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {t("multi.markPageRead")}{visibleUnreadChatIds.length ? ` · ${visibleUnreadChatIds.length}` : ""}
          </button>
          <MultiWindowLayoutControls
            layoutMode={layoutMode}
            compact={compactMode}
            onLayoutChange={(mode) => {
              setLayoutMode(mode);
              setPage(0);
            }}
            onCompactChange={setCompactMode}
            allVisibleCollapsed={allVisibleCollapsed}
            onToggleVisibleCollapsed={() => {
              setCollapsedWindowIds((current) =>
                updateCollapsedWindowIds(current, visibleIds, !allVisibleCollapsed)
              );
            }}
            onResetLayout={() => {
              setLayoutMode("auto");
              setCompactMode(false);
              setCollapsedWindowIds([]);
              setPage(0);
            }}
          />
          <div className="hidden shrink-0 items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5 sm:flex">
            <ArrowDownUp className="mx-1 h-3.5 w-3.5 text-zinc-600" />
            <select
              value={sortMode}
              onChange={(event) => changeSortMode(event.target.value as SortMode)}
              className="h-7 shrink-0 cursor-pointer rounded-md border-0 bg-zinc-700/80 px-2 pr-6 text-2xs text-zinc-100 outline-none transition-colors hover:bg-zinc-800"
              aria-label={t("multi.sortMode")}
              title={t("multi.sortMode")}
            >
              <option value="priority">{t("multi.sortPriority")}</option>
              <option value="recent">{t("multi.sortRecent")}</option>
              <option value="opened">{t("multi.sortOpened")}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setIgnoreGroups((current) => !current)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-2xs transition-colors",
              ignoreGroups
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            )}
            title={ignoreGroups ? t("multi.showGroupsTitle") : t("multi.ignoreGroupsTitle")}
          >
            {ignoreGroups ? t("multi.groupsIgnored") : t("multi.groupsIncluded")}
          </button>
          <div ref={pickerRef} className="relative shrink-0">
            <Button
              variant="secondary"
              className="!min-h-0 shrink-0 gap-1.5 whitespace-nowrap !px-2.5 !py-1.5 text-2xs leading-4"
              onClick={() => setPickerOpen((current) => !current)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("multi.addChat")}
            </Button>
            {pickerOpen && (
              <div className="absolute right-0 top-10 z-30 w-72 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/40">
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <Search className="h-3.5 w-3.5 text-zinc-600" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("multi.searchPending")}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
                />
              </div>
              <div className="max-h-72 overflow-y-auto p-1">
                {filteredPickerChats.map((chat) => {
                  const contact = contactById.get(chat.contactId);
                  const active = openChatIds.includes(chat.id);
                  const title = titleOf(chat, contact);
                  return (
                    <button
                      key={chat.id}
                      type="button"
                      disabled={active}
                      onClick={() => addChat(chat.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <Avatar
                        name={title}
                        seed={contact?.phone || chat.id}
                        src={contact?.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">
                        {title}
                      </span>
                      {active && <span className="text-2xs text-brand">{t("multi.opened")}</span>}
                    </button>
                  );
                })}
                {!filteredPickerChats.length && (
                  <div className="px-3 py-6 text-center text-[11px] text-zinc-600">
                    {query.trim() ? t("multi.noMatch") : t("multi.noPending")}
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-1">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                aria-label={t("multi.previousPage")}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-1 text-2xs tabular-nums text-zinc-600">
                {page + 1}/{totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                aria-label={t("multi.nextPage")}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {visibleIds.length ? (
          <div className={multiWindowGridClass(layoutMode, compactMode)}>
            {visibleIds.map((chatId) => {
              const baseChat = chatById.get(chatId);
              if (!baseChat) return null;
              const folderWindow = windowByChatId.get(chatId);
              const activeChat = chatById.get(activeMemberChatByWindow[chatId] || "") || baseChat;
              const chat = activeChat;
              const contact = contactById.get(chat.contactId);
              const accountOptions = folderWindow
                ? (() => {
                    const seenAccountIds = new Set<string>();
                    const options: Array<{ id: string; label: string }> = [];
                    for (const memberId of folderWindow.memberChatIds) {
                      const member = chatById.get(memberId);
                      if (!member) continue;
                      const memberContact = contactById.get(member.contactId);
                      const accountId = member.accountId || member.phoneId || memberContact?.accountId || memberContact?.boundPhoneId || member.id;
                      if (seenAccountIds.has(accountId)) continue;
                      seenAccountIds.add(accountId);
                      const account = waAccounts.find((item) => item.id === accountId);
                      const accountName = account?.label || account?.userName || account?.phoneE164 || accountId;
                      options.push({
                        id: member.id,
                        label: `${accountName}${memberContact?.name ? ` · ${memberContact.name}` : ""}`,
                      });
                    }
                    return options;
                  })()
                : undefined;
              return (
                <MultiWindowCard
                  key={chat.id}
                  chat={chat}
                  contact={contact}
                  messages={messagesForChat(chat.id)}
                  summary={chat.lastMessage}
                  accountCount={folderWindow?.accountCount}
                  unreadCount={folderWindow?.unreadCount}
                  hasMoreHistory={historyByChatId[chat.id]?.hasMore}
                  historyLoading={historyByChatId[chat.id]?.loading}
                  onLoadOlder={() => void loadOlder(chat.id)}
                  reorderEnabled={sortMode === "opened"}
                  dragging={draggingId === chatId}
                  onDragStart={(event) => beginDrag(chatId, event)}
                  onReorderKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    moveByKeyboard(chatId, event.key === "ArrowUp" ? -1 : 1);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => dropOn(chatId, event)}
                  onDragEnd={endDrag}
                  compact={compactMode}
                  collapsed={collapsedWindowIds.includes(chatId)}
                  onToggleCollapsed={() => {
                    setCollapsedWindowIds((current) => current.includes(chatId)
                      ? current.filter((id) => id !== chatId)
                      : [...current, chatId]);
                  }}
                  pinned={pinnedWindowIds.includes(chatId)}
                  onTogglePinned={() => {
                    setPinnedWindowIds((current) => current.includes(chatId)
                      ? current.filter((id) => id !== chatId)
                      : [...current, chatId]);
                    setNewPendingCount(0);
                    previousPendingIdsRef.current = pendingChatIds;
                    setPage(0);
                  }}
                  refreshing={refreshingChatId === chat.id}
                  onRefresh={() => void refreshWindow(chat.id)}
                  onOpenDevices={onOpenDevices}
                  loadError={loadErrorByChatId[chat.id]}
                  cardRef={(node) => {
                    cardRefs.current[chatId] = node;
                  }}
                  onOpenQuickReplies={() => setQuickRepliesWindowId(chat.id)}
                  accountOptions={accountOptions}
                  onMarkRead={() => markWindowRead(chatId)}
                  onSelectAccount={(memberChatId) => {
                    setActiveMemberChatByWindow((current) => ({ ...current, [chatId]: memberChatId }));
                  }}
                  onClose={() => removeChat(chatId)}
                  onMaximize={() => maximize(chat)}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 text-center">
            <div className="rounded-full bg-brand/10 p-3 text-brand">
              <Plus className="h-5 w-5" />
            </div>
            <div className="text-[13px] font-medium text-zinc-300">
              {sortMode === "opened" ? t("multi.emptyOpened") : t("multi.noPending")}
            </div>
            <div className="text-[11px] text-zinc-600">
              {sortMode === "opened"
                ? t("multi.emptyOpenedHint")
                : t("multi.emptyPendingHint")}
            </div>
            <Button variant="secondary" onClick={() => setPickerOpen(true)}>
              {sortMode === "opened" ? t("multi.addFirstChat") : t("multi.viewChats")}
            </Button>
          </div>
        )}
      </div>
      {quickRepliesWindowId && (
        <aside className="flex w-80 shrink-0 border-l border-zinc-800/90 bg-zinc-950">
          <MultiWindowQuickReplies
            variant="panel"
            title={quickRepliesTitle}
            onClose={() => setQuickRepliesWindowId(null)}
            onPick={(text) => {
              const targetId = quickRepliesWindowId;
              if (!targetId) return;
              const current = useAppStore.getState().draftReplyByChatId[targetId] || "";
              setChatDraft(targetId, current ? `${current}\n${text}` : text);
              setQuickRepliesWindowId(null);
              pushToast(t("multi.quickReplyAdded"), "success");
            }}
          />
        </aside>
      )}
      </div>
      {folderPrompt && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => event.target === event.currentTarget && setFolderPrompt(null)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl shadow-black/60">
            <div className="text-[14px] font-semibold text-zinc-100">{t("multi.openAnotherFolder")}</div>
            <p className="mt-2 text-[12px] leading-5 text-zinc-400">
              {t("multi.folderConflict", {
                current: folderName || t("multi.otherFolder"),
                next: folderPrompt.name,
              })}
            </p>
            <div className="mt-4 grid gap-2">
              <Button variant="primary" onClick={() => applyFolderRequest("append")}>
                {t("multi.appendFolder")}
              </Button>
              <Button variant="secondary" onClick={() => applyFolderRequest("replace")}>
                {t("multi.replaceFolder")}
              </Button>
              <Button variant="ghost" onClick={() => setFolderPrompt(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
