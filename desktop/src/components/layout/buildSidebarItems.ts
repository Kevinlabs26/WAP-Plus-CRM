import type { ChatFolder, ChatFolderClone } from "@/store/appStore";
import type { ChatPreview, Contact } from "@/types/crm";
import {
  collapseAllAccountFolderChats,
  type FolderDisplayChat,
} from "./folderChatDisplay";

export type SidebarVirtItem =
  | { kind: "hint"; id: string; text: string }
  | { kind: "archive_toggle"; id: string }
  | { kind: "new_folder"; id: string }
  | {
      kind: "folder_header";
      id: string;
      folderId: string;
      name: string;
      total: number;
      unread: number;
      containsSelected: boolean;
      collapsed: boolean;
      depth: number;
    }
  | {
      kind: "chat";
      id: string;
      chat: ChatPreview;
      cloneId?: string;
      folderId?: string | null;
      folderDepth?: number;
      accountCount?: number;
      memberChatIds?: string[];
    }
  | {
      kind: "folder_empty";
      id: string;
      folderId: string;
      folderDepth?: number;
    }
  | {
      kind: "lead_date_header";
      id: string;
      groupId: string;
      label: string;
      chatIds: string[];
      total: number;
      collapsed: boolean;
    }
  | {
      kind: "ungrouped_header";
      id: string;
      total: number;
      unread: number;
      containsSelected: boolean;
    }
  | { kind: "empty"; id: string };

type BuildSidebarItemsArgs = {
  listTab: "chats" | "contacts";
  archivedCount: number;
  showArchived: boolean;
  isAllAccountsView: boolean;
  filteredChats: ChatPreview[];
  chatFolders: ChatFolder[];
  chatFolderClones: ChatFolderClone[];
  contactById: ReadonlyMap<string, Contact>;
  ungroupedCollapsed: boolean;
  query: string;
  folderDisplayName: (folder: ChatFolder) => string;
  selectedChatId?: string | null;
  leadView?: boolean;
  leadMergeAccounts?: boolean;
  leadDateGroupByChatId?: ReadonlyMap<
    string,
    { id: string; label: string }
  >;
  collapsedLeadDateIds?: ReadonlySet<string>;
};

function chatHasContent(chat: ChatPreview): boolean {
  return Boolean((chat.lastMessage || "").trim() || (chat.unread || 0) > 0);
}

/** 文件夹内只把有实际聊天内容的会话提到前面，分别保持两组原有手动顺序。 */
function prioritizeFolderChats(chats: ChatPreview[]): ChatPreview[] {
  const withContent = chats.filter(chatHasContent);
  if (withContent.length === chats.length) return chats;
  return [...withContent, ...chats.filter((chat) => !chatHasContent(chat))];
}

function prioritizeFolderDisplayChats(
  chats: FolderDisplayChat[]
): FolderDisplayChat[] {
  const withContent = chats.filter((item) => chatHasContent(item.chat));
  if (withContent.length === chats.length) return chats;
  return [
    ...withContent,
    ...chats.filter((item) => !chatHasContent(item.chat)),
  ];
}

