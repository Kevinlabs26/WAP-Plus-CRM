import { useEffect, useState } from "react";
import type { GroupMember } from "@/types/crm";
import { useAppStore } from "@/store/appStore";
import { loadGroupMembers } from "./loadGroupMembers";

type UseGroupMembersOptions = {
  selectedChatId: string | null;
  selectedContactId: string | null;
  isBaileys: boolean;
  liveBaileysAccountId: string | null | undefined;
  activeAccountId: string | null | undefined;
  /** 切换会话时回调（清空 mention 跟踪等） */
  onChatChange?: () => void;
};

/**
 * 群会话成员：缓存供 @ 选择器 / @所有人 / 群发送者展示，
 * 从 ChatPanel 抽离。切换会话时清空并重载。
 */
export function useGroupMembers(opts: UseGroupMembersOptions) {
  const [groupMembers, setGroupMembers] = useState<
    { jid: string; label: string; phoneE164?: string }[]
  >([]);
  const [groupMemberDetails, setGroupMemberDetails] = useState<GroupMember[]>(
    []
  );

  useEffect(() => {
    let cancelled = false;
    setGroupMembers([]);
    setGroupMemberDetails([]);
    opts.onChatChange?.();
    void loadGroupMembers({
      contacts: useAppStore.getState().contacts,
      chats: useAppStore.getState().chats,
      selectedContactId: opts.selectedContactId,
      selectedChatId: opts.selectedChatId,
      isBaileys: opts.isBaileys,
      liveBaileysAccountId: opts.liveBaileysAccountId ?? undefined,
      activeAccountId: opts.activeAccountId ?? undefined,
      isCancelled: () => cancelled,
      setGroupMembers,
      setGroupMemberDetails,
    });
    return () => {
      cancelled = true;
    };
  }, [
    opts.selectedChatId,
    opts.selectedContactId,
    opts.isBaileys,
    opts.liveBaileysAccountId,
    opts.activeAccountId,
  ]);

  return { groupMembers, groupMemberDetails };
}
