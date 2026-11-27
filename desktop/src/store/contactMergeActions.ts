import type { AppState, SliceContext } from "./types";
import { persist, scheduleStatsRecompute } from "./persist";
import { protectedGroupChatIds } from "./chatDuplicateMerge";
import { findDuplicateContactGroups } from "@/lib/contactDeduplication";
import { buildContactDeduplicationPatch } from "@/lib/contactDeduplicationPatch";
import type { Contact } from "@/types/crm";

/**
 * 统一同一客户的 CRM 资料；账号身份和会话 ID 保留，避免跨账号合并丢失冷历史。
 */
export function createContactMergeActions({
  set,
  get,
}: SliceContext): Pick<AppState, "mergeContacts" | "dedupeAccountContacts"> {
  return {
    dedupeAccountContacts(accountId?: string) {
      const state = get();
      const liveAccountId =
        state.settings.liveBaileysAccountId || state.settings.activeAccountId;
      const groups = findDuplicateContactGroups({
        contacts: state.contacts,
        chats: state.chats,
        messages: state.messages,
        accountId,
        liveAccountId,
      });
      if (!groups.length) {
        return { groupsMerged: 0, removedContacts: 0, removedEmptyChats: 0 };
      }
      const protectedChatIds = protectedGroupChatIds(
        state.settings,
        state.draftReplyByChatId
      );
      const patch = buildContactDeduplicationPatch(
        {
          contacts: state.contacts,
          chats: state.chats,
          messages: state.messages,
          followUps: state.followUps,
          activities: state.activities,
          broadcastCampaigns: state.broadcastCampaigns as unknown as Array<{
            id: string;
            contactIds?: string[];
            items?: Array<{ contactId?: string; contactName?: string; [key: string]: unknown }>;
            [key: string]: unknown;
          }>,
          scheduledMessages: state.scheduledMessages,
          selectedContactId: state.selectedContactId,
          selectedChatId: state.selectedChatId,
          protectedChatIds,
        },
        groups
      );
      set({
        contacts: patch.contacts,
        chats: patch.chats,
        messages: patch.messages,
        followUps: patch.followUps,
        activities: patch.activities,
        broadcastCampaigns:
          patch.broadcastCampaigns as unknown as AppState["broadcastCampaigns"],
        scheduledMessages: patch.scheduledMessages,
        selectedContactId: patch.selectedContactId,
        selectedChatId: patch.selectedChatId,
      });
      scheduleStatsRecompute(get);
      persist(get);
      return patch.summary;
    },
    mergeContacts(keepId: string, dropIds: string[]): boolean {
      if (!keepId || !dropIds.length) return false;
      const dropSet = new Set(dropIds);
      if (dropSet.has(keepId)) return false;
      const state = get();
      const keep = state.contacts.find((c) => c.id === keepId);
      const drops = state.contacts.filter((c) => dropSet.has(c.id));
      if (!keep || !drops.length) return false;

      const ids = new Set([keepId, ...drops.map((d) => d.id)]);

      // 字段合并：keep 优先，drop 补空；标签取并集
      const merged: Partial<Contact> = {
        name:
          keep.name && keep.name !== "未备注联系人"
            ? keep.name
            : drops.find((d) => d.name && d.name !== "未备注联系人")?.name ||
              keep.name,
        phone: keep.phone || drops.find((d) => d.phone)?.phone || "",
        company: keep.company || drops.find((d) => d.company)?.company,
        country: keep.country || drops.find((d) => d.country)?.country,
        timeZone: keep.timeZone || drops.find((d) => d.timeZone)?.timeZone,
        source: keep.source || drops.find((d) => d.source)?.source,
        owner: keep.owner || drops.find((d) => d.owner)?.owner,
        notes: keep.notes || drops.find((d) => d.notes)?.notes,
        aiChatInstructions:
          keep.aiChatInstructions ||
          drops.find((d) => d.aiChatInstructions)?.aiChatInstructions,
        aiSummary:
          keep.aiSummary || drops.find((d) => d.aiSummary)?.aiSummary,
        aiIntent: keep.aiIntent || drops.find((d) => d.aiIntent)?.aiIntent,
        aiNextStep:
          keep.aiNextStep || drops.find((d) => d.aiNextStep)?.aiNextStep,
        tags: Array.from(
          new Set([...(keep.tags || []), ...drops.flatMap((d) => d.tags || [])])
        ),
        // 合并键：phone / channelAddress 决定 personKey 指向
        personKey: keep.personKey || drops.find((d) => d.personKey)?.personKey,
      };

      set({
        contacts: state.contacts.map((contact) => ids.has(contact.id) ? { ...contact, ...merged } : contact),
        chats: state.chats.map((chat) => ids.has(chat.contactId) ? { ...chat, contactName: merged.name || chat.contactName } : chat),
        followUps: state.followUps.map((followUp) => ids.has(followUp.contactId) ? { ...followUp, contactName: merged.name || followUp.contactName } : followUp),
      });
      scheduleStatsRecompute(get);
      persist(get);
      return true;
    },
  };
}
