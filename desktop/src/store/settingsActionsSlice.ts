import {
  getStorageEngine,
  saveSecureSecrets,
} from "@/lib/storage";
import { calcStats } from "./calcStats";
import { importPhonesToFolder } from "./importPhonesToFolder";
import {
  exportBackup as exportBackupAction,
  exportContactsCsv as exportContactsCsvAction,
} from "./exportDataActions";
import type { AppState, SliceContext } from "./types";
import { deferDuringRestore, isDataRestoreActive } from "./restoreGuard";
import { persist } from "./persist";
import type { ScheduledMessage } from "@/types/crm";
import { removeSalesStage, resolveSalesStageLabel } from "@/lib/contactWorkflow";
import { MAX_QUICK_REPLIES, MAX_RECENT_QUICK_REPLIES, normalizeQuickReplyIds } from "@/lib/quickReplies";

let lastSecretSaveErrorAt = 0;

export function createSettingsActionsSlice({
  set,
  get,
}: SliceContext): Pick<
  AppState,
  | "updateSettings"
  | "toggleQuickReplyPin"
  | "recordQuickReplyUsage"
  | "retrySecretSave"
  | "deleteSalesStage"
  | "importPhonesToFolder"
  | "exportBackup"
  | "exportContactsCsv"
  | "recomputeStats"
  | "scheduleMessage"
  | "updateScheduledMessage"
  | "cancelScheduledMessage"
  | "removeScheduledMessage"
