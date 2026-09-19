import type { ChatPreview } from "@/types/crm";

export const MAX_VISIBLE_WINDOWS = 9;

export type SortMode = "priority" | "recent" | "opened";
export type LayoutMode = "auto" | "one" | "two" | "three";

export type FolderWindow = {
  chat: ChatPreview;
  memberChatIds: string[];
  accountCount: number;
  unreadCount: number;
};

export type MultiWindowStoredState = {
  openChatIds: string[];
  collapsedWindowIds: string[];
  pinnedWindowIds: string[];
  sourceFolderIds: string[];
  sortMode: SortMode;
  ignoreGroups: boolean;
  recentQueueIds: string[];
};
