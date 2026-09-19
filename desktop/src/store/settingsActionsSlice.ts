import {
  getStorageEngine,
  saveSecureSecrets,
  waitForPendingSaves,
} from "@/lib/storage";
import { calcStats } from "./calcStats";
import { importPhonesToFolder } from "./importPhonesToFolder";
import {
  exportBackup as exportBackupAction,
  exportContactsCsv as exportContactsCsvAction,
} from "./exportDataActions";
import type { AppState, SliceContext } from "./types";
import { persist } from "./persist";
import type { ScheduledMessage } from "@/types/crm";

let lastSecretSaveErrorAt = 0;

export function createSettingsActionsSlice({
  set,
  get,
}: SliceContext): Pick<
  AppState,
  | "updateSettings"
  | "importPhonesToFolder"
  | "exportBackup"
  | "exportContactsCsv"
  | "recomputeStats"
  | "scheduleMessage"
  | "updateScheduledMessage"
  | "cancelScheduledMessage"
  | "removeScheduledMessage"
> {
  return {
    updateSettings: (patch) => {
      let changed = false;
      set((state) => {
        const previousView = state.settings.accountViewMode;
        const requestedView = patch.accountViewMode;
        const accountViewChanged =
          requestedView !== undefined &&
          (requestedView.type !== previousView.type ||
            (requestedView.type === "account" &&
              (previousView.type !== "account" ||
                requestedView.accountId !== previousView.accountId)));
        const next = { ...state.settings };
        for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
          const v = patch[key];
          if (v === undefined) continue;
          if (!Object.is(next[key as keyof typeof next], v)) {
            (next as Record<string, unknown>)[key as string] = v as unknown;
            changed = true;
          }
        }
        if (!changed) return state;
        return {
          settings: next,
          ...(accountViewChanged
            ? {
                selectedChatId: null,
                selectedContactId: null,
              }
            : {}),
        };
      });
      if (changed) {
        const next = get().settings;
        if (
          getStorageEngine() === "sqlite" &&
          (patch.openaiKey !== undefined ||
            patch.groqKey !== undefined ||
            patch.geminiKey !== undefined ||
            patch.deepseekKey !== undefined ||
            patch.qwenKey !== undefined ||
            patch.zhipuKey !== undefined ||
            patch.openrouterKey !== undefined ||
            patch.customAiKey !== undefined ||
            patch.bridgeToken !== undefined)
        ) {
          void saveSecureSecrets({
            openaiKey: next.openaiKey,
            groqKey: next.groqKey,
            geminiKey: next.geminiKey,
            deepseekKey: next.deepseekKey,
            qwenKey: next.qwenKey,
            zhipuKey: next.zhipuKey,
            openrouterKey: next.openrouterKey,
            customAiKey: next.customAiKey,
            bridgeToken: next.bridgeToken,
          }).then((ok) => {
            if (!ok && Date.now() - lastSecretSaveErrorAt > 10_000) {
              lastSecretSaveErrorAt = Date.now();
              get().pushToast("敏感配置安全保存失败，请稍后重试", "error");
            }
          });
        }
        // 文件夹属于用户明确维护的结构数据，不能等防抖计时器；
        // 否则用户马上刷新时，内存里的新分组会被旧数据库覆盖回来。
        const folderStructureChanged =
          patch.chatFolders !== undefined || patch.chatFolderClones !== undefined;
        persist(get, folderStructureChanged);
      }
    },

    scheduleMessage: (input) => {
      if ((get().settings.scheduledMessages || []).length >= 200) {
        get().pushToast("定时记录已达 200 条，请先删除已结束的记录", "error");
        return null;
      }
      const text = input.text.trim().slice(0, 4000);
      const dueAt = new Date(input.dueAt);
      if (!text) {
        get().pushToast("定时消息不能为空", "error");
        return null;
      }
      if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
        get().pushToast("定时发送时间必须晚于现在", "error");
        return null;
      }
      const id = `scheduled-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ScheduledMessage = {
        id,
        chatId: input.chatId,
        contactId: input.contactId,
        contactName: input.contactName.trim().slice(0, 120),
        recipient: input.recipient,
        text,
        dueAt: dueAt.toISOString(),
        channelId: input.channelId,
        deviceId: input.deviceId,
        accountId: input.accountId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const scheduledMessages = [
          ...(state.settings.scheduledMessages || []),
          item,
        ];
        return {
          scheduledMessages,
          settings: { ...state.settings, scheduledMessages },
        };
      });
      persist(get, true);
      return id;
    },

    updateScheduledMessage: (id, patch) => {
      let changed = false;
      set((state) => {
        const current = state.settings.scheduledMessages || [];
        const scheduledMessages = current.map((item) => {
          if (item.id !== id) return item;
          changed = Object.keys(patch).some(
            (key) => item[key as keyof typeof patch] !== patch[key as keyof typeof patch]
          );
          return changed ? { ...item, ...patch } : item;
        });
        if (!changed) return state;
        return {
          scheduledMessages,
          settings: { ...state.settings, scheduledMessages },
        };
      });
      if (changed) persist(get, true);
      return changed;
    },

    cancelScheduledMessage: (id) => {
      const item = (get().settings.scheduledMessages || []).find(
        (entry) => entry.id === id
      );
      if (!item || item.status === "sent" || item.status === "cancelled") {
        return false;
      }
      const outgoing = item.messageId
        ? get().messages.find((message) => message.id === item.messageId)
        : undefined;
      if (outgoing && outgoing.deliveryStatus !== "queued" && outgoing.deliveryStatus !== "failed") {
        get().pushToast("发送请求已发出，无法取消，请等待发送结果", "info");
        return false;
      }
      const changed = get().updateScheduledMessage(id, {
        status: "cancelled",
        error: "已取消定时发送",
      });
      if (changed && item.messageId) {
        const message = get().messages.find((entry) => entry.id === item.messageId);
        if (
          message &&
          (message.deliveryStatus === "queued" ||
            message.deliveryStatus === "pending")
        ) {
          get().updateMessageDelivery(item.messageId, {
            deliveryStatus: "failed",
            lastError: "已取消定时发送",
            nextAttemptAt: undefined,
          });
        }
      }
      return changed;
    },

    removeScheduledMessage: (id) => {
      let changed = false;
      set((state) => {
        const current = state.settings.scheduledMessages || [];
        const scheduledMessages = current.filter((item) => {
          const keep = item.id !== id;
          if (!keep) changed = true;
          return keep;
        });
        if (!changed) return state;
        return {
          scheduledMessages,
          settings: { ...state.settings, scheduledMessages },
        };
      });
      if (changed) persist(get, true);
      return changed;
    },

    importPhonesToFolder: (folderId, rawText) => {
      return importPhonesToFolder(folderId, rawText, {
        getFolder: (id) =>
          (get().settings.chatFolders || []).find((folder) => folder.id === id),
        getContacts: () => get().contacts,
        getChats: () => get().chats,
        defaultAccountId: () => get().settings.activeAccountId,
        selectedPhoneId: () => get().selectedPhoneId,
        addContact: (contact) => get().addContact(contact),
        prependChat: (chat) => set((state) => ({ chats: [chat, ...state.chats] })),
        moveChatToFolder: (chatId, id) => get().moveChatToFolder(chatId, id),
        recomputeStats: () => get().recomputeStats(),
        // importPhonesToFolder 会在批次结束时请求立即保存完整快照。
        persist: (immediate = false) => persist(get, immediate),
        pushToast: (message, tone) => get().pushToast(message, tone),
      });
    },

    exportBackup: async () => {
      try {
        persist(get, true);
        await waitForPendingSaves();
        await exportBackupAction(get(), get().pushToast);
      } catch (error) {
        get().pushToast(
          error instanceof Error ? error.message : "导出备份失败",
          "error"
        );
      }
    },

    exportContactsCsv: () => {
      exportContactsCsvAction(get().contacts, get().pushToast);
    },

    recomputeStats: () => {
      const { chats, followUps, contacts, messages } = get();
      set({ stats: calcStats(chats, followUps, contacts, messages) });
    },
  };
}
