import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Virtuoso,
  type ScrollSeekPlaceholderProps,
} from "react-virtuoso";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { CreateGroupModal } from "@/components/chat/CreateGroupModal";
import { BatchSaveContactsModal } from "@/components/settings/BatchSaveContactsModal";
import { openJoinedGroup } from "@/components/chat/openJoinedGroup";
import {
  getAccountBlocklist,
  getAccountHistoryNote,
  isJidBlocked,
  resolveWaMetaAccountId,
  setAccountBlocklist,
} from "@/lib/accountWaMeta";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { bridgeInvoke } from "@/lib/bridge";
import {
  baileysChatModify,
  baileysMessagesRead,
  baileysSync,
} from "@/lib/baileys";
import { markChatReadRemote } from "@/lib/markChatRead";
import { isSyncDebugEnabled, syncLog } from "@/lib/syncDebug";
import { applyChatPreference } from "@/lib/chatPreferences";
import { baileysBlocklistSet } from "@/lib/baileysBlocklist";
import { cn } from "@/lib/utils";
import {
  SAVED_MESSAGES_CHAT_ID,
  type ChatPreview,
  type Contact,
  type GroupDetails,
} from "@/types/crm";
import type { ContactSyncItem } from "@shared/protocol";
import {
  ChatContextMenu,
  type ChatMenuAction,
  type ChatMenuActionExtra,
} from "./ChatContextMenu";
import { ChatSidebarRow } from "./ChatSidebarRow";
import { ContactSidebarList } from "./ContactSidebarList";
import { FolderHeaderRow } from "./FolderHeaderRow";
import { FolderGroupImportDialog } from "./FolderGroupImportDialog";
import { SidebarSpecialItem } from "./SidebarSpecialItem";
import {
  FolderDialog,
  type FolderDialogState,
  type PendingFolderAction,
} from "./FolderDialog";
import {
  CHAT_SORT_OPTIONS,
  chatTarget,
  type ChatSortMode,

  type GroupChatFilter,
} from "./chatSidebarUtils";
import type { WaAccount } from "@/types/account";
import { PhoneListSection } from "./PhoneListSection";
import { SidebarListHeader } from "./SidebarListHeader";
import { LeadInboxSettingsPopover } from "./LeadInboxSettingsPopover";
import { useChatFolderDrag } from "./useChatFolderDrag";
import { useSidebarData } from "./useSidebarData";
import { useI18n } from "@/i18n";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { EyeOff, FolderInput, FolderPlus } from "lucide-react";

const EMPTY_WA: WaAccount[] = [];
const GROUP_CHAT_FILTERS: GroupChatFilter[] = [
  "all",
  "hidden",
  "only",
  "unread",
  "pinned",
  "mentions",
];
const SIDEBAR_SCROLL_SEEK = {
  enter: (velocity: number) => Math.abs(velocity) > 400,
  exit: (velocity: number) => Math.abs(velocity) < 180,
};
const SIDEBAR_VIRTUOSO_COMPONENTS = {
  ScrollSeekPlaceholder: ({ height }: ScrollSeekPlaceholderProps) => (
    <div
      aria-hidden
      className="flex items-center gap-2.5 px-2.5"
      style={{ height }}
    >
      <div className="h-7 w-7 shrink-0 rounded-full bg-zinc-800/70" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-2.5 w-2/5 rounded bg-zinc-800/70" />
        <div className="h-2 w-3/5 rounded bg-zinc-900" />
      </div>
    </div>
  ),
};
const EMPTY_CLONES: NonNullable<
  ReturnType<typeof useAppStore.getState>["settings"]["chatFolderClones"]
> = [];

