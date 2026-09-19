import type { ChatPreview, Contact } from "@/types/crm";
import type { SettingsShape } from "./settingsDefaults";
import { setChatDraftValue } from "@/lib/chatDrafts";

type WorkspaceState = {
  contacts: Contact[];
  chats: ChatPreview[];
  settings: SettingsShape;
  selectedPhoneId: string | null;
  selectedContactId: string | null;
  selectedChatId: string | null;
  selectedThreadAccount: { chatId: string; accountId: string } | null;
  activeNav: "chats";
  focusMessageId: string | null;
  draftReplyByChatId: Record<string, string>;
  crmPanelCollapsed: boolean;
};

type WorkspaceDeps = {
  getState: () => WorkspaceState;
  setState: (patch: Partial<WorkspaceState>) => void;
  scheduleStatsRecompute: () => void;
  persist: () => void;
};

export function createContactWorkspaceActions({
  getState,
  setState,
  scheduleStatsRecompute,
  persist,
}: WorkspaceDeps) {
  return {
    openContactWorkspace(
      contactId: string,
      opts?: { focusMessageId?: string; prefillDraft?: string }
    ) {
      const state = getState();
      const contact = state.contacts.find((item) => item.id === contactId);
      if (!contact) return;

      const owner =
        contact.accountId ||
        contact.boundPhoneId ||
        state.settings.liveBaileysAccountId ||
        state.settings.activeAccountId ||
        "wa-default";
      let chats = state.chats;
      let chat = chats.find(
        (item) =>
          item.contactId === contactId &&
          (item.accountId || item.phoneId || owner) === owner
      );

      if (!chat) {
        chat = {
          id: `bridge-chat-${contact.id}`,
          contactId: contact.id,
          contactName: contact.name,
          lastMessage: "",
          unread: 0,
          updatedAt: new Date().toISOString(),
          phoneId: owner,
          accountId: owner,
        };
        chats = [chat, ...chats];
      } else if (!chat.accountId) {
        chats = chats.map((item) =>
          item.id === chat!.id
            ? { ...item, accountId: owner, phoneId: owner }
            : item
        );
        chat = chats.find((item) => item.id === chat!.id)!;
      }

      const shouldClearUnread = chats.some(
        (item) =>
          item.contactId === contactId &&
          (item.accountId || item.phoneId || owner) === owner &&
          item.unread > 0
      );
      const nextChats = shouldClearUnread
        ? chats.map((item) =>
            item.contactId === contactId &&
            (item.accountId || item.phoneId || owner) === owner
              ? { ...item, unread: 0 }
              : item
          )
        : chats;
      const chatsChanged = nextChats !== state.chats;
      const draftReplyByChatId =
        opts?.prefillDraft === undefined
          ? state.draftReplyByChatId
          : setChatDraftValue(
              state.draftReplyByChatId,
              chat.id,
              opts.prefillDraft
            );

      setState({
        selectedContactId: contactId,
        selectedPhoneId: contact.boundPhoneId ?? state.selectedPhoneId,
        selectedChatId: chat.id,
        selectedThreadAccount: { chatId: chat.id, accountId: owner },
        activeNav: "chats",
        focusMessageId: opts?.focusMessageId ?? null,
        draftReplyByChatId,
        crmPanelCollapsed: false,
        chats: nextChats,
      });
      scheduleStatsRecompute();
      if (chatsChanged) persist();
    },
  };
}
