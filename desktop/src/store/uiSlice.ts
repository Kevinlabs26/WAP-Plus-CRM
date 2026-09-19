import {
  applyWhatsAppLabelsToContacts,
  sameWhatsAppLabels,
} from "@/lib/whatsappLabelSnapshot";
import type { AppState, SliceContext } from "./types";
import { persist, scheduleStatsRecompute } from "./persist";
import { setChatDraftValue } from "@/lib/chatDrafts";

export function createUiSlice({ set, get }: SliceContext): Pick<
  AppState,
  | "setSelectedPhone"
  | "setUiReady"
  | "setSelectedContact"
  | "setSelectedChat"
  | "setDraftReply"
  | "setChatDraft"
  | "applyAiSuggestion"
  | "setActiveNav"
  | "setSettingsOpen"
  | "setSettingsCategory"
  | "setCommandOpen"
  | "setBaileysLoginOpen"
  | "setFocusMessageId"
  | "setBaileysUi"
  | "syncWhatsAppLabels"
  | "setCrmPanelCollapsed"
  | "setCrmPanelTab"
  | "setChatListFilter"
  | "goToChats"
  | "pushToast"
  | "dismissToast"
  | "requestConfirm"
  | "resolveConfirm"
  | "setBridgeRuntime"
> {
  return {
    setSelectedPhone: (id) => {
      if (get().selectedPhoneId === id) return;
      set({ selectedPhoneId: id });
    },
    setUiReady: (v) => set({ uiReady: v }),

    setSelectedContact: (id) => {
      const contact = get().contacts.find((c) => c.id === id);
      set({
        selectedContactId: id,
        selectedPhoneId:
          contact?.boundPhoneId ?? get().selectedPhoneId,
      });
    },

    setSelectedChat: (id, accountId) => {
      const state = get();
      const chat = state.chats.find((c) => c.id === id);
      const nextAccountId =
        accountId || chat?.accountId || chat?.phoneId || null;
      const sameThreadAccount =
        state.selectedThreadAccount?.chatId === id &&
        state.selectedThreadAccount.accountId === nextAccountId;
      if (state.selectedChatId === id && sameThreadAccount) return;
      const shouldClearUnread = Boolean(chat?.unread);
      set({
        selectedChatId: id,
        selectedThreadAccount:
          id && nextAccountId ? { chatId: id, accountId: nextAccountId } : null,
        selectedContactId: chat?.contactId ?? state.selectedContactId,
        selectedPhoneId: chat?.phoneId ?? state.selectedPhoneId,
        // 只有确实有未读时才复制整份聊天列表
        ...(shouldClearUnread
          ? { chats: state.chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) }
          : {}),
      });
      if (shouldClearUnread) {
        scheduleStatsRecompute(get);
        persist(get);
      }
    },

    setDraftReply: (text) =>
      set((state) => ({
        draftReply: text,
        draftReplyByChatId: setChatDraftValue(
          state.draftReplyByChatId,
          state.selectedChatId,
          text
        ),
      })),
    setChatDraft: (chatId, text) =>
      set((state) => ({
        draftReplyByChatId: setChatDraftValue(
          state.draftReplyByChatId,
          chatId,
          text
        ),
        ...(state.selectedChatId === chatId ? { draftReply: text } : {}),
      })),
    applyAiSuggestion: (text, mode = "replace") =>
      set((state) => {
        const cur = state.draftReply.trim();
        const next =
          mode === "append" && cur ? `${cur}\n${text}` : text;
        return {
          draftReply: next,
          draftReplyByChatId: setChatDraftValue(
            state.draftReplyByChatId,
            state.selectedChatId,
            next
          ),
          activeNav: "chats" as const,
        };
      }),
    setActiveNav: (nav) => {
      if (get().activeNav === nav) return;
      set({ activeNav: nav });
    },
    setSettingsOpen: (open, category) =>
      set(
        open
          ? {
              settingsOpen: true,
              ...(category ? { settingsCategory: category } : {}),
            }
          : { settingsOpen: false }
      ),
    setSettingsCategory: (category) => set({ settingsCategory: category }),
    setCommandOpen: (open) => set({ commandOpen: open }),
    setBaileysLoginOpen: (open) => set({ baileysLoginOpen: open }),
    setFocusMessageId: (id) => set({ focusMessageId: id }),
    setBaileysUi: (patch) =>
      set((s) => {
        const prev = s.baileysUi;
        const next = { ...prev, ...patch };
        // 短暂 reconnecting/starting/close：保留「重连中」期间的连接上下文；
        // error 必须立即暴露，避免设备页已 Connection Failure、顶栏仍显示在线。
        const demote =
          prev.connection === "connected" &&
          next.connection &&
          next.connection !== "connected";
        if (demote) {
          const soft = ["reconnecting", "starting", "close"].includes(
            next.connection
          );
          if (soft) {
            next.connection = "connected";
            next.userName = next.userName || prev.userName;
            next.hasQr = false;
          }
        }
        // user 短暂为空时不抹掉名字
        if (!next.userName && prev.userName) next.userName = prev.userName;
        if (
          next.connection === prev.connection &&
          next.userName === prev.userName &&
          next.hasQr === prev.hasQr &&
          next.labelsByAccountId === prev.labelsByAccountId &&
          next.chatLabelIdsByAccountId === prev.chatLabelIdsByAccountId
        ) {
          return s;
        }
        return { baileysUi: next };
      }),
    syncWhatsAppLabels: (labels, chatLabelIds, accountId) => {
      const previous = get().baileysUi;
      const previousLabels = previous.labelsByAccountId[accountId] || [];
      const previousChatLabelIds =
        previous.chatLabelIdsByAccountId[accountId] || {};
      if (
        sameWhatsAppLabels(
          previousLabels,
          previousChatLabelIds,
          labels,
          chatLabelIds
        )
      ) return;
      set((state) => ({
        baileysUi: {
          ...state.baileysUi,
          labelsByAccountId: {
            ...state.baileysUi.labelsByAccountId,
            [accountId]: labels,
          },
          chatLabelIdsByAccountId: {
            ...state.baileysUi.chatLabelIdsByAccountId,
            [accountId]: chatLabelIds,
          },
        },
        contacts: applyWhatsAppLabelsToContacts(
          state.contacts,
          accountId,
          previousLabels,
          labels,
          chatLabelIds
        ),
      }));
      persist(get);
    },
    setCrmPanelCollapsed: (v) => set({ crmPanelCollapsed: v }),
    setCrmPanelTab: (tab) => set({ crmPanelTab: tab }),
    setChatListFilter: (f) => {
      if (get().chatListFilter === f) return;
      set({ chatListFilter: f });
    },
    goToChats: (filter = "all") => {
      const state = get();
      if (state.activeNav === "chats" && state.chatListFilter === filter) return;
      set({ activeNav: "chats", chatListFilter: filter });
    },
    pushToast: (message, tone = "info", options) => {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item = { id, message, tone, ...options };
      set((state) => ({
        toasts: options?.title
          ? [
              ...state.toasts.filter(
                (toast) =>
                  !options.dedupeKey || toast.dedupeKey !== options.dedupeKey
              ),
              item,
            ].slice(-3)
          : [item],
      }));
      window.setTimeout(() => {
        get().dismissToast(id);
      }, options?.durationMs ?? (options?.title ? 6500 : 3200));
    },
    dismissToast: (id) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    requestConfirm: (opts) =>
      new Promise<boolean>((resolve) => {
        const prev = get().confirmDialog;
        if (prev) {
          try {
            prev.resolve(false);
          } catch {
            /* ignore */
          }
        }
        const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set({
          confirmDialog: {
            id,
            title: opts.title,
            description: opts.description,
            confirmLabel: opts.confirmLabel || "确定",
            cancelLabel: opts.cancelLabel || "取消",
            tone: opts.tone || "default",
            resolve,
          },
        });
      }),

    resolveConfirm: (ok) => {
      const cur = get().confirmDialog;
      if (!cur) return;
      set({ confirmDialog: null });
      try {
        cur.resolve(ok);
      } catch {
        /* ignore */
      }
    },

    setBridgeRuntime: (patch) =>
      set((s) => ({
        bridge: { ...s.bridge, ...patch, updatedAt: Date.now() },
      })),
  };
}
