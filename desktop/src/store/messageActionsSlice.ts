import type { ChatPreview, Message, WaMessageKey } from "@/types/crm";
import { getMessageFromDb, searchMessagesInDb } from "@/lib/storage";
import { cacheMediaUrl, dropMediaCache } from "@/lib/mediaCache";
import type { AppState, SliceContext } from "./types";
import { clearStoredChatMessages } from "@/lib/storage";
import { persist, scheduleStatsRecompute } from "./persist";
import { pruneChatFolderRefs } from "./chatFolderCleanup";
import { isRetryableOutgoing } from "./outgoingRetry";
import { mergeMessagesByTime } from "./messageOrdering";
import { setChatDraftValue } from "@/lib/chatDrafts";

export function createMessageActionsSlice({
  set,
  get,
}: SliceContext): Pick<
  AppState,
  | "addOutgoingMessage"
  | "enqueueOutgoingMessage"
  | "patchMessage"
  | "updateMessageDelivery"
  | "deleteLocalMessage"
  | "patchChat"
  | "deleteChatLocal"
  | "releaseInactiveChatHistory"
  | "inboundKeysForChat"
  | "listRetryableOutgoing"
  | "ensureChatForContact"
  | "clearChatMessages"
  | "markChatUnreadLocal"
  | "searchMessagesGlobal"
  | "ensureMessageInMemory"
