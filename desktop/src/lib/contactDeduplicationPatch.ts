import type {
  Activity,
  ChatPreview,
  Contact,
  FollowUp,
  Message,
  ScheduledMessage,
} from "../types/crm.ts";
import { chatHasMessageHistory } from "./chatActivity.ts";
import {
  mergeDuplicateContactFields,
  type DuplicateContactGroup,
} from "./contactDeduplication.ts";

export interface DeduplicationBroadcastItem {
  contactId?: string;
  contactName?: string;
  [key: string]: unknown;
}

export interface DeduplicationBroadcastCampaign {
  id: string;
  contactIds?: string[];
  items?: DeduplicationBroadcastItem[];
  [key: string]: unknown;
}

export interface DeduplicationStateInput {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  broadcastCampaigns: DeduplicationBroadcastCampaign[];
  scheduledMessages: ScheduledMessage[];
  selectedContactId: string | null;
  selectedChatId: string | null;
  protectedChatIds?: ReadonlySet<string>;
}

export interface ContactDeduplicationSummary {
  groupsMerged: number;
  removedContacts: number;
  removedEmptyChats: number;
}

export interface ContactDeduplicationPatch {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
  activities: Activity[];
  broadcastCampaigns: DeduplicationBroadcastCampaign[];
  scheduledMessages: ScheduledMessage[];
  selectedContactId: string | null;
  selectedChatId: string | null;
  summary: ContactDeduplicationSummary;
}

interface ShellMergeFlags {
  unread: number;
  pinned: boolean;
  archived: boolean;
}

function collectRemovableEmptyChats(
  chats: ChatPreview[],
  messages: Message[],
  keeperById: Map<string, Contact>,
  dropToKeeperId: Map<string, string>,
  protectedIds: ReadonlySet<string>
): {
  droppedChatToKeeperChatId: Map<string, string>;
  mergedShellFlags: Map<string, ShellMergeFlags>;
} {
  const messageChatIds = new Set(messages.map((message) => message.chatId));
  const keeperChatByContactId = new Map<string, ChatPreview>();
  for (const chat of chats) {
    if (keeperById.has(chat.contactId) && !keeperChatByContactId.has(chat.contactId)) {
      keeperChatByContactId.set(chat.contactId, chat);
    }
  }

  const droppedChatToKeeperChatId = new Map<string, string>();
  const mergedShellFlags = new Map<string, ShellMergeFlags>();
  for (const chat of chats) {
    const mappedKeeperId = dropToKeeperId.get(chat.contactId);
    if (!mappedKeeperId) continue;
    const keeperChat = keeperChatByContactId.get(mappedKeeperId);
    const isRemovableShell =
      Boolean(keeperChat) &&
      !chat.historyRemapBlocked &&
      !chatHasMessageHistory(chat) &&
      !messageChatIds.has(chat.id) &&
      !protectedIds.has(chat.id);
    if (!isRemovableShell || !keeperChat) continue;
    droppedChatToKeeperChatId.set(chat.id, keeperChat.id);
    const previous = mergedShellFlags.get(keeperChat.id) || {
      unread: keeperChat.unread || 0,
      pinned: Boolean(keeperChat.pinned),
      archived: Boolean(keeperChat.archived),
    };
    mergedShellFlags.set(keeperChat.id, {
      unread: Math.max(previous.unread, chat.unread || 0),
      pinned: previous.pinned || Boolean(chat.pinned),
      archived: previous.archived && Boolean(chat.archived),
    });
  }

  return { droppedChatToKeeperChatId, mergedShellFlags };
}

