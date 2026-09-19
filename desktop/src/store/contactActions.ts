import type { Activity, ChatPreview, Contact, FollowUp, PhoneDevice } from "@/types/crm";

type ContactState = {
  contacts: Contact[];
  chats: ChatPreview[];
  followUps: FollowUp[];
  activities: Activity[];
};

type ContactDeps = {
  getContacts: () => Contact[];
  getPhones: () => PhoneDevice[];
  setState: (updater: (state: ContactState) => Partial<ContactState>) => void;
  setSelectedPhone: (id: string) => void;
  logActivity: (
    contactId: string,
    kind: "phone_bound" | "stage" | "note",
    title: string,
    detail?: string
  ) => void;
  stageLabel: (stage: string) => string;
  recomputeStats: () => void;
  persist: () => void;
};

export function createContactActions({
  getContacts,
  getPhones,
  setState,
  setSelectedPhone,
  logActivity,
  stageLabel,
  recomputeStats,
  persist,
}: ContactDeps) {
  return {
    deleteContactLocal(id: string) {
      setState((state) => ({
        contacts: state.contacts.filter((contact) => contact.id !== id),
        followUps: state.followUps.filter((followUp) => followUp.contactId !== id),
        activities: state.activities.filter((activity) => activity.contactId !== id),
      }));
      recomputeStats();
      persist();
    },
    updateContact(id: string, patch: Partial<Contact>) {
      const previous = getContacts().find((contact) => contact.id === id);
      const nextName = patch.name;
      setState((state) => {
        const contacts = state.contacts.map((contact) =>
          contact.id === id ? { ...contact, ...patch } : contact
        );
        // 只改联系人（preferredLang/备注/标签等）时别动 chats/followUps 引用，
        // 否则侧栏排序、跟进列表全部重渲——这是「选翻译语言后点回输入框光标迟出」的主因
        const chats =
          nextName === undefined
            ? state.chats
            : state.chats.map((chat) =>
                chat.contactId === id ? { ...chat, contactName: nextName } : chat
              );
        const followUps =
          nextName === undefined
            ? state.followUps
            : state.followUps.map((followUp) =>
                followUp.contactId === id
                  ? { ...followUp, contactName: nextName }
                  : followUp
              );
        return { contacts, chats, followUps };
      });

      if (patch.boundPhoneId) {
        setSelectedPhone(patch.boundPhoneId);
        const phone = getPhones().find((item) => item.id === patch.boundPhoneId);
        logActivity(
          id,
          "phone_bound",
          "绑定手机",
          phone ? `${phone.name} · ${phone.remark}` : patch.boundPhoneId
        );
      }

      if (patch.stage && previous && patch.stage !== previous.stage) {
        logActivity(
          id,
          "stage",
          `阶段变更 · ${stageLabel(patch.stage)}`,
          previous.stage
            ? `${stageLabel(previous.stage)} → ${stageLabel(patch.stage)}`
            : undefined
        );
      }

      if (patch.notes !== undefined && previous && patch.notes !== previous.notes) {
        logActivity(id, "note", "更新备注", patch.notes?.slice(0, 160));
      }

      if (patch.tags && previous) {
        const before = new Set(previous.tags || []);
        const after = new Set(patch.tags || []);
        const added = [...after].filter((tag) => !before.has(tag));
        const removed = [...before].filter((tag) => !after.has(tag));
        if (added.length || removed.length) {
          const detail = [
            added.length ? `+${added.join("、")}` : "",
            removed.length ? `-${removed.join("、")}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          logActivity(id, "note", "更新标签", detail || undefined);
        }
      }

      recomputeStats();
      persist();
    },
    /** 批量更新多个联系人（一次 setState；仅记录补名/阶段/标签变更活动） */
    batchUpdateContacts(
      ids: string[],
      patch: Partial<Contact>,
      opts?: {
        activityTitle?: string;
        /** 追加标签：对每个联系人合并（区别于 patch.tags 覆盖） */
        mergeTags?: string[];
      }
    ) {
      if (!ids.length) return 0;
      const idSet = new Set(ids);
      const prevById = new Map(
        getContacts().filter((c) => idSet.has(c.id)).map((c) => [c.id, c])
      );
      const mergeTags = opts?.mergeTags?.filter(Boolean);
      const nextName = patch.name;
      const finalTagsOf = (prev: Contact) => {
        if (!mergeTags?.length) return patch.tags;
        return Array.from(new Set([...(prev.tags || []), ...mergeTags]));
      };
      setState((state) => {
        const contacts = state.contacts.map((contact) =>
          idSet.has(contact.id)
            ? {
                ...contact,
                ...patch,
                ...(mergeTags?.length
                  ? { tags: finalTagsOf(contact) }
                  : {}),
              }
            : contact
        );
        const chats =
          nextName === undefined
            ? state.chats
            : state.chats.map((chat) =>
                chat.contactId && idSet.has(chat.contactId)
                  ? { ...chat, contactName: nextName }
                  : chat
              );
        const followUps =
          nextName === undefined
            ? state.followUps
            : state.followUps.map((followUp) =>
                followUp.contactId && idSet.has(followUp.contactId)
                  ? { ...followUp, contactName: nextName }
                  : followUp
              );
        return { contacts, chats, followUps };
      });
      const title = opts?.activityTitle || "批量更新";
      if (patch.stage) {
        for (const prev of prevById.values()) {
          if (prev.stage !== patch.stage) {
            logActivity(
              prev.id,
              "stage",
              `阶段变更 · ${stageLabel(patch.stage)}`,
              `${stageLabel(prev.stage)} → ${stageLabel(patch.stage)}`
            );
          }
        }
      }
      if (mergeTags?.length) {
        for (const prev of prevById.values()) {
          const added = mergeTags.filter((tag) => !(prev.tags || []).includes(tag));
          if (added.length) {
            logActivity(
              prev.id,
              "note",
              title,
              added.map((tag) => `+${tag}`).join("、")
            );
          }
        }
      } else if (patch.tags) {
        for (const prev of prevById.values()) {
          const before = new Set(prev.tags || []);
          const after = new Set(patch.tags);
          const added = [...after].filter((tag) => !before.has(tag));
          const removed = [...before].filter((tag) => !after.has(tag));
          if (added.length || removed.length) {
            const detail = [
              added.length ? `+${added.join("、")}` : "",
              removed.length ? `-${removed.join("、")}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            logActivity(prev.id, "note", title, detail || undefined);
          }
        }
      }
      recomputeStats();
      persist();
      return ids.length;
    },
  };
}
