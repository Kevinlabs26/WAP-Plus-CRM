import type { AppState, SliceContext } from "./types";
import { persist, scheduleStatsRecompute } from "./persist";
import type { ChatPreview, Contact, Message } from "@/types/crm";

/**
 * 手动合并联系人：把同人的多条 contact 记录合并成一条（keep 保留，drop 吸收）。
 * 数据迁移：chats / messages / followUps / activities 的 contactId 指到 keep；
 * drop 的会话行合并进 keep 的会话，避免留下空壳。
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

      const dropIdSet = new Set(drops.map((d) => d.id));
      const dropChatIds = new Set(
        drops.map((d) => `bridge-chat-${d.id}`)
      );
      const keepChatId = `bridge-chat-${keepId}`;

      // 字段合并：keep 优先，drop 补空；标签取并集
      const merged: Contact = {
        ...keep,
        name:
          keep.name && keep.name !== "未备注联系人"
            ? keep.name
            : drops.find((d) => d.name && d.name !== "未备注联系人")?.name ||
              keep.name,
        phone: keep.phone || drops.find((d) => d.phone)?.phone || "",
        channelAddress:
          keep.channelAddress ||
          drops.find((d) => d.channelAddress)?.channelAddress,
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
        accountId: keep.accountId || drops[0]?.accountId,
        boundPhoneId: keep.boundPhoneId || drops[0]?.boundPhoneId,
      };

      const remapChatId = (id: string) =>
        dropChatIds.has(id) ? keepChatId : id;

      const nextMessages: Message[] = state.messages.map((m) => {
        if (!dropIdSet.has(m.contactId as string)) return m;
        const chatId = remapChatId(m.chatId as string);
        return { ...m, contactId: keepId, chatId };
      });
      const nextChats: ChatPreview[] = state.chats.flatMap((ch) => {
        if (!dropIdSet.has(ch.contactId as string)) return [ch];
        return [{ ...ch, contactId: keepId, id: remapChatId(ch.id) }];
      });
      const nextFollowUps = state.followUps.map((f) =>
        dropIdSet.has(f.contactId as string) ? { ...f, contactId: keepId } : f
      );
      const nextActivities = state.activities.map((a) =>
        dropIdSet.has(a.contactId as string) ? { ...a, contactId: keepId } : a
      );
      const nextContacts = state.contacts
        .filter((c) => !dropIdSet.has(c.id))
        .map((c) => (c.id === keepId ? merged : c));

      set({
        contacts: nextContacts,
        chats: nextChats,
        messages: nextMessages,
        followUps: nextFollowUps,
        activities: nextActivities,
      });
      scheduleStatsRecompute(get);
      persist(get);
      return true;
    },
  };
}