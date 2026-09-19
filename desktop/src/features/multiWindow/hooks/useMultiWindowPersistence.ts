import { useEffect } from "react";
import {
  FOLDER_STORAGE_KEY,
  FOLDER_IDS_KEY,
  ACTIVE_MEMBER_KEY,
  IGNORE_GROUPS_KEY,
  MANUAL_MEMBERS_KEY,
  RECENT_QUEUE_KEY,
  SORT_MODE_KEY,
  COMPACT_MODE_KEY,
  COLLAPSED_WINDOWS_KEY,
  PINNED_WINDOWS_KEY,
  LAYOUT_MODE_KEY,
  STORAGE_KEY,
  scopedStorageKey,
  writeJson,
  writeString,
} from "@/features/multiWindow/storage";
import type { LayoutMode, SortMode } from "@/features/multiWindow/types";

export function useMultiWindowPersistence({
  openChatIds,
  collapsedWindowIds,
  pinnedWindowIds,
  sourceFolderIds,
  manualMemberChatIdsByWindow,
  activeMemberChatByWindow,
  sortMode,
  ignoreGroups,
  recentQueueIds,
  layoutMode,
  compactMode,
  accountScopeId,
}: {
  openChatIds: string[];
  collapsedWindowIds: string[];
  pinnedWindowIds: string[];
  sourceFolderIds: string[];
  manualMemberChatIdsByWindow: Record<string, string[]>;
  activeMemberChatByWindow: Record<string, string>;
  sortMode: SortMode;
  ignoreGroups: boolean;
  recentQueueIds: string[];
  layoutMode: LayoutMode;
  compactMode: boolean;
  accountScopeId?: string;
}) {
  useEffect(() => {
    writeJson(
      scopedStorageKey(sourceFolderIds.length ? FOLDER_STORAGE_KEY : STORAGE_KEY, accountScopeId),
      openChatIds
    );
    writeJson(scopedStorageKey(FOLDER_IDS_KEY, accountScopeId), sourceFolderIds);
  }, [accountScopeId, openChatIds, sourceFolderIds]);

  useEffect(() => {
    writeJson(scopedStorageKey(COLLAPSED_WINDOWS_KEY, accountScopeId), collapsedWindowIds);
  }, [accountScopeId, collapsedWindowIds]);

  useEffect(() => {
    writeJson(scopedStorageKey(PINNED_WINDOWS_KEY, accountScopeId), pinnedWindowIds);
  }, [accountScopeId, pinnedWindowIds]);

  useEffect(() => {
    writeJson(scopedStorageKey(MANUAL_MEMBERS_KEY, accountScopeId), manualMemberChatIdsByWindow);
  }, [accountScopeId, manualMemberChatIdsByWindow]);

  useEffect(() => {
    writeJson(scopedStorageKey(ACTIVE_MEMBER_KEY, accountScopeId), activeMemberChatByWindow);
  }, [accountScopeId, activeMemberChatByWindow]);

  useEffect(() => {
    writeString(scopedStorageKey(SORT_MODE_KEY, accountScopeId), sortMode);
  }, [accountScopeId, sortMode]);

  useEffect(() => {
    writeString(scopedStorageKey(IGNORE_GROUPS_KEY, accountScopeId), String(ignoreGroups));
  }, [accountScopeId, ignoreGroups]);

  useEffect(() => {
    writeJson(scopedStorageKey(RECENT_QUEUE_KEY, accountScopeId), recentQueueIds);
  }, [accountScopeId, recentQueueIds]);

  useEffect(() => {
    writeString(scopedStorageKey(LAYOUT_MODE_KEY, accountScopeId), layoutMode);
  }, [accountScopeId, layoutMode]);

  useEffect(() => {
    writeString(scopedStorageKey(COMPACT_MODE_KEY, accountScopeId), String(compactMode));
  }, [accountScopeId, compactMode]);
}