> {
  return {
    addOutgoingMessage: (body) => {
      get().enqueueOutgoingMessage({
        body,
        deliveryStatus: "sent",
      });
    },

    enqueueOutgoingMessage: (input) => {
      const state = get();
      const chatId = input.chatId ?? state.selectedChatId;
      const contactId = input.contactId ?? state.selectedContactId;
      if (!chatId) return null;
      const accountId =
        input.accountId ||
        state.chats.find((chat) => chat.id === chatId)?.accountId ||
        state.contacts.find((contact) => contact.id === contactId)?.accountId;
      const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const sentAt = new Date().toISOString();
      const status = input.deliveryStatus ?? "pending";
      const msg: Message = {
        id,
        chatId,
        direction: "out",
        body: input.body,
        sentAt,
        deliveryStatus: status,
        lastError: input.lastError,
        retryCount: 0,
        nextAttemptAt: input.nextAttemptAt,
        phoneE164: input.phoneE164,
        contactId: contactId ?? undefined,
        channelId: input.channelId,
        deviceId: input.deviceId,
        accountId,
        systemKind: input.systemKind,
      };
      set((state) => ({
        messages: [...state.messages, msg],
        chats: state.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                lastMessage: input.body,
                lastMessageDirection: "out",
                updatedAt: sentAt,
                unread: 0,
              }
            : c
        ),
        draftReplyByChatId: setChatDraftValue(
          state.draftReplyByChatId,
          chatId,
          ""
        ),
        ...(state.selectedChatId === chatId ? { draftReply: "" } : {}),
      }));
      if (contactId && (status === "sent" || status === "local")) {
        get().logActivity(
          contactId,
          "message_out",
          "发出消息",
          input.body.slice(0, 120)
        );
      } else {
        get().recomputeStats();
        persist(get);
      }
      get().recomputeStats();
      return id;
    },

    patchMessage: (id, patch) => {
      const state = get();
      const idx = state.messages.findIndex((m) => m.id === id);
      if (idx < 0) return false;
      const prev = state.messages[idx];
      let changed = false;
      for (const key of Object.keys(patch) as (keyof Message)[]) {
        if (prev[key] !== patch[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return false;
      const next = { ...prev, ...patch };
      const messages = state.messages.slice();
      messages[idx] = next;
      set({ messages });
      return true;
    },

    updateMessageDelivery: (id, patch) => {
      const prev = get().messages.find((m) => m.id === id);
      const applied = get().patchMessage(id, patch);
      if (!applied) return;
      const next = get().messages.find((m) => m.id === id);
      if (
        prev &&
        next &&
        prev.deliveryStatus !== "sent" &&
        next.deliveryStatus === "sent" &&
        next.contactId
      ) {
        get().logActivity(
          next.contactId,
          "message_out",
          "发出消息",
          next.body.slice(0, 120)
        );
      } else {
        persist(get);
      }
      if (next?.mediaUrl) void cacheMediaUrl(next.id, next.mediaUrl);
    },

    deleteLocalMessage: (id) => {
      const prev = get().messages.find((m) => m.id === id);
      if (!prev) return;
      void dropMediaCache(id);
      set((state) => {
        const messages = state.messages.filter((m) => m.id !== id);
        let chats = state.chats;
        if (prev.chatId) {
          const rest = messages
            .filter((m) => m.chatId === prev.chatId)
            .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
          const last = rest[rest.length - 1];
          chats = state.chats.map((c) =>
            c.id === prev.chatId
              ? {
                  ...c,
                  lastMessage: last?.body || "",
                  updatedAt: last?.sentAt || c.updatedAt,
                  unread: Math.min(
                    c.unread || 0,
                    rest.filter((message) => message.direction === "in").length
                  ),
                }
              : c
          );
        }
        return { messages, chats };
      });
      persist(get);
    },

    patchChat: (chatId, patch) => {
      set((state) => ({
        chats: state.chats.map((c) =>
          c.id === chatId ? { ...c, ...patch } : c
        ),
      }));
      scheduleStatsRecompute(get);
      persist(get);
    },

    deleteChatLocal: (chatId, opts) => {
      const clearMessages = opts?.clearMessages !== false;
      if (clearMessages) {
        for (const m of get().messages) {
          if (m.chatId === chatId) void dropMediaCache(m.id);
        }
        // The in-memory window may only contain recent messages. Clear the
        // whole chat in SQLite as well so cold history cannot reappear later.
        void clearStoredChatMessages(chatId).catch((error) =>
          get().pushToast(
            error instanceof Error ? error.message : "聊天记录清理落盘失败",
            "error"
          )
        );
      }
      set((state) => {
        const chats = state.chats.filter((c) => c.id !== chatId);
        const messages = clearMessages
          ? state.messages.filter((m) => m.chatId !== chatId)
          : state.messages;
        const selectedChatId =
          state.selectedChatId === chatId ? chats[0]?.id ?? null : state.selectedChatId;
        const folderRefs = pruneChatFolderRefs(
          state.settings.chatFolders || [],
          state.settings.chatFolderClones || [],
          new Set(chats.map((chat) => chat.id))
        );
        return {
          chats,
          messages,
          selectedChatId,
          settings: {
            ...state.settings,
            chatFolders: folderRefs.folders,
            chatFolderClones: folderRefs.clones,
          },
        };
      });
      scheduleStatsRecompute(get);
      persist(get);
    },

    releaseInactiveChatHistory: async (chatIds) => {
      const ids = new Set(chatIds.filter(Boolean));
      const targets = get().chats.filter((chat) => ids.has(chat.id));
      if (!targets.length) return 0;

      for (const message of get().messages) {
        if (ids.has(message.chatId)) void dropMediaCache(message.id);
      }
      await Promise.all(targets.map((chat) => clearStoredChatMessages(chat.id)));
      set((state) => ({
        messages: state.messages.filter((message) => !ids.has(message.chatId)),
        chats: state.chats.map((chat) =>
          ids.has(chat.id) ? { ...chat, lastMessage: "", unread: 0 } : chat
        ),
      }));
      scheduleStatsRecompute(get);
      persist(get);
      return targets.length;
    },

    inboundKeysForChat: (chatId) => {
      if (!chatId) return [];
      const out: WaMessageKey[] = [];
      const seen = new Set<string>();
      for (const m of get().messages) {
        if (m.chatId !== chatId || m.direction !== "in") continue;
        const k = m.waKey;
        if (k?.remoteJid && k.id) {
          const sig = `${k.remoteJid}|${k.id}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          out.push(k);
        }
      }
      // Baileys accepts a batch of keys. Truncating here leaves older unread
      // messages unread on the server when a chat opens with a large badge.
      return out;
    },

    listRetryableOutgoing: (nowIso) => {
      const now = nowIso ? Date.parse(nowIso) : Date.now();
      return get().messages.filter((message) => isRetryableOutgoing(message, now));
    },

    ensureChatForContact: (contactId, accountId) => {
      if (!contactId) return null;
      const state = get();
      const contact = state.contacts.find((c) => c.id === contactId);
      if (!contact) return null;
      const existing = state.chats.find(
        (c) => c.contactId === contactId && (!accountId || c.accountId === accountId)
      );
      if (existing) return existing.id;
      const chatId = `bridge-chat-${contactId}${accountId ? `-${accountId}` : ""}`;
      const chat: ChatPreview = {
        id: chatId,
        contactId,
        contactName: contact.name || contact.phone || contactId,
        lastMessage: "",
        unread: 0,
        updatedAt: new Date().toISOString(),
        phoneId:
          accountId || contact.boundPhoneId || get().selectedPhoneId || "baileys",
        accountId,
      };
      set((s) => ({ chats: [chat, ...s.chats] }));
      get().recomputeStats();
      persist(get);
      return chatId;
    },

    clearChatMessages: (chatId) => {
      for (const m of get().messages) {
        if (m.chatId === chatId) void dropMediaCache(m.id);
      }
      set((s) => ({
        messages: s.messages.filter((m) => m.chatId !== chatId),
        chats: s.chats.map((chat) =>
          chat.id === chatId
            ? { ...chat, lastMessage: "", unread: 0 }
            : chat
        ),
      }));
      void clearStoredChatMessages(chatId).catch((error) =>
        get().pushToast(
          error instanceof Error ? error.message : "聊天记录清空落盘失败",
          "error"
        )
      );
      persist(get);
    },

    markChatUnreadLocal: (chatId, unread = 1) => {
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, unread: Math.max(1, unread) } : c
        ),
        unreadHoldUntilByChatId: {
          ...s.unreadHoldUntilByChatId,
          [chatId]: Date.now(),
        },
      }));
      persist(get);
    },

    searchMessagesGlobal: async (query, limit = 48) => {
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      const fromDb = await searchMessagesInDb({ query, limit });
      if (fromDb?.ok && Array.isArray(fromDb.items)) {
        return fromDb.items
          .filter(
            (x): x is Message =>
              !!x && typeof x === "object" && typeof (x as Message).id === "string"
          )
          .slice(0, limit);
      }
      // 浏览器/无 SQLite：扫内存
      return get()
        .messages.filter((m) => m.body.toLowerCase().includes(q))
        .slice(0, limit);
    },

    ensureMessageInMemory: async (id) => {
      if (!id) return null;
      const state = get();
      const found = state.messages.find((m) => m.id === id);
      if (found) return found;
      const fromDb = await getMessageFromDb(id);
      if (!fromDb) return null;
      set((s) => ({
        messages: mergeMessagesByTime(s.messages, [fromDb as Message]),
      }));
      return fromDb;
    },
  };
}