> {
  let secretSaveTail: Promise<boolean> = Promise.resolve(true);
  let secretSaveGeneration = 0;
  const saveCurrentSecrets = () => {
    const generation = ++secretSaveGeneration;
    const next = get().settings;
    const snapshot = {
      openaiKey: next.openaiKey, groqKey: next.groqKey, geminiKey: next.geminiKey,
      deepseekKey: next.deepseekKey, qwenKey: next.qwenKey, zhipuKey: next.zhipuKey,
      openrouterKey: next.openrouterKey, customAiKey: next.customAiKey,
      transcriptionApiKey: next.transcriptionApiKey, bridgeToken: next.bridgeToken,
    };
    set({ secretSaveStatus: "saving" });
    const run = secretSaveTail.then(() => saveSecureSecrets(snapshot)).catch(() => false).then(ok => {
      if (generation === secretSaveGeneration) {
        set({ secretSaveStatus: ok ? "idle" : "failed" });
        if (!ok && Date.now() - lastSecretSaveErrorAt > 10_000) {
          lastSecretSaveErrorAt = Date.now();
          get().pushToast("敏感配置安全保存失败，请在设置中点击重试", "error");
        }
      }
      return ok;
    });
    secretSaveTail = run;
    return run;
  };
  return {
    toggleQuickReplyPin: id => {
      if (deferDuringRestore(() => get().toggleQuickReplyPin(id))) return;
      const { settings, updateSettings } = get();
      if (!settings.quickReplies.some(reply => reply.id === id)) return;
      const pinned = settings.quickReplyPinnedIds || [];
      updateSettings({ quickReplyPinnedIds: pinned.includes(id) ? pinned.filter(item => item !== id) : [...pinned, id] });
    },
    recordQuickReplyUsage: id => {
      if (deferDuringRestore(() => get().recordQuickReplyUsage(id))) return;
      const { settings, updateSettings } = get();
      if (!settings.quickReplies.some(reply => reply.id === id) || settings.quickReplyRecentIds?.[0] === id) return;
      updateSettings({ quickReplyRecentIds: [id, ...(settings.quickReplyRecentIds || []).filter(item => item !== id)].slice(0, MAX_RECENT_QUICK_REPLIES) });
    },
    retrySecretSave: async () => {
      if (isDataRestoreActive() || getStorageEngine() !== "sqlite") return false;
      return saveCurrentSecrets();
    },
    deleteSalesStage: (stageId, targetId) => {
      if (isDataRestoreActive()) return false;
      let deleted = false;
      let movedIds: string[] = [], previousLabel = "", targetLabel = "";
      set(state => {
        const next = removeSalesStage(state.contacts, state.settings.salesStageLabels, state.settings.salesStageOrder, stageId, targetId);
        if (!next) return state;
        movedIds = state.contacts.filter(contact => contact.stage === stageId).map(contact => contact.id);
        previousLabel = resolveSalesStageLabel(stageId, state.settings.salesStageLabels);
        targetLabel = resolveSalesStageLabel(targetId, state.settings.salesStageLabels);
        deleted = true;
        return { contacts: next.contacts, settings: { ...state.settings, salesStageLabels: next.salesStageLabels, salesStageOrder: next.salesStageOrder } };
      });
      if (deleted) {
        for (const id of movedIds) get().logActivity(id, "stage", `阶段变更 · ${targetLabel}`, `${previousLabel} → ${targetLabel}`);
        get().recomputeStats();
        persist(get, true);
      }
      return deleted;
    },
    updateSettings: (patch) => {
      if (deferDuringRestore(() => get().updateSettings(patch))) return;
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
        if (patch.quickReplies !== undefined || patch.quickReplyPinnedIds !== undefined) {
          next.quickReplyPinnedIds = normalizeQuickReplyIds(next.quickReplyPinnedIds, next.quickReplies, MAX_QUICK_REPLIES);
        }
        if (patch.quickReplies !== undefined || patch.quickReplyRecentIds !== undefined) {
          next.quickReplyRecentIds = normalizeQuickReplyIds(next.quickReplyRecentIds, next.quickReplies, MAX_RECENT_QUICK_REPLIES);
        }
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
      const secretPatch = patch.openaiKey !== undefined || patch.groqKey !== undefined ||
        patch.geminiKey !== undefined || patch.deepseekKey !== undefined || patch.qwenKey !== undefined ||
        patch.zhipuKey !== undefined || patch.openrouterKey !== undefined || patch.customAiKey !== undefined ||
        patch.transcriptionApiKey !== undefined || patch.bridgeToken !== undefined;
      if (getStorageEngine() === "sqlite" && secretPatch && (changed || get().secretSaveStatus === "failed")) {
        void saveCurrentSecrets();
      }
      if (changed) {
        // 分组和销售阶段属于用户明确维护的结构数据，不能等防抖计时器；
        // 否则用户马上刷新时，内存里的新分组会被旧数据库覆盖回来。
        const structureChanged =
          patch.chatFolders !== undefined || patch.chatFolderClones !== undefined ||
          patch.salesStageOrder !== undefined || patch.salesStageLabels !== undefined;
        persist(get, structureChanged);
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
      if (patch.dueAt !== undefined) {
        const current = get().settings.scheduledMessages.find(item => item.id === id);
        const due = Date.parse(patch.dueAt);
        const text = (patch.text ?? current?.text ?? "").trim();
        if (!current || current.status !== "expired" || !Number.isFinite(due) || due <= Date.now() || !text || text.length > 4000) return false;
        patch = { ...patch, dueAt: new Date(due).toISOString(), text, status: "pending", messageId: undefined, error: undefined };
      }
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
        moveChatToFolder: (chatId, id, options) => get().moveChatToFolder(chatId, id, options),
        recomputeStats: () => get().recomputeStats(),
        // importPhonesToFolder 会在批次结束时请求立即保存完整快照。
        persist: (immediate = false) => persist(get, immediate),
        pushToast: (message, tone) => get().pushToast(message, tone),
      });
    },

    exportBackup: async (includeMedia = false) => {
      try {
        await persist(get, true);
        await exportBackupAction(get(), get().pushToast, includeMedia);
      } catch (error) {
        get().pushToast(
          error instanceof Error ? error.message : "导出备份失败",
          "error"
        );
        throw error;
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
