import type { ChatPreview, Contact, PhoneDevice } from "@/types/crm";

type ContactCreationState = {
  contacts: Contact[];
  chats: ChatPreview[];
  phones: PhoneDevice[];
};

type ContactCreationDeps = {
  setState: (
    updater: (state: ContactCreationState) => Partial<ContactCreationState>
  ) => void;
  setSelection: (contactId: string, chatId: string) => void;
  setActiveChats: () => void;
  logActivity: (contactId: string, detail?: string) => void;
  recomputeStats: () => void;
  persist: (immediate?: boolean) => void;
};

export function createContactCreationActions({
  setState,
  setSelection,
  setActiveChats,
  logActivity,
  recomputeStats,
  persist,
}: ContactCreationDeps) {
  return {
    addContact(input: Omit<Contact, "id">) {
      const id = `c-${crypto.randomUUID()}`;
      const contact: Contact = { ...input, id };
      const chatId = `chat-${id}`;
      setState((state) => ({
        contacts: [...state.contacts, contact],
        chats: [
          {
            id: chatId,
            contactId: id,
            contactName: contact.name,
            lastMessage: "",
            unread: 0,
            updatedAt: new Date().toISOString(),
            phoneId: contact.boundPhoneId || state.phones[0]?.id || "",
            accountId:
              contact.accountId ||
              contact.boundPhoneId ||
              state.phones[0]?.id ||
              "",
          },
          ...state.chats,
        ],
      }));
      setSelection(id, chatId);
      setActiveChats();
      logActivity(id, input.source ? `来源 ${input.source}` : undefined);
      recomputeStats();
      persist();
    },
    /** 批量导入：静默建联系人+会话行，不跳转不逐条通知 */
    importContacts(contacts: Omit<Contact, "id">[]) {
      if (!contacts.length) return 0;
      const now = new Date().toISOString();
      const newContacts: Contact[] = contacts.map((input) => ({
        ...input,
        id: `c-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        stage: input.stage || "new",
        tags: input.tags || [],
      }));
      const newChats: ChatPreview[] = newContacts.map((contact) => ({
        id: `chat-${contact.id}`,
        contactId: contact.id,
        contactName: contact.name,
        lastMessage: "",
        unread: 0,
        updatedAt: now,
        phoneId: contact.boundPhoneId || "",
        accountId: contact.accountId || contact.boundPhoneId || "",
      }));
      setState((state) => ({
        contacts: [...state.contacts, ...newContacts],
        chats: [...newChats, ...state.chats],
      }));
      recomputeStats();
      // 批量导入完成后立即落盘，不能只依赖 1.4 秒防抖保存。
      persist(true);
      return newContacts.length;
    },
  };
}