export function PhoneSidebar() {
  const { t } = useI18n();
  const phones = useAppStore((s) => s.phones);
  const contacts = useAppStore((s) => s.contacts);
  const chats = useAppStore((s) => s.chats);
  // 侧栏只用 chat preview 排序/摘要，禁止订阅全部 messages
  const selectedPhoneId = useAppStore((s) => s.selectedPhoneId);
  const selectedContactId = useAppStore((s) => s.selectedContactId);
  const selectedChatId = useAppStore((s) => s.selectedChatId);

  const {
    setSelectedPhone,
    setSelectedChat,
    openContactWorkspace,
    pushToast,
    ingestBridgeEvents,
    patchChat,
    deleteChatLocal,
    clearChatMessages,
    inboundKeysForChat,
    markChatUnreadLocal,
    requestConfirm,
    updateSettings,
    openSavedMessages,
    setActiveNav,
    createChatFolder,
    renameChatFolder,
    deleteChatFolder,
    clearChatFolder,
    toggleChatFolderCollapsed,
    moveChatToFolder,
    cloneChatToFolder,
    removeChatFolderClone,
    importPhonesToFolder,
  } = useAppStore(
    useShallow((s) => ({
      setSelectedPhone: s.setSelectedPhone,
      setSelectedChat: s.setSelectedChat,
      openContactWorkspace: s.openContactWorkspace,
      pushToast: s.pushToast,
      ingestBridgeEvents: s.ingestBridgeEvents,
      patchChat: s.patchChat,
      deleteChatLocal: s.deleteChatLocal,
      clearChatMessages: s.clearChatMessages,
      inboundKeysForChat: s.inboundKeysForChat,
      markChatUnreadLocal: s.markChatUnreadLocal,
      requestConfirm: s.requestConfirm,
      updateSettings: s.updateSettings,
      openSavedMessages: s.openSavedMessages,
      setActiveNav: s.setActiveNav,
      createChatFolder: s.createChatFolder,
      renameChatFolder: s.renameChatFolder,
      deleteChatFolder: s.deleteChatFolder,
      clearChatFolder: s.clearChatFolder,
      toggleChatFolderCollapsed: s.toggleChatFolderCollapsed,
      moveChatToFolder: s.moveChatToFolder,
      cloneChatToFolder: s.cloneChatToFolder,
      removeChatFolderClone: s.removeChatFolderClone,
      importPhonesToFolder: s.importPhonesToFolder,
    }))
  );

  // 细粒度 settings：禁止订整包 s.settings
  const {
    sendChannel,
    accountViewMode,
    activeAccountId,
    liveBaileysAccountId,
    leadInbox,
    waAccounts,
    chatFolderClones,
    historySyncNoteByAccountId,
    historySyncNoteLegacy,
    blocklistByAccountId,
    blocklistJids,
  } = useAppStore(
    useShallow((s) => ({
      sendChannel: s.settings.sendChannel,
      accountViewMode: s.settings.accountViewMode,
      activeAccountId: s.settings.activeAccountId,
      liveBaileysAccountId: s.settings.liveBaileysAccountId,
      leadInbox: s.settings.leadInbox,
      waAccounts: s.settings.waAccounts ?? EMPTY_WA,
      chatFolderClones: s.settings.chatFolderClones ?? EMPTY_CLONES,
      historySyncNoteByAccountId: s.settings.historySyncNoteByAccountId,
      historySyncNoteLegacy: s.settings.historySyncNote || "",
      blocklistByAccountId: s.settings.blocklistByAccountId,
      blocklistJids: s.settings.blocklistJids,
    }))
  );

  const baileysUi = useAppStore(
    useShallow((s) => ({
      connection: s.baileysUi.connection,
      userName: s.baileysUi.userName,
    }))
  );

  const historySyncNote = getAccountHistoryNote(
    historySyncNoteByAccountId,
    resolveWaMetaAccountId(
      accountViewMode?.type === "account"
        ? accountViewMode.accountId
        : liveBaileysAccountId,
      {
        liveBaileysAccountId,
        activeAccountId,
      }
    ),
    historySyncNoteLegacy
  );
  const isBaileys = sendChannel !== "android_bridge";
  const accountIsConnected = (accountId?: string | null) =>
    isWaAccountConnected(
      waAccounts,
      accountId,
      liveBaileysAccountId,
      baileysUi.connection
    );
  const syncAccountId =
    accountViewMode?.type === "account"
      ? accountViewMode.accountId
      : liveBaileysAccountId || activeAccountId;
  const syncAccountConnected = accountIsConnected(syncAccountId);
  const connectedAccountIds = useMemo(
    () => waAccounts.filter((account) => accountIsConnected(account.id)).map((account) => account.id),
    [baileysUi.connection, liveBaileysAccountId, waAccounts]
  );

  const [syncing, setSyncing] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [batchSaveOpen, setBatchSaveOpen] = useState(false);
  const [listTab, setListTab] = useState<"chats" | "contacts">("chats");
  const [visitedListTabs, setVisitedListTabs] = useState(
    () => new Set<"chats" | "contacts">(["chats"])
  );
  const selectListTab = useCallback((tab: "chats" | "contacts") => {
    setVisitedListTabs((current) => {
      if (current.has(tab)) return current;
      return new Set(current).add(tab);
    });
    setListTab(tab);
  }, []);

  const openFolderMultiWindow = useCallback((folderId: string) => {
    try {
      localStorage.setItem("wap.pendingMultiWindowFolder", folderId);
    } catch {
      /* localStorage is optional */
    }
    setActiveNav("today");
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<{ folderId: string }>("wap:open-multi-folder", {
          detail: { folderId },
        })
      );
    }, 0);
  }, [setActiveNav]);
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupChatFilter>(() => {
    try {
      const saved = localStorage.getItem("wap.groupChatFilter");
      if (GROUP_CHAT_FILTERS.includes(saved as GroupChatFilter)) {
        return saved as GroupChatFilter;
      }
      return localStorage.getItem("wap.hideGroupChats") === "1"
        ? "hidden"
        : "all";
    } catch {
      return "all";
    }
  });
  const changeGroupFilter = useCallback((mode: GroupChatFilter) => {
    setGroupFilter(mode);
    try {
      localStorage.setItem("wap.groupChatFilter", mode);
      localStorage.setItem("wap.hideGroupChats", mode === "hidden" ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  const [chatSort, setChatSort] = useState<ChatSortMode>(() => {
    try {
      const saved = localStorage.getItem("wap.chatSort");
      if (CHAT_SORT_OPTIONS.some((o) => o.id === saved)) {
        return saved as ChatSortMode;
      }
    } catch {
      /* ignore */
    }
    return "unread";
  });
  const [chatSortOpen, setChatSortOpen] = useState(false);
  const [leadSettingsOpen, setLeadSettingsOpen] = useState(false);
  const [collapsedLeadDateIds, setCollapsedLeadDateIds] = useState<Set<string>>(
    () => new Set()
  );
  const [leadDateMenu, setLeadDateMenu] = useState<{
    x: number;
    y: number;
    groupId: string;
    label: string;
    chatIds: string[];
  } | null>(null);
  const chatSortRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chatSortOpen) return;
    const onPointer = (e: Event) => {
      const t = e.target as Node | null;
      if (chatSortRef.current?.contains(t)) return;
      setChatSortOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChatSortOpen(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatSortOpen]);

  const [chatMenu, setChatMenu] = useState<{
    x: number;
    y: number;
    chatId: string;
    memberChatIds: string[];
  } | null>(null);
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const lastAutoSyncViewRef = useRef<string>("");
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(
    null
  );
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const folderNameInputRef = useRef<HTMLInputElement | null>(null);
  const [folderImportText, setFolderImportText] = useState("");
  const [groupFolderDialog, setGroupFolderDialog] = useState<{
    folderId: string;
    mode: "links" | "existing";
  } | null>(null);
  const [pendingFolderAction, setPendingFolderAction] =
    useState<PendingFolderAction | null>(null);

  useEffect(() => {
    if (!chatMenu) return;
    // 延迟绑定：避免打开菜单的同一帧 pointer/click 立刻把菜单关闭
    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const close = () => setChatMenu(null);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setChatMenu(null);
      };
      // 用 pointerdown 捕获，且忽略菜单内部
      const onPointer = (e: Event) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("[data-chat-context-menu]")) return;
        close();
      };
      window.addEventListener("pointerdown", onPointer, true);
      window.addEventListener("keydown", onKey);
      remove = () => {
        window.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("keydown", onKey);
      };
    }, 0);
    return () => {
      window.clearTimeout(timer);
      remove?.();
    };
  }, [chatMenu]);

  useEffect(() => {
    if (!leadDateMenu) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-lead-date-menu]")) return;
      setLeadDateMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLeadDateMenu(null);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [leadDateMenu]);

  const toggleLeadDate = useCallback((groupId: string) => {
    setCollapsedLeadDateIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const dismissLeadChats = useCallback(
    (chatIds: string[]) => {
      const current = useAppStore.getState().settings.leadInbox;
      const dismissed = new Set(current.dismissedChatIds);
      chatIds.forEach((chatId) => dismissed.add(chatId));
      updateSettings({
        leadInbox: {
          ...current,
          dismissedChatIds: [...dismissed].slice(-20_000),
        },
      });
    },
    [updateSettings]
  );

  const markChatRead = async (chat: ChatPreview, contact?: Contact | null) => {    useAppStore.setState((s) => {
      const hold = { ...s.unreadHoldUntilByChatId };
      delete hold[chat.id];
      return { unreadHoldUntilByChatId: hold };
    });
    const currentChat = useAppStore.getState().chats.find(
      (c) => c.id === chat.id
    );
    if (currentChat?.unread) patchChat(chat.id, { unread: 0 });
    const target = chatTarget(contact, chat);
    if (!isBaileys || !accountIsConnected(target.accountId)) return;
    try {
      const keys = inboundKeysForChat(chat.id);
      if (keys.length) {
        await baileysMessagesRead(
          keys,
          contact?.accountId || chat.accountId
        );
      }
      await baileysChatModify("markRead", target);
    } catch (e) {
      // 本地已清未读；远端失败不打断
      console.warn("markRead", e);
    }
  };

  /** 一键已读所有群聊：立即本地清未读，远端逐条小间隔已读 */
  const markAllGroupsRead = async () => {
    const st = useAppStore.getState();
    const groupChats = st.chats.filter(
      (chat) => chat.isGroup && (chat.unread || 0) > 0
    );
    if (!groupChats.length) {
      pushToast(t("runtime.noUnreadGroups"), "info");
      return;
    }
    for (const chat of groupChats) {
      useAppStore.getState().patchChat(chat.id, { unread: 0 });
    }
    pushToast(t("runtime.readGroups", { count: groupChats.length }), "success");
    // 远端已读：逐条小间隔，避免一次刷爆 bridge
    for (const chat of groupChats) {
      if (useAppStore.getState().settings.sendChannel === "android_bridge") {
        break;
      }
      const contact = useAppStore
        .getState()
        .contacts.find((c) => c.id === chat.contactId);
      await markChatReadRemote(chat, contact);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };

  const openContact = (contactId: string, preferredChatId?: string) => {
    const startedAt = isSyncDebugEnabled() ? performance.now() : 0;
    const trace = (msg: string, data: Record<string, unknown> = {}) => {
      if (!startedAt) return;
      const durationMs = Math.round(performance.now() - startedAt);
      syncLog(
        "ui.chat",
        msg,
        { contactId, preferredChatId, durationMs, ...data },
        durationMs >= 50 ? "warn" : "debug"
      );
    };
    trace("switch start", {
      fromChatId: useAppStore.getState().selectedChatId,
    });
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    // 优先打开指定会话（侧栏点会话行），避免同联系人跨号串到另一账号 chat
    if (preferredChatId) {
      const chat = useAppStore
        .getState()
        .chats.find((c) => c.id === preferredChatId);
      if (chat) {
        setSelectedChat(preferredChatId);
        void markChatRead(chat, contact);
        if (sendChannel === "baileys") {
          trace("state updated", { mode: "preferred-chat" });
          return;
        }
      }
    }
    openContactWorkspace(contactId);
    trace("state updated", { mode: "workspace" });
    // 打开即已读（本地 + Baileys）
    const owner =
      contact.accountId ||
      contact.boundPhoneId ||
      liveBaileysAccountId ||
      activeAccountId ||
      "";
    const chat = useAppStore.getState().chats.find(
      (c) =>
        c.contactId === contactId &&
        (c.accountId || c.phoneId || owner) === owner
    );
    if (chat) void markChatRead(chat, contact);
    if (sendChannel === "baileys") return;
    if (!contact.phone) return;
    void bridgeInvoke<{
      delivered?: boolean;
      note?: string;
      ack?: { payload?: { message?: string } };
    }>("open_whatsapp_chat", {
      deviceId: contact.boundPhoneId,
      phoneE164: contact.phone,
      displayName: contact.name,
    })
      .then((result) => {
        if (!result.delivered) {
          pushToast(
            result.ack?.payload?.message || result.note || t("runtime.phoneChatOpenFailed"),
            "error"
          );
        }
      })
      .catch((error) => pushToast(String(error), "error"));
  };

  const syncConversations = async () => {
    setSyncing(true);
    try {
      if (isBaileys) {
        // 同步「当前浏览」的号，而不是永远打默认 live / 某 accountId
        const viewAid =
          accountViewMode?.type === "account"
            ? accountViewMode.accountId
            : liveBaileysAccountId || activeAccountId || "";
        const syncAid =
          viewAid || liveBaileysAccountId || activeAccountId || "";
        const beforeC = useAppStore.getState().contacts.filter(
          (c) => (c.accountId || "") === syncAid
        ).length;
        const beforeH = useAppStore.getState().chats.filter(
          (c) => (c.accountId || c.phoneId || "") === syncAid
        ).length;
        syncLog("ui.sync", "manual sync click", {
          syncAid,
          viewMode: accountViewMode,
          liveBaileysAccountId,
          activeAccountId,
          slot: waAccounts.find((a) => a.id === syncAid),
          beforeContactsForAid: beforeC,
          beforeChatsForAid: beforeH,
          totalContacts: useAppStore.getState().contacts.length,
          totalChats: useAppStore.getState().chats.length,
        });
        if (!syncAid) {
          pushToast(t("runtime.addLoginAccount"), "error");
          return;
        }
        // 若 status 里 live+baileysUi 任一在线即可同步该号进程
        const slotOk =
          accountIsConnected(syncAid) ||
          waAccounts.find((a) => a.id === syncAid)?.status === "connected" ||
          waAccounts.find((a) => a.id === syncAid)?.status === "connecting";
        if (!slotOk) {
          syncLog(
            "ui.sync",
            "abort: slot not online",
            {
              syncAid,
              slot: waAccounts.find((a) => a.id === syncAid),
              baileysUi,
            },
            "warn"
          );
          pushToast(
            t("runtime.accountOffline"),
            "error"
          );
          setActiveNav("phones");
          return;
        }
        // 空结果时多试几次（第二号历史常晚到）
        let result = await baileysSync(syncAid, {
          hydrateGroups: true,
          requestHistory: true,
        });
        for (
          let attempt = 0;
          attempt < 3 &&
          (result.contacts?.length ?? 0) === 0 &&
          (result.messages?.length ?? 0) === 0;
          attempt++
        ) {
          syncLog(
            "ui.sync",
            `empty retry ${attempt + 1}/3`,
            {
              syncAid,
              note: (result as { note?: string }).note,
            },
            "warn"
          );
          pushToast(
            attempt === 0
              ? t("runtime.waitingHistory")
              : t("runtime.waitingRetry", { count: attempt + 1 }),
            "info"
          );
          await new Promise((r) => window.setTimeout(r, 8_000));
          result = await baileysSync(syncAid, { hydrateGroups: true });
        }
        // deviceId 必须是账号槽 id，入库才会挂到对应 accountId
        syncLog("ui.sync", "ingest start", {
          syncAid,
          nc: result.contacts?.length ?? 0,
          nm: result.messages?.length ?? 0,
          note: (result as { note?: string }).note,
        });
        ingestBridgeEvents([
          {
            type: "contacts.sync",
            deviceId: syncAid,
            payload: {
              items: result.contacts,
              source: "snapshot",
              accountId: syncAid,
            } as Record<string, unknown>,
          },
          {
            type: "messages.sync",
            deviceId: syncAid,
            payload: {
              items: result.messages,
              source: "snapshot",
              live: false,
              accountId: syncAid,
            } as Record<string, unknown>,
          },
        ] as Parameters<typeof ingestBridgeEvents>[0]);
        const st = useAppStore.getState();
        const afterC = st.contacts.filter(
          (c) => (c.accountId || "") === syncAid
        ).length;
        const afterH = st.chats.filter(
          (c) => (c.accountId || c.phoneId || "") === syncAid
        ).length;
        const nc = result.contacts?.length ?? 0;
        const nm = result.messages?.length ?? 0;
        const label =
          waAccounts.find((a) => a.id === syncAid)?.userName ||
          waAccounts.find((a) => a.id === syncAid)?.label ||
          "该账号";
        syncLog("ui.sync", "ingest done", {
          syncAid,
          label,
          bridgeContacts: nc,
          bridgeMessages: nm,
          storeContactsForAid: afterC,
          storeChatsForAid: afterH,
          deltaContacts: afterC - beforeC,
          deltaChats: afterH - beforeH,
          note: (result as { note?: string }).note,
        });
        if (nc === 0 && nm === 0) {
          pushToast(
            `「${label}」同步仍为空。请确认设备页该号为「在线」，等待 10~20 秒让历史灌入后再点同步；或在手机 WhatsApp 打开几条聊天。控制台过滤 [wap-sync] 可看详情。`,
            "info"
          );
        } else {
          // 同步后立刻用消息库校准会话 updatedAt/预览（避免仍按旧时间排序）
          try {
            const st2 = useAppStore.getState();
            const lastAt = new Map();
            const lastBody = new Map();
            for (const m of st2.messages) {
              if (
                (m.accountId || m.deviceId) &&
                (m.accountId || m.deviceId) !== syncAid
              )
                continue;
              if (m.mediaType === "system" || m.systemKind) continue;
              const prev = lastAt.get(m.chatId);
              if (!prev || m.sentAt >= prev) {
                lastAt.set(m.chatId, m.sentAt);
                lastBody.set(m.chatId, m.body || "");
              }
            }
            if (lastAt.size) {
              useAppStore.setState((s) => ({
                chats: s.chats.map((ch) => {
                  const at = lastAt.get(ch.id);
                  if (!at) return ch;
                  const body = lastBody.get(ch.id);
                  return {
                    ...ch,
                    updatedAt:
                      !ch.updatedAt || at > ch.updatedAt ? at : ch.updatedAt,
                    lastMessage:
                      body && !(ch.lastMessage || "").trim()
                        ? body
                        : ch.lastMessage,
                  };
                }),
              }));
            }
          } catch {
            /* ignore */
          }
          const historyStarted = result.historyRequest?.requested === true;
          pushToast(
            historyStarted
              ? `「${label}」已开始补齐完整历史，消息会继续在后台进入 · 当前 ${nm} 条`
              : `「${label}」同步完成 · ${nc} 联系人 / ${nm} 条消息（本号联系人 ${afterC} / 会话 ${afterH}）`,
            historyStarted ? "info" : "success"
          );
        }
        return;
      }
      const result = await bridgeInvoke<{
        ack?: { payload?: { items?: unknown[] } };
      }>("sync_whatsapp_conversations", {
        deviceId: selectedPhoneId ?? undefined,
      });
      const items = result.ack?.payload?.items;
      if (!Array.isArray(items) || items.length === 0)
        throw new Error(
          "手机 Bridge 版本过旧或未读取到会话，请覆盖安装最旧APK 后重新安装"
        );
      ingestBridgeEvents([
        {
          type: "contacts.sync",
          deviceId: selectedPhoneId ?? undefined,
          payload: { items: items as ContactSyncItem[] },
        },
      ]);
      pushToast(`WhatsApp 会话同步完成 · ${items?.length ?? 0} 个`, "success");
    } catch (error) {
      pushToast(String(error), "error");
    } finally {
      setSyncing(false);
    }
  };

  const query = filter.trim().toLowerCase();
  const {
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
    chatSortLabel,
    leadCount,
    primaryFolderIdOf,
    sidebarItems,
    chatListFilter,
    setChatListFilter,
    viewMode,
    viewAccountId,
    dataAccountId,
  } = useSidebarData({
    listTab,
    query,
    showArchived,
    chatSort,
    ungroupedCollapsed,
    groupFilter,
    collapsedLeadDateIds,
  });

  const moveLeadDateToFolder = useCallback(
    (chatIds: string[], folderId: string, folderName: string) => {
      chatIds.forEach((chatId) => moveChatToFolder(chatId, folderId));
      dismissLeadChats(chatIds);
      setLeadDateMenu(null);
      pushToast(
        t("leadInbox.movedDate", { count: chatIds.length, name: folderName }),
        "success"
      );
    },
    [dismissLeadChats, moveChatToFolder, pushToast, t]
  );

  const addJoinedGroupToFolder = useCallback(
    (folderId: string, groupJid: string, group: GroupDetails, accountId: string) => {
      const store = useAppStore.getState();
      store.ingestBridgeEvents([
        {
          type: "contacts.sync",
          deviceId: accountId,
          accountId,
          payload: {
            accountId,
            source: "group-invite-accept",
            items: [
              {
                jid: groupJid,
                channelAddress: groupJid,
                isGroup: true,
                displayName: group.subject || groupJid,
                subject: group.subject || "",
                participantCount: group.participantCount,
                groupDesc: group.desc,
                groupOwner: group.owner,
                groupAnnounce: group.announce,
                groupRestrict: group.restrict,
                groupEphemeral: group.ephemeralDuration,
                groupJoinApproval: group.joinApprovalMode,
              },
            ],
          },
        },
      ] as unknown as Parameters<typeof store.ingestBridgeEvents>[0]);
      const contactId = useAppStore
        .getState()
        .contacts.find(
          (contact) =>
            contact.channelAddress === groupJid &&
            (contact.accountId || contact.boundPhoneId) === accountId
        )?.id;
      if (!contactId) throw new Error(t("folderGroups.joinedSyncFailed"));
      const chatId = useAppStore.getState().ensureChatForContact(contactId, accountId);
      if (!chatId) throw new Error(t("folderGroups.joinedSyncFailed"));
      useAppStore.getState().patchChat(chatId, { isGroup: true });
      useAppStore.getState().moveChatToFolder(chatId, folderId);
    },
    [t]
  );

  const {
    dragChatId,
    dropTarget,
    dragFolderId,
    folderDropTarget,
    folderRowRefs,
    startChatPointerDrag,
    startFolderPointerDrag,
  } = useChatFolderDrag({ chatFolders, primaryFolderIdOf });

  // StatsBar「今日活跃 / 待回复」跳转时强制回到会话列表
  useEffect(() => {
    if (
      chatListFilter === "unread" ||
      chatListFilter === "today" ||
      chatListFilter === "leads"
    ) {
      setListTab("chats");
      setShowArchived(false);
    }
  }, [chatListFilter]);

  // 切到某号且该号在线：列表仍空或联系人很少时自动同步（第二号历史常晚到）
  useEffect(() => {
    // 启动闪屏 / 输入未就绪时不要自动同步，避免进房瞬间卡顿
    if (!useAppStore.getState().uiReady) return;
    if (!isBaileys || syncing) return;
    if (viewMode.type !== "account" || !viewAccountId) return;
    if (!accountIsConnected(viewAccountId)) return;
    // 会话 0 就同步；即使只有 1 个联系人也可再拉（消息进了才有会话列表）
    if (filteredChats.length + hiddenGroupCount > 5) return;
    const key = `${viewAccountId}:chats=${filteredChats.length}:c=${filteredContacts.length}`;
    if (lastAutoSyncViewRef.current === key) return;
    lastAutoSyncViewRef.current = key;
    // 进房后再晚一点同步，避开用户前几秒操作
    const t = window.setTimeout(() => {
      if (!useAppStore.getState().uiReady) return;
      void syncConversations();
    }, 4500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isBaileys,
    viewMode.type,
    viewAccountId,
    filteredChats.length,
    hiddenGroupCount,
    filteredContacts.length,
    waAccounts,
    liveBaileysAccountId,
    baileysUi.connection,
  ]);

  const openChatMenu = (
    e: ReactMouseEvent | ReactPointerEvent,
    chatId: string,
    memberChatIds?: string[]
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const w = 200;
    const h = 320;
    const cx = "clientX" in e ? e.clientX : (e as ReactMouseEvent).clientX;
    const cy = "clientY" in e ? e.clientY : (e as ReactMouseEvent).clientY;
    setChatMenu({
      x: Math.max(pad, Math.min(cx, window.innerWidth - w - pad)),
      y: Math.max(pad, Math.min(cy, window.innerHeight - h - pad)),
      chatId,
      memberChatIds: memberChatIds?.length ? memberChatIds : [chatId],
    });
  };

  const performDeleteChat = async (chat: ChatPreview) => {
    const contact = contacts.find((c) => c.id === chat.contactId);
    const target = chatTarget(contact, chat);
    let remoteOk = true;
    let remoteErr = "";
    try {
      if (isBaileys && accountIsConnected(target.accountId)) {
        try {
          await baileysChatModify("delete", target);
        } catch (e) {
          remoteOk = false;
          remoteErr = e instanceof Error ? e.message : "同步失败";
        }
      } else if (isBaileys) {
        remoteOk = false;
        remoteErr = "未连接";
      }
      moveChatToFolder(chat.id, null);
      for (const c of chatFolderClones.filter(
        (x) => x.sourceChatId === chat.id
      )) {
        removeChatFolderClone(c.id);
      }
      deleteChatLocal(chat.id, { clearMessages: true });
      if (selectedChatId === chat.id) {
        setSelectedChat(null);
      }
      pushToast(
        remoteOk ? "已删除会话" : `本地已删除（手机侧失败：${remoteErr}）`,
        "info"
      );
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "删除失败", "error");
    }
  };

  const runChatAction = async (
    chat: ChatPreview,
    action: ChatMenuAction,
    folderId?: string | null,
    extra?: ChatMenuActionExtra,
    memberChatIds?: string[]
  ) => {
    const contact = contacts.find((c) => c.id === chat.contactId);
    const target = chatTarget(contact, chat);
    const targetChatIds = memberChatIds?.length ? memberChatIds : [chat.id];
    setChatMenu(null);

    try {
      if (action === "moveToFolder") {
        if (!folderId) return;
        targetChatIds.forEach((chatId) => moveChatToFolder(chatId, folderId));
        const name =
          chatFolders.find((f) => f.id === folderId)?.name || "分组";
        pushToast(`已移到「${name}」`, "success");
        return;
      }
      if (action === "removeFromFolder") {
        targetChatIds.forEach((chatId) => moveChatToFolder(chatId, null));
        pushToast("已移出分组", "info");
        return;
      }
      if (action === "cloneToFolder") {
        if (!folderId) return;
        targetChatIds.forEach((chatId) => cloneChatToFolder(chatId, folderId));
        return;
      }
      if (action === "removeCloneFromFolder") {
        if (!folderId) return;
        const hits = chatFolderClones.filter(
          (c) => c.folderId === folderId && targetChatIds.includes(c.sourceChatId)
        );
        if (hits.length) {
          hits.forEach((hit) => removeChatFolderClone(hit.id));
          const name =
            chatFolders.find((f) => f.id === folderId)?.name || "分组";
          pushToast(`已取消「${name}」中的分身`, "info");
        }
        return;
      }
      if (action === "createFolderAndMove" || action === "createFolderAndClone") {
        setFolderNameDraft("");
        setPendingFolderAction({
          chatId: chat.id,
          chatIds: targetChatIds,
          mode: action === "createFolderAndMove" ? "move" : "clone",
        });
        setFolderDialog({ type: "create" });
        return;
      }
      if (action === "markRead") {
        await markChatRead(chat, contact);
        pushToast("已标为已读", "success");
        return;
      }
      if (action === "markUnread") {
        let remoteOk = true;
        if (isBaileys && accountIsConnected(target.accountId)) {
          try {
            await baileysChatModify("markUnread", target);
          } catch {
            remoteOk = false;
          }
        } else if (isBaileys) {
          remoteOk = false;
        }
        markChatUnreadLocal(chat.id, 1);
        pushToast(
          remoteOk ? "已标为未读" : "本地已标未读（远端未同步）",
          remoteOk ? "success" : "info"
        );
        return;
      }
      if (action === "clear") {
        const ok = await requestConfirm({
          title: t("sidebar.clearChatTitle"),
          description: t("sidebar.clearChatDescription"),
          confirmLabel: t("sidebar.clearChat"),
          cancelLabel: t("common.cancel"),
          tone: "danger",
        });
        if (!ok) return;
        let remoteOk = true;
        let remoteErr = "";
        if (isBaileys && accountIsConnected(target.accountId)) {
          try {
            await baileysChatModify("clear", target);
          } catch (e) {
            remoteOk = false;
            remoteErr = e instanceof Error ? e.message : "同步失败";
          }
        } else if (isBaileys) {
          remoteOk = false;
          remoteErr = "未连接";
        }
        clearChatMessages(chat.id);
        pushToast(
          remoteOk ? "已清空聊天" : `本地已清空（手机侧失败：${remoteErr}）`,
          "info"
        );
        return;
      }
      if (action === "block") {
        if (!contact || contact.isGroup) {
          pushToast("仅支持私聊拉黑", "info");
          return;
        }
        const peer = contact.channelAddress || contact.phone || "";
        if (!peer) {
          pushToast("无法拉黑：缺少号码或地址", "error");
          return;
        }
        const aid =
          contact.accountId ||
          chat.accountId ||
          liveBaileysAccountId ||
          activeAccountId ||
          "wa-default";
        if (!isBaileys || !accountIsConnected(aid)) {
          pushToast("请先连接 WhatsApp 后再拉黑", "error");
          return;
        }
        const list = getAccountBlocklist(
          blocklistByAccountId,
          aid,
          blocklistJids
        );
        const isBlocked = isJidBlocked(list, peer);
        const blockAction = isBlocked ? "unblock" : "block";
        if (blockAction === "block") {
          const ok = await requestConfirm({
            title: t("sidebar.blockContactTitle"),
            description: t("sidebar.blockContactDescription", {
              name: contact.name || peer,
            }),
            confirmLabel: t("sidebar.blockContact"),
            cancelLabel: t("common.cancel"),
            tone: "danger",
          });
          if (!ok) return;
        }
        const res = await baileysBlocklistSet(peer, blockAction, aid);
        if (!res.ok) {
          pushToast(res.error || "操作失败", "error");
          return;
        }
        if (res.jids) {
          updateSettings({
            blocklistByAccountId: setAccountBlocklist(
              blocklistByAccountId,
              aid,
              res.jids
            ),
            blocklistJids: res.jids,
          });
        }
        pushToast(
          blockAction === "block" ? "已拉黑" : "已解除拉黑",
          "success"
        );
        return;
      }
      if (action === "delete") {
        const ok = await requestConfirm({
          title: t("sidebar.deleteChatTitle"),
          description: t("sidebar.deleteChatDescription", {
            name: chat.contactName || t("sidebar.thisContact"),
          }),
          confirmLabel: t("sidebar.confirmDelete"),
          cancelLabel: t("common.cancel"),
          tone: "danger",
        });
        if (!ok) return;
        await performDeleteChat(chat);
        return;
      }
      if (action === "archive" || action === "unarchive") {
        let remoteOk = true;
        let remoteErr = "";
        if (isBaileys && accountIsConnected(target.accountId)) {
          try {
            await baileysChatModify(action, target);
          } catch (e) {
            remoteOk = false;
            remoteErr = e instanceof Error ? e.message : "同步失败";
          }
        } else if (isBaileys) {
          remoteOk = false;
          remoteErr = "未连接";
        }
        patchChat(chat.id, { archived: action === "archive" });
        pushToast(
          remoteOk
            ? action === "archive"
              ? "已归档"
              : "已取消归档"
            : `本地已${action === "archive" ? "归档" : "取消归档"}（${remoteErr}）`,
          remoteOk ? "success" : "info"
        );
        return;
      }
      if (action === "pin" || action === "unpin") {
        await applyChatPreference({
          action,
          chat,
          target,
          isBaileys,
          connected: accountIsConnected(target.accountId),
          patchChat,
          pushToast,
        });
        return;
      }
      if (action === "mute") {
        const durationMs =
          typeof extra?.durationMs === "number"
            ? extra.durationMs
            : 8 * 60 * 60 * 1000;
        await applyChatPreference({
          action,
          chat,
          target,
          isBaileys,
          connected: accountIsConnected(target.accountId),
          durationMs,
          patchChat,
          pushToast,
        });
        return;
      }
      if (action === "unmute") {
        await applyChatPreference({
          action,
          chat,
          target,
          isBaileys,
          connected: accountIsConnected(target.accountId),
          patchChat,
          pushToast,
        });
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "操作失败", "error");
    }
  };

  const openChatMenuRef = useRef(openChatMenu);
  openChatMenuRef.current = openChatMenu;
  const onOpenMenuRow = useCallback(
    (
      e: ReactMouseEvent | ReactPointerEvent,
      chatId: string,
      memberChatIds?: string[]
    ) => {
      openChatMenuRef.current(e, chatId, memberChatIds);
    },
    []
  );
  const openContactRef = useRef(openContact);
  openContactRef.current = openContact;
  const onOpenContactStable = useCallback(
    (contactId: string, chatId: string) => {
      openContactRef.current(contactId, chatId);
    },
    []
  );
  const onOpenContactListStable = useCallback((contactId: string) => {
    openContactRef.current(contactId);
  }, []);
  const onDragStartStable = useCallback(
    (e: ReactPointerEvent, chatId: string, memberChatIds?: string[]) => {
      startChatPointerDrag(e, chatId, memberChatIds);
    },
    []
  );

  const renderChatRow = (
    chat: ChatPreview,
    opts?: {
      cloneId?: string;
      accountCount?: number;
      memberChatIds?: string[];
    }
  ) => {
    const c = contactById.get(chat.contactId);
    const preview = lastBodyByChat.get(chat.id) || chat.lastMessage || "";
    const chatAccountId = chat.accountId || c?.accountId || dataAccountId;
    return (
      <ChatSidebarRow
        key={opts?.cloneId ? `clone-${opts.cloneId}` : chat.id}
        chat={chat}
        contact={c}
        preview={preview}
        lastMessageAt={lastMsgAtByChat.get(chat.id) || chat.updatedAt}
        lastMessageDirection={lastDirByChat.get(chat.id)}
        lastDeliveryStatus={lastDeliveryStatusByChat.get(chat.id)}
        active={
          selectedChatId === chat.id ||
          !!opts?.memberChatIds?.includes(selectedChatId || "")
        }
        isBaileys={isBaileys}
        showAccountBadge={isAllAccountsView}
        accountShort={accountShortOf(chatAccountId)}
        accountLabel={accountLabelOf(chatAccountId)}
        accountCount={opts?.accountCount}
        memberChatIds={opts?.memberChatIds}
        cloneId={opts?.cloneId}
        isDragging={dragChatId === chat.id}
        dragDisabled={(opts?.accountCount || 0) > 1}
        onOpen={onOpenContactStable}
        onOpenMenu={onOpenMenuRow}
        onDragStart={onDragStartStable}
      />
    );
  };

  return (
    <aside className="crm-sidebar flex w-64 shrink-0 flex-col border-r border-zinc-800/90 bg-zinc-950">
      {!isBaileys && (
        <PhoneListSection
          phones={phones}
          selectedPhoneId={selectedPhoneId}
          onSelect={setSelectedPhone}
        />
      )}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5">
        <SidebarListHeader
          listTab={listTab}
          onTabChange={selectListTab}
          chatsCount={filteredChats.length + hiddenGroupCount}
          contactsCount={filteredContacts.length}
          filteredCount={filteredChats.length}
          groupFilter={groupFilter}
          onToggleHideGroups={() =>
            changeGroupFilter(groupFilter === "all" ? "hidden" : "all")
          }
          onGroupFilterChange={changeGroupFilter}
          getGroupFilterCounts={getGroupFilterCounts}
          onMarkAllGroupsRead={() => void markAllGroupsRead()}
          savedActive={selectedChatId === SAVED_MESSAGES_CHAT_ID}
          onOpenSaved={openSavedMessages}
          filter={filter}
          onFilterChange={setFilter}
          isBaileys={isBaileys}
          onCreateGroup={() => setCreateGroupOpen(true)}
          onBatchSaveContacts={() => setBatchSaveOpen(true)}
          leadCount={leadCount}
          leadActive={chatListFilter === "leads"}
          leadEnabled={leadInbox.enabled}
          onOpenLeads={() => {
            if (!leadInbox.enabled) {
              setLeadSettingsOpen(true);
              return;
            }
            setListTab("chats");
            setShowArchived(false);
            setChatListFilter("leads");
          }}
          onOpenLeadSettings={() => setLeadSettingsOpen((open) => !open)}
          listFilter={chatListFilter}
          onClearFilter={() => setChatListFilter("all")}
          sortOpen={chatSortOpen}
          onToggleSort={() => setChatSortOpen((v) => !v)}
          sortRef={chatSortRef}
          sortLabel={chatSortLabel}
          sortMode={chatSort}
          onSortChange={(mode) => {
            setChatSort(mode);
            setChatSortOpen(false);
            try {
              localStorage.setItem("wap.chatSort", mode);
            } catch {
              /* ignore */
            }
          }}
          syncing={syncing}
          syncDisabled={
            syncing ||
            (isBaileys
              ? !syncAccountConnected
              : !selectedPhoneId)
          }
          syncTitle={
            isBaileys && !syncAccountConnected
              ? "当前浏览账号未连接"
              : historySyncNote
                ? `从 WhatsApp 同步会话 · ${historySyncNote}`
                : "从 WhatsApp 同步会话"
          }
          onSync={() => void syncConversations()}
        />
        {leadSettingsOpen && (
          <LeadInboxSettingsPopover onClose={() => setLeadSettingsOpen(false)} />
        )}
        {visitedListTabs.has("contacts") && (
          <div
            className="min-h-0 flex-1"
            hidden={listTab !== "contacts"}
            aria-hidden={listTab !== "contacts"}
            onContextMenu={(e) => e.preventDefault()}
          >
            <ContactSidebarList
              contacts={filteredContacts}
              chatByContactId={chatByContactId}
              selectedContactId={selectedContactId}
              query={query}
              onOpenContact={onOpenContactListStable}
            />
          </div>
        )}
        {visitedListTabs.has("chats") && (
          <div
            className="min-h-0 flex-1"
            hidden={listTab !== "chats"}
            aria-hidden={listTab !== "chats"}
            onContextMenu={(e) => {
              // 会话行会自行 preventDefault + 自有菜单；空白/分组头等禁浏览器菜单
              e.preventDefault();
            }}
          >
            <Virtuoso
              className="sidebar-chat-scroll h-full"
              data={sidebarItems}
              computeItemKey={(_i, it) => it.id}
              defaultItemHeight={44}
              increaseViewportBy={{ top: 120, bottom: 120 }}
              components={SIDEBAR_VIRTUOSO_COMPONENTS}
              scrollSeekConfiguration={SIDEBAR_SCROLL_SEEK}
              itemContent={(_index, it) => {
                if (
                  it.kind === "hint" ||
                  it.kind === "archive_toggle" ||
                  it.kind === "new_folder" ||
                  it.kind === "folder_empty" ||
                  it.kind === "lead_date_header" ||
                  it.kind === "ungrouped_header" ||
                  it.kind === "empty"
                ) {
                  return (
                    <SidebarSpecialItem
                      item={
                        it.kind === "hint"
                          ? it
                          : it.kind === "archive_toggle"
                            ? { ...it, showArchived, archivedCount }
                            : it.kind === "new_folder"
                              ? { ...it, isAllAccountsView }
                              : it.kind === "folder_empty"
                              ? { ...it, dragging: Boolean(dragChatId) }
                              : it.kind === "lead_date_header"
                                ? it
                              : it.kind === "ungrouped_header"
                                  ? {
                                      ...it,
                                      collapsed: ungroupedCollapsed,
                                      isAllAccountsView,
                                      dropActive: dropTarget === "__ungrouped",
                                    }
                                  : {
                                      ...it,
                                      query,
                                      contactsCount: contacts.length,
                                      syncing,
                                    }
                      }
                      onToggleArchived={() => setShowArchived((v) => !v)}
                      onRegisterUngroupedRef={(element) => {
                        folderRowRefs.current.set("__ungrouped", element);
                      }}
                      onCreateFolder={() => {
                        setFolderNameDraft("");
                        setPendingFolderAction(null);
                        setFolderDialog({ type: "create" });
                      }}
                      onToggleUngrouped={() => setUngroupedCollapsed((v) => !v)}
                      onToggleLeadDate={toggleLeadDate}
                      onOpenLeadDateMenu={(event) => {
                        const width = 240;
                        const height = 360;
                        setLeadDateMenu({
                          x: Math.max(
                            8,
                            Math.min(event.clientX, window.innerWidth - width - 8)
                          ),
                          y: Math.max(
                            8,
                            Math.min(event.clientY, window.innerHeight - height - 8)
                          ),
                          groupId: it.kind === "lead_date_header" ? it.groupId : "",
                          label: it.kind === "lead_date_header" ? it.label : "",
                          chatIds:
                            it.kind === "lead_date_header" ? it.chatIds : [],
                        });
                      }}
                      onSync={() => void syncConversations()}
                    />
                  );
                }
                if (it.kind === "folder_header") {
                  const folder = chatFolders.find((f) => f.id === it.folderId);
                  if (!folder) return <div />;
                  return (
                    <FolderHeaderRow
                      name={it.name}
                      collapsed={it.collapsed}
                      depth={it.depth}
                      total={it.total}
                      unread={it.unread}
                      dropActive={dropTarget === folder.id}
                      folderDropActive={folderDropTarget === folder.id}
                      dragging={dragFolderId === folder.id}
                      onRegisterRef={(element) => {
                        folderRowRefs.current.set(folder.id, element);
                      }}
                      onToggle={() => toggleChatFolderCollapsed(folder.id)}
                      onStartDrag={(event) =>
                        startFolderPointerDrag(event, folder.id)
                      }
                      onCreateChild={() => {
                        setFolderNameDraft("");
                        setPendingFolderAction(null);
                        setFolderDialog({
                          type: "create",
                          parentId: folder.id,
                        });
                      }}
                      onOpenMultiWindow={() => openFolderMultiWindow(folder.id)}
                      onImport={() => {
                        setFolderImportText("");
                        setFolderDialog({
                          type: "import",
                          folderId: folder.id,
                          text: "",
                        });
                      }}
                      onImportGroupLinks={() =>
                        setGroupFolderDialog({ folderId: folder.id, mode: "links" })
                      }
                      onSelectGroups={() =>
                        setGroupFolderDialog({ folderId: folder.id, mode: "existing" })
                      }
                      onRename={() => {
                        setFolderNameDraft(folder.name);
                        setFolderDialog({
                          type: "rename",
                          folderId: folder.id,
                          name: folder.name,
                        });
                      }}
                      onClear={() => {
                        setFolderDialog({
                          type: "clear",
                          folderId: folder.id,
                          name: folder.name,
                        });
                      }}
                      onDelete={() => {
                        setFolderDialog({
                          type: "delete",
                          folderId: folder.id,
                          name: folder.name,
                        });
                      }}
                    />
                  );
                }
                const inFolder = typeof it.folderId === "string";
                return (
                  <div
                    className={cn(
                      "pl-1 pr-0",
                      inFolder && it.folderDepth === 1 && "ml-3"
                    )}
                  >
                    {renderChatRow(it.chat, {
                      cloneId: it.cloneId,
                      accountCount: it.accountCount,
                      memberChatIds: it.memberChatIds,
                    })}
                  </div>
                );
              }}
            />
          </div>
        )}
      </section>

      {groupFolderDialog && (() => {
        const folder = chatFolders.find((item) => item.id === groupFolderDialog.folderId);
        if (!folder) return null;
        const scopedAccountId =
          folder.scope?.type === "account"
            ? folder.scope.accountId
            : folder.scope?.type === "all"
              ? null
              : dataAccountId;
        const folderMembers = new Set(folder.chatIds);
        const folderGroups = chats.filter((chat) => {
          const accountId = chat.accountId || chat.phoneId;
          return (
            chat.isGroup === true &&
            !chat.localOnly &&
            !folderMembers.has(chat.id) &&
            (!scopedAccountId || accountId === scopedAccountId)
          );
        });
        const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
        const existingGroupChatIds: Record<string, string> = {};
        for (const chat of chats) {
          if (chat.isGroup !== true) continue;
          const contact = contactsById.get(chat.contactId);
          const jid = contact?.channelAddress;
          if (!jid) continue;
          const accountId = chat.accountId || chat.phoneId;
          existingGroupChatIds[`${accountId}|${jid}`] = chat.id;
        }
        const initialAccountId =
          scopedAccountId ||
          (connectedAccountIds.includes(syncAccountId)
            ? syncAccountId
            : connectedAccountIds[0] || "");
        return (
          <FolderGroupImportDialog
            mode={groupFolderDialog.mode}
            folderName={folder.name}
            groups={folderGroups}
            accounts={waAccounts}
            connectedAccountIds={connectedAccountIds}
            existingGroupChatIds={existingGroupChatIds}
            accountLabelOf={accountLabelOf}
            initialAccountId={initialAccountId}
            fixedAccountId={scopedAccountId || undefined}
            onClose={() => setGroupFolderDialog(null)}
            onMoveGroups={(chatIds) => {
              chatIds.forEach((chatId) => moveChatToFolder(chatId, folder.id));
              pushToast(
                t("folderGroups.moved", { count: chatIds.length, name: folder.name }),
                "success"
              );
              setGroupFolderDialog(null);
            }}
            onJoined={(groupJid, group, accountId) =>
              addJoinedGroupToFolder(folder.id, groupJid, group, accountId)
            }
            onAlreadyJoined={(chatId) => moveChatToFolder(chatId, folder.id)}
          />
        );
      })()}

      {folderDialog && (
        <FolderDialog
          dialog={folderDialog}
          pendingAction={pendingFolderAction}
          nameDraft={folderNameDraft}
          importText={folderImportText}
          importFolderName={
            folderDialog.type === "import"
              ? chatFolders.find(
                  (folder) => folder.id === folderDialog.folderId
                )?.name
              : undefined
          }
          nameInputRef={folderNameInputRef}
          onNameDraftChange={setFolderNameDraft}
          onImportTextChange={setFolderImportText}
          onClose={() => {
            setFolderDialog(null);
            setPendingFolderAction(null);
          }}
          onSubmitName={(name) => {
            if (folderDialog.type === "create") {
              const id = createChatFolder(name, folderDialog.parentId);
              if (id && pendingFolderAction) {
                const targetChatIds = pendingFolderAction.chatIds?.length
                  ? pendingFolderAction.chatIds
                  : [pendingFolderAction.chatId];
                if (pendingFolderAction.mode === "move") {
                  if (pendingFolderAction.dismissFromLead && isAllAccountsView) {
                    const currentSettings = useAppStore.getState().settings;
                    updateSettings({
                      chatFolders: currentSettings.chatFolders.map((folder) =>
                        folder.id === id
                          ? { ...folder, scope: { type: "all" as const } }
                          : folder
                      ),
                    });
                  }
                  targetChatIds.forEach((chatId) => moveChatToFolder(chatId, id));
                  if (pendingFolderAction.dismissFromLead) {
                    dismissLeadChats(targetChatIds);
                  }
                  pushToast(
                    pendingFolderAction.dismissFromLead
                      ? t("leadInbox.movedDate", {
                          count: targetChatIds.length,
                          name,
                        })
                      : `已移到「${name}」`,
                    "success"
                  );
                } else {
                  targetChatIds.forEach((chatId) => cloneChatToFolder(chatId, id));
                }
                setPendingFolderAction(null);
              }
            } else if (folderDialog.type === "rename") {
              renameChatFolder(folderDialog.folderId, name);
            }
            setFolderDialog(null);
          }}
          onSubmitImport={() => {
            if (folderDialog.type !== "import") return;
            importPhonesToFolder(folderDialog.folderId, folderImportText);
            setFolderImportText("");
            setFolderDialog(null);
          }}
          onConfirmClear={() => {
            if (folderDialog.type !== "clear") return;
            clearChatFolder(folderDialog.folderId);
            setFolderDialog(null);
          }}
          onConfirmDelete={() => {
            if (folderDialog.type !== "delete") return;
            deleteChatFolder(folderDialog.folderId);
            setFolderDialog(null);
          }}
        />
      )}

      {leadDateMenu && (
        <div
          data-lead-date-menu
          className="fixed z-[10020] w-60 overflow-hidden rounded-xl border border-zinc-700/90 bg-zinc-900 p-1.5 shadow-2xl shadow-black/50"
          style={{ left: leadDateMenu.x, top: leadDateMenu.y }}
        >
          <div className="border-b border-zinc-800 px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-zinc-200">
              {leadDateMenu.label}
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              {t("leadInbox.dateConversationCount", {
                count: leadDateMenu.chatIds.length,
              })}
            </p>
          </div>
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
            onClick={() => {
              setFolderNameDraft("");
              setPendingFolderAction({
                chatId: leadDateMenu.chatIds[0] || "",
                chatIds: leadDateMenu.chatIds,
                mode: "move",
                dismissFromLead: true,
              });
              setFolderDialog({ type: "create" });
              setLeadDateMenu(null);
            }}
          >
            <FolderPlus className="h-3.5 w-3.5 text-zinc-500" />
            {t("leadInbox.moveDateToNewFolder")}
          </button>
          {chatFolders.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
                {t("leadInbox.moveDateToFolder")}
              </p>
              <div className="max-h-44 overflow-y-auto">
                {chatFolders
                  .filter((folder) => {
                    const accountIds = new Set(
                      leadDateMenu.chatIds
                        .map((chatId) => {
                          const chat = chats.find((item) => item.id === chatId);
                          const contact = chat
                            ? contacts.find((item) => item.id === chat.contactId)
                            : undefined;
                          return (
                            chat?.accountId ||
                            contact?.accountId ||
                            chat?.phoneId ||
                            dataAccountId
                          );
                        })
                        .filter(Boolean)
                    );
                    if (accountIds.size > 1) return folder.scope?.type === "all";
                    if (folder.scope?.type === "all") return true;
                    const onlyAccount = [...accountIds][0] || dataAccountId;
                    return !folder.scope || folder.scope.accountId === onlyAccount;
                  })
                  .map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
                    onClick={() =>
                      moveLeadDateToFolder(
                        leadDateMenu.chatIds,
                        folder.id,
                        folderDisplayName(folder)
                      )
                    }
                  >
                    <FolderInput className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <span className="truncate">{folderDisplayName(folder)}</span>
                  </button>
                  ))}
              </div>
            </>
          )}
          <div className="mt-1 border-t border-zinc-800 pt-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-amber-300 hover:bg-amber-500/10"
              onClick={() => {
                dismissLeadChats(leadDateMenu.chatIds);
                pushToast(
                  t("leadInbox.removedDate", {
                    count: leadDateMenu.chatIds.length,
                  }),
                  "info"
                );
                setLeadDateMenu(null);
              }}
            >
              <EyeOff className="h-3.5 w-3.5" />
              {t("leadInbox.removeDate")}
            </button>
          </div>
        </div>
      )}

      {chatMenu &&
        (() => {
          const chat = chats.find((c) => c.id === chatMenu.chatId);
          if (!chat) return null;
          const primaryFolderId =
            chatMenu.memberChatIds.map(primaryFolderIdOf).find(Boolean) || null;
          const contact = contacts.find((c) => c.id === chat.contactId);
          const aid =
            contact?.accountId ||
            chat.accountId ||
            liveBaileysAccountId ||
            activeAccountId ||
            "";
          const peer = contact?.channelAddress || contact?.phone || "";
          const showBlock = !!(contact && !contact.isGroup && !chat.isGroup);
          const blocked =
            showBlock &&
            isJidBlocked(
              getAccountBlocklist(blocklistByAccountId, aid, blocklistJids),
              peer
            );
          return (
            <ChatContextMenu
              x={chatMenu.x}
              y={chatMenu.y}
              chat={chat}
              folders={chatFolders}
              clones={chatFolderClones}
              chatIds={chatMenu.memberChatIds}
              primaryFolderId={primaryFolderId}
              showBlock={showBlock}
              blocked={blocked}
              onAction={(c, a, folderId, extra) =>
                void runChatAction(c, a, folderId, extra, chatMenu.memberChatIds)
              }
              onClose={() => setChatMenu(null)}
            />
          );
        })()}

      <BatchSaveContactsModal
        open={batchSaveOpen}
        onClose={() => setBatchSaveOpen(false)}
        accounts={waAccounts}
        accountId={syncAccountId}
        connectedAccountIds={connectedAccountIds}
        cloudAvailable={isBaileys}
      />

      <CreateGroupModal
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        accountId={
          accountViewMode?.type === "account"
            ? accountViewMode.accountId
            : liveBaileysAccountId || activeAccountId || undefined
        }
        onCreated={(group) => {
          const owner =
            accountViewMode?.type === "account"
              ? accountViewMode.accountId
              : liveBaileysAccountId || activeAccountId || "wa-default";
          const opened = openJoinedGroup({
            accountId: owner,
            groupJid: group.jid,
            group,
            source: "group-create",
            ingest: (events) =>
              ingestBridgeEvents(
                events as Parameters<typeof ingestBridgeEvents>[0]
              ),
            findContactId: (groupJid, accountId) =>
              useAppStore
                .getState()
                .contacts.find(
                  (contact) =>
                    contact.channelAddress === groupJid &&
                    (contact.accountId || contact.boundPhoneId) === accountId
                )?.id,
            openContact: openContactWorkspace,
          });
          if (!opened) void syncConversations();
        }}
      />
    </aside>
  );
}