export function buildSidebarItems({
  listTab,
  archivedCount,
  showArchived,
  isAllAccountsView,
  filteredChats,
  chatFolders,
  chatFolderClones,
  contactById,
  ungroupedCollapsed,
  query,
  folderDisplayName,
  selectedChatId,
  leadView = false,
  leadMergeAccounts = true,
  leadDateGroupByChatId,
  collapsedLeadDateIds,
}: BuildSidebarItemsArgs): SidebarVirtItem[] {
  if (listTab === "contacts") return [];
  const items: SidebarVirtItem[] = [];
  const searchActive = Boolean(query.trim());

  if (leadView) {
    const displayChats =
      isAllAccountsView && leadMergeAccounts
        ? collapseAllAccountFolderChats(filteredChats, contactById)
        : filteredChats.map((chat) => ({
            chat,
            accountCount: 1,
            memberChatIds: [chat.id],
          }));
    const blocks: Array<{
      group?: { id: string; label: string };
      chats: typeof displayChats;
    }> = [];
    const blockByGroupId = new Map<string, (typeof blocks)[number]>();
    for (const displayChat of displayChats) {
      const group = leadDateGroupByChatId?.get(displayChat.chat.id);
      if (!group) {
        blocks.push({ chats: [displayChat] });
        continue;
      }
      let block = blockByGroupId.get(group.id);
      if (!block) {
        block = { group, chats: [] };
        blockByGroupId.set(group.id, block);
        blocks.push(block);
      }
      block.chats.push(displayChat);
    }

    for (const block of blocks) {
      if (!block.group) {
        const first = block.chats[0]!;
        items.push({
          kind: "chat",
          id: first.chat.id,
          chat: first.chat,
          accountCount: first.accountCount,
          memberChatIds: first.memberChatIds,
        });
        continue;
      }
      const group = block.group;
      const grouped = block.chats;
      const collapsed = collapsedLeadDateIds?.has(group.id) ?? false;
      const chatIds = [...new Set(grouped.flatMap((item) => item.memberChatIds))];
      items.push({
        kind: "lead_date_header",
        id: `lead-date-${group.id}`,
        groupId: group.id,
        label: group.label,
        chatIds,
        total: grouped.length,
        collapsed,
      });
      if (!collapsed) {
        for (const item of grouped) {
          items.push({
            kind: "chat",
            id: item.chat.id,
            chat: item.chat,
            accountCount: item.accountCount,
            memberChatIds: item.memberChatIds,
          });
        }
      }
    }
    if (!displayChats.length) items.push({ kind: "empty", id: "__empty" });
    return items;
  }
  if (archivedCount > 0 && !searchActive) {
    items.push({ kind: "archive_toggle", id: "__archive" });
  }
  if (!showArchived && !searchActive) {
    items.push({ kind: "new_folder", id: "__new_folder" });
  }

  if (showArchived) {
    for (const chat of filteredChats) {
      items.push({ kind: "chat", id: chat.id, chat });
    }
  } else {
    // O(1) 查找：避免每个文件夹都 filter 全列表
    const chatById = new Map(filteredChats.map((ch) => [ch.id, ch]));
    const primarySet = new Set<string>();
    for (const f of chatFolders) {
      for (const id of f.chatIds) primarySet.add(id);
    }
    const clonesByFolder = new Map<string, ChatFolderClone[]>();
    for (const cl of chatFolderClones) {
      const arr = clonesByFolder.get(cl.folderId);
      if (arr) arr.push(cl);
      else clonesByFolder.set(cl.folderId, [cl]);
    }
    const folderById = new Map(chatFolders.map((folder) => [folder.id, folder]));
    const childrenByParent = new Map<string, ChatFolder[]>();
    for (const folder of chatFolders) {
      if (!folder.parentId || !folderById.has(folder.parentId)) continue;
      const children = childrenByParent.get(folder.parentId) || [];
      children.push(folder);
      childrenByParent.set(folder.parentId, children);
    }
    for (const children of childrenByParent.values()) {
      children.sort((a, b) => (b.sort || 0) - (a.sort || 0));
    }
    const allAccountDisplayChats = isAllAccountsView
      ? collapseAllAccountFolderChats(filteredChats, contactById)
      : [];
    const allAccountDisplayByChatId = new Map<string, FolderDisplayChat>();
    for (const item of allAccountDisplayChats) {
      for (const chatId of item.memberChatIds) {
        allAccountDisplayByChatId.set(chatId, item);
      }
    }
    // 同一自然人在“全部账号”只保留一个主归属；分身仍可显式复制。
    const claimedAllAccountChats = new Set<FolderDisplayChat>();
    const allAccountFolderChats = new Map<string, FolderDisplayChat[]>();
    if (isAllAccountsView) {
      for (const folder of chatFolders) {
        const folderChats: FolderDisplayChat[] = [];
        for (const chatId of folder.chatIds) {
          const item = allAccountDisplayByChatId.get(chatId);
          if (!item || claimedAllAccountChats.has(item)) continue;
          claimedAllAccountChats.add(item);
          folderChats.push(item);
        }
        allAccountFolderChats.set(folder.id, folderChats);
      }
    }
    const displayChats = (folder: ChatFolder, chats: ChatPreview[]) => {
      if (isAllAccountsView) {
        return prioritizeFolderDisplayChats(
          allAccountFolderChats.get(folder.id) || []
        );
      }
      const ordered = prioritizeFolderChats(chats);
      return ordered.map((chat) => ({
        chat,
        accountCount: 1,
        memberChatIds: [chat.id],
      }));
    };
    type FolderStats = { total: number; unread: number; containsSelected: boolean };
    const ownFolderStats = new Map<string, FolderStats>();
    for (const folder of chatFolders) {
      const primaryChats = folder.chatIds
        .map((id) => chatById.get(id))
        .filter((chat): chat is ChatPreview => !!chat);
      const primaryDisplayChats = displayChats(folder, primaryChats);
      const cloneChats = (clonesByFolder.get(folder.id) || [])
        .map((cl) => chatById.get(cl.sourceChatId))
        .filter((chat): chat is ChatPreview => !!chat);
      ownFolderStats.set(folder.id, {
        containsSelected: primaryDisplayChats.some((item) => item.memberChatIds.includes(selectedChatId || "")) ||
          cloneChats.some((chat) => chat.id === selectedChatId),
        total: primaryDisplayChats.length + cloneChats.length,
        // 按显示的会话计数，同一会话有多条未读消息也只计一次。
        unread:
          primaryDisplayChats.filter((item) => (item.chat.unread || 0) > 0).length +
          cloneChats.filter((chat) => (chat.unread || 0) > 0).length,
      });
    }
    const folderStats = new Map<string, FolderStats>();
    const getFolderStats = (
      folderId: string,
      visiting = new Set<string>()
    ): FolderStats => {
      const cached = folderStats.get(folderId);
      if (cached) return cached;
      if (visiting.has(folderId)) return { total: 0, unread: 0, containsSelected: false };
      visiting.add(folderId);
      const own = ownFolderStats.get(folderId) || { total: 0, unread: 0, containsSelected: false };
      const result = { ...own };
      for (const child of childrenByParent.get(folderId) || []) {
        const childStats = getFolderStats(child.id, new Set(visiting));
        result.total += childStats.total;
        result.unread += childStats.unread;
        result.containsSelected ||= childStats.containsSelected;
      }
      folderStats.set(folderId, result);
      return result;
    };
    for (const folder of chatFolders) getFolderStats(folder.id);
    const renderedFolders = new Set<string>();
    const appendFolder = (folder: ChatFolder, depth: number) => {
      if (renderedFolders.has(folder.id)) return;
      renderedFolders.add(folder.id);
      const primaryChats = folder.chatIds
        .map((id) => chatById.get(id))
        .filter((chat): chat is ChatPreview => !!chat);
      const primaryDisplayChats = displayChats(folder, primaryChats);
      const cloneChats = (clonesByFolder.get(folder.id) || [])
        .map((cl) => ({ cl, chat: chatById.get(cl.sourceChatId) }))
        .filter(
          (x): x is { cl: ChatFolderClone; chat: ChatPreview } =>
            !!x.chat
        );
      const stats = folderStats.get(folder.id) || { total: 0, unread: 0, containsSelected: false };
      const { total, unread } = stats;
      if (searchActive && total === 0) return;
      items.push({
        kind: "folder_header",
        id: `fh-${folder.id}`,
        folderId: folder.id,
        name: folderDisplayName(folder),
        total,
        unread,
        containsSelected: stats.containsSelected,
        collapsed: !searchActive && !!folder.collapsed,
        depth,
      });
      if (!searchActive && folder.collapsed) return;
      for (const child of childrenByParent.get(folder.id) || []) {
        appendFolder(child, depth + 1);
      }
      for (const item of primaryDisplayChats) {
        items.push({
          kind: "chat",
          id: item.chat.id,
          chat: item.chat,
          folderId: folder.id,
          folderDepth: depth,
          accountCount: item.accountCount,
          memberChatIds: item.memberChatIds,
        });
      }
      for (const { cl, chat } of cloneChats) {
        items.push({
          kind: "chat",
          id: `clone-${cl.id}`,
          chat,
          cloneId: cl.id,
          folderId: folder.id,
          folderDepth: depth,
        });
      }
      if (total === 0 && !searchActive && !childrenByParent.has(folder.id)) {
        items.push({
          kind: "folder_empty",
          id: `fe-${folder.id}`,
          folderId: folder.id,
          folderDepth: depth,
        });
      }
    };

    for (const folder of chatFolders) {
      if (!folder.parentId || !folderById.has(folder.parentId)) appendFolder(folder, 0);
    }
    const ungroupedDisplayChats = isAllAccountsView
      ? allAccountDisplayChats.filter(
          (item) => !claimedAllAccountChats.has(item)
        )
      : filteredChats
          .filter((chat) => !primarySet.has(chat.id))
          .map((chat) => ({
            chat,
            accountCount: 1,
            memberChatIds: [chat.id],
          }));
    if (chatFolders.length === 0) {
      for (const item of ungroupedDisplayChats) {
        items.push({
          kind: "chat",
          id: item.chat.id,
          chat: item.chat,
          accountCount: item.accountCount,
          memberChatIds: item.memberChatIds,
        });
      }
    } else {
      const unread = ungroupedDisplayChats.filter((item) => (item.chat.unread || 0) > 0).length;
      if (ungroupedDisplayChats.length > 0 || !searchActive) {
        items.push({
          kind: "ungrouped_header",
          id: "__ungrouped",
          total: ungroupedDisplayChats.length,
          unread,
          containsSelected: ungroupedDisplayChats.some((item) => item.memberChatIds.includes(selectedChatId || "")),
        });
      }
      if (searchActive || !ungroupedCollapsed) {
        for (const item of ungroupedDisplayChats) {
          items.push({
            kind: "chat",
            id: item.chat.id,
            chat: item.chat,
            folderId: null,
            accountCount: item.accountCount,
            memberChatIds: item.memberChatIds,
          });
        }
        if (ungroupedDisplayChats.length === 0 && !searchActive) {
          items.push({
            kind: "folder_empty",
            id: "__ungrouped_empty",
            folderId: "__ungrouped",
          });
        }
      }
    }
  }

  if (filteredChats.length === 0) {
    items.push({ kind: "empty", id: "__empty" });
  }
  return items;
}