function remapRelatedCollections(
  state: DeduplicationStateInput,
  keeperById: Map<string, Contact>,
  dropToKeeperId: Map<string, string>
) {
  const nextMessages = state.messages.map((message) => {
    const mappedContactId = message.contactId ? dropToKeeperId.get(message.contactId) : undefined;
    return mappedContactId ? { ...message, contactId: mappedContactId } : message;
  });

  const nextFollowUps = state.followUps.map((followUp) => {
    const mappedContactId = dropToKeeperId.get(followUp.contactId);
    if (!mappedContactId) return followUp;
    const keeper = keeperById.get(mappedContactId);
    return { ...followUp, contactId: mappedContactId, contactName: keeper?.name || followUp.contactName };
  });

  const nextActivities = state.activities.map((activity) => {
    const mappedContactId = dropToKeeperId.get(activity.contactId);
    return mappedContactId ? { ...activity, contactId: mappedContactId } : activity;
  });

  const nextCampaigns = (state.broadcastCampaigns || []).map((campaign) => {
    const hasContactIds =
      Array.isArray(campaign.contactIds) &&
      campaign.contactIds.some((id) => dropToKeeperId.has(id));
    const hasItemMatch =
      Array.isArray(campaign.items) &&
      campaign.items.some((item) => Boolean(item.contactId && dropToKeeperId.has(item.contactId)));
    if (!hasContactIds && !hasItemMatch) return campaign;
    return {
      ...campaign,
      ...(hasContactIds && campaign.contactIds
        ? {
            contactIds: Array.from(
              new Set(campaign.contactIds.map((id) => dropToKeeperId.get(id) || id))
            ),
          }
        : {}),
      ...(hasItemMatch && campaign.items
        ? {
            items: campaign.items.map((item) => {
              const mappedContactId = item.contactId ? dropToKeeperId.get(item.contactId) : undefined;
              if (!mappedContactId) return item;
              const keeper = keeperById.get(mappedContactId);
              return {
                ...item,
                contactId: mappedContactId,
                contactName: keeper?.name || item.contactName,
              };
            }),
          }
        : {}),
    };
  });

  const nextScheduledMessages = state.scheduledMessages.map((scheduled) => {
    const mappedContactId = dropToKeeperId.get(scheduled.contactId);
    if (!mappedContactId) return scheduled;
    const keeper = keeperById.get(mappedContactId);
    return { ...scheduled, contactId: mappedContactId, contactName: keeper?.name || scheduled.contactName };
  });

  return { nextMessages, nextFollowUps, nextActivities, nextCampaigns, nextScheduledMessages };
}

/**
 * Compute an immutable state patch that merges duplicate contacts into their keepers.
 * Populated chats are never deleted; only empty duplicate chat shells are pruned.
 */
export function buildContactDeduplicationPatch(
  state: DeduplicationStateInput,
  groups: DuplicateContactGroup[]
): ContactDeduplicationPatch {
  if (!groups.length) {
    return {
      contacts: state.contacts,
      chats: state.chats,
      messages: state.messages,
      followUps: state.followUps,
      activities: state.activities,
      broadcastCampaigns: state.broadcastCampaigns,
      scheduledMessages: state.scheduledMessages,
      selectedContactId: state.selectedContactId,
      selectedChatId: state.selectedChatId,
      summary: { groupsMerged: 0, removedContacts: 0, removedEmptyChats: 0 },
    };
  }

  const keeperById = new Map<string, Contact>();
  const dropToKeeperId = new Map<string, string>();
  for (const group of groups) {
    const mergedKeeper = mergeDuplicateContactFields(
      group.keeper,
      group.duplicates,
      group.normalizedPhone
    );
    keeperById.set(mergedKeeper.id, mergedKeeper);
    for (const duplicate of group.duplicates) {
      dropToKeeperId.set(duplicate.id, mergedKeeper.id);
    }
  }

  const nextContacts = state.contacts
    .filter((contact) => !dropToKeeperId.has(contact.id))
    .map((contact) => keeperById.get(contact.id) || contact);

  const { droppedChatToKeeperChatId, mergedShellFlags } = collectRemovableEmptyChats(
    state.chats,
    state.messages,
    keeperById,
    dropToKeeperId,
    state.protectedChatIds || new Set<string>()
  );

  const nextChats = state.chats
    .filter((chat) => !droppedChatToKeeperChatId.has(chat.id))
    .map((chat) => {
      const targetKeeperId = dropToKeeperId.get(chat.contactId) || chat.contactId;
      const keeper = keeperById.get(targetKeeperId);
      const flags = mergedShellFlags.get(chat.id);
      if (!keeper && !flags) return chat;
      return {
        ...chat,
        contactId: targetKeeperId,
        contactName: keeper?.name || chat.contactName,
        ...(flags ? { unread: flags.unread, pinned: flags.pinned, archived: flags.archived } : {}),
      };
    });

  const remapped = remapRelatedCollections(state, keeperById, dropToKeeperId);

  return {
    contacts: nextContacts,
    chats: nextChats,
    messages: remapped.nextMessages,
    followUps: remapped.nextFollowUps,
    activities: remapped.nextActivities,
    broadcastCampaigns: remapped.nextCampaigns,
    scheduledMessages: remapped.nextScheduledMessages,
    selectedContactId: state.selectedContactId
      ? dropToKeeperId.get(state.selectedContactId) || state.selectedContactId
      : state.selectedContactId,
    selectedChatId: state.selectedChatId
      ? droppedChatToKeeperChatId.get(state.selectedChatId) || state.selectedChatId
      : state.selectedChatId,
    summary: {
      groupsMerged: groups.length,
      removedContacts: dropToKeeperId.size,
      removedEmptyChats: droppedChatToKeeperChatId.size,
    },
  };
}
