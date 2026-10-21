import type { AppState, SliceContext } from "./types";
import { persist, scheduleStatsRecompute } from "./persist";
import type { Contact } from "@/types/crm";

/**
 * 统一同一客户的 CRM 资料；账号身份和会话 ID 保留，避免跨账号合并丢失冷历史。
 */
export function createContactMergeActions({
  set,
  get,
}: SliceContext): Pick<AppState, "mergeContacts"> {
  return {
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
        source: keep.source || drops.find((d) => d.source)?.source,
        owner: keep.owner || drops.find((d) => d.owner)?.owner,
        notes: keep.notes || drops.find((d) => d.notes)?.notes,
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
