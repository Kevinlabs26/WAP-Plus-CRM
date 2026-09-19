import { resolveSalesStageLabel } from "@/lib/contactWorkflow";
import type { SliceContext } from "./types";
import { persist, scheduleStatsRecompute } from "./persist";
import { createChatFolderActions } from "./chatFolderActions";
import { createFollowUpActions } from "./followUpActions";
import { createActivityActions } from "./activityActions";
import { createContactActions } from "./contactActions";
import { createContactCreationActions } from "./contactCreationActions";
import { createContactWorkspaceActions } from "./contactWorkspaceActions";
import { createSavedMessageMetadataActions } from "./savedMessageMetadataActions";
import { createSaveMessageAction } from "./saveMessageAction";
import { createContactMergeActions } from "./contactMergeActions";

export function createActionMixins({ set, get }: SliceContext) {
  const chatFolderActions = createChatFolderActions({
    getSettings: () => get().settings,
    updateSettings: (patch) => get().updateSettings(patch),
    pushToast: (message, tone) => get().pushToast(message, tone),
  });
  const followUpActions = createFollowUpActions({
    getState: () => ({ contacts: get().contacts, followUps: get().followUps }),
    setState: (updater) => set((state) => updater(state)),
    logActivity: (contactId, title, detail) =>
      get().logActivity(contactId, "follow_up", title, detail),
    recomputeStats: () => get().recomputeStats(),
    persist: () => persist(get),
    pushToast: (message, tone) => get().pushToast(message, tone),
  });
  const activityActions = createActivityActions({
    getActivities: () => get().activities,
    setActivities: (updater) =>
      set((state) => ({ activities: updater(state.activities) })),
    persist: () => persist(get),
  });
  const contactActions = createContactActions({
    getContacts: () => get().contacts,
    getPhones: () => get().phones,
    setState: (updater) => set((state) => updater(state)),
    setSelectedPhone: (id) => set({ selectedPhoneId: id }),
    logActivity: (contactId, kind, title, detail) =>
      get().logActivity(contactId, kind, title, detail),
    stageLabel: (stage) =>
      resolveSalesStageLabel(stage, get().settings.salesStageLabels),
    // 统计重算很重：改联系人（含 preferredLang）时不要同步跑 calcStats，
    // 等主线程空闲再算，别拖慢选完语言后点回输入框的光标
    recomputeStats: () => scheduleStatsRecompute(get),
    persist: () => persist(get),
  });
  const contactCreationActions = createContactCreationActions({
    setState: (updater) => set((state) => updater(state)),
    setSelection: (contactId, chatId) =>
      set({ selectedContactId: contactId, selectedChatId: chatId }),
    setActiveChats: () => set({ activeNav: "chats" }),
    logActivity: (contactId, detail) =>
      get().logActivity(contactId, "contact_created", "创建客户", detail),
    recomputeStats: () => get().recomputeStats(),
    persist: (immediate = false) => persist(get, immediate),
  });
  const contactWorkspaceActions = createContactWorkspaceActions({
    getState: () => ({
      contacts: get().contacts,
      chats: get().chats,
      settings: get().settings,
      selectedPhoneId: get().selectedPhoneId,
      selectedContactId: get().selectedContactId,
      selectedChatId: get().selectedChatId,
      selectedThreadAccount: get().selectedThreadAccount,
      activeNav: "chats",
      focusMessageId: get().focusMessageId,
      draftReplyByChatId: get().draftReplyByChatId,
      crmPanelCollapsed: get().crmPanelCollapsed,
    }),
    setState: (patch) => set(patch),
    scheduleStatsRecompute: () => scheduleStatsRecompute(get),
    persist: () => persist(get),
  });
  const savedMessageMetadataActions = createSavedMessageMetadataActions({
    getMessages: () => get().messages,
    setMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),
    persist: () => persist(get),
  });
  const saveMessageAction = createSaveMessageAction({
    getMessages: () => get().messages,
    getChats: () => get().chats,
    getContacts: () => get().contacts,
    setState: (patch) => set(patch),
    persist: () => persist(get),
  });
  const contactMergeActions = createContactMergeActions({ set, get });

  return {
    chatFolderActions,
    followUpActions,
    activityActions,
    contactActions,
    contactCreationActions,
    contactWorkspaceActions,
    savedMessageMetadataActions,
    saveMessageAction,
    contactMergeActions,
  };
}
