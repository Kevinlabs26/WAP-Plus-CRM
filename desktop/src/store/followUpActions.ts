import type { Contact, FollowUp } from "@/types/crm";

type FollowUpState = {
  contacts: Contact[];
  followUps: FollowUp[];
};

type FollowUpDeps = {
  getState: () => FollowUpState;
  setState: (
    updater: (state: FollowUpState) => Partial<FollowUpState>
  ) => void;
  logActivity: (
    contactId: string,
    title: string,
    detail?: string
  ) => void;
  recomputeStats: () => void;
  persist: () => void;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
};

export function createFollowUpActions({
  getState,
  setState,
  logActivity,
  recomputeStats,
  persist,
  pushToast,
}: FollowUpDeps) {
  const finish = () => {
    recomputeStats();
    persist();
  };

  const scheduleFollowUp = (
    contactId: string,
    dueAtRaw: string,
    note?: string
  ) => {
    const contact = getState().contacts.find((item) => item.id === contactId);
    if (!contact) return null;

    const dueAt = String(dueAtRaw || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(dueAt)) {
      pushToast("跟进时间格式无效", "error");
      return null;
    }

    const finalNote = (note && note.trim()) || `跟进 · ${contact.name}`;
    const existing = getState().followUps.find(
      (item) => !item.done && item.contactId === contactId
    );

    if (existing) {
      setState((state) => ({
        followUps: state.followUps.map((item) =>
          item.id === existing.id
            ? { ...item, dueAt, note: finalNote, contactName: contact.name }
            : item
        ),
        contacts: state.contacts.map((item) =>
          item.id === contactId ? { ...item, nextFollowUpAt: dueAt } : item
        ),
      }));
      logActivity(contactId, "改期跟进", `${dueAt} · ${finalNote}`);
    } else {
      setState((state) => ({
        followUps: [
          {
            id: `f-${Date.now()}`,
            contactId,
            contactName: contact.name,
            dueAt,
            note: finalNote,
            done: false,
          },
          ...state.followUps,
        ],
        contacts: state.contacts.map((item) =>
          item.id === contactId ? { ...item, nextFollowUpAt: dueAt } : item
        ),
      }));
      logActivity(contactId, "创建跟进", `${dueAt} · ${finalNote}`);
    }

    finish();
    return { dueAt };
  };

  const scheduleFollowUps = (
    contactIds: string[],
    dueAtRaw: string,
    note?: string
  ) => {
    const dueAt = String(dueAtRaw || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(dueAt)) {
      pushToast("跟进时间格式无效", "error");
      return 0;
    }
    const idSet = new Set(contactIds);
    const selected = getState().contacts.filter((item) => idSet.has(item.id));
    if (!selected.length) return 0;
    const selectedById = new Map(selected.map((item) => [item.id, item]));
    const existingIds = new Set(
      getState().followUps
        .filter((item) => !item.done && selectedById.has(item.contactId))
        .map((item) => item.contactId)
    );
    const createdAt = Date.now();

    setState((state) => ({
      contacts: state.contacts.map((item) =>
        selectedById.has(item.id) ? { ...item, nextFollowUpAt: dueAt } : item
      ),
      followUps: [
        ...selected
          .filter((item) => !existingIds.has(item.id))
          .map((item, index) => ({
            id: `f-${createdAt}-${index}`,
            contactId: item.id,
            contactName: item.name,
            dueAt,
            note: note?.trim() || `跟进 · ${item.name}`,
            done: false,
          })),
        ...state.followUps.map((item) => {
          const contact = selectedById.get(item.contactId);
          return contact && !item.done
            ? {
                ...item,
                dueAt,
                contactName: contact.name,
                ...(note?.trim() ? { note: note.trim() } : {}),
              }
            : item;
        }),
      ],
    }));
    // ponytail: 批量操作不逐条写活动日志，避免大量联系人触发重复持久化。
    finish();
    return selected.length;
  };

  return {
    toggleFollowUp(id: string) {
      const followUp = getState().followUps.find((item) => item.id === id);
      if (!followUp) return;
      setState((state) => {
        const followUps = state.followUps.map((item) =>
          item.id === id ? { ...item, done: !item.done } : item
        );
        const nextDueAt = followUps
          .filter((item) => item.contactId === followUp.contactId && !item.done)
          .map((item) => item.dueAt)
          .sort()[0];
        return {
          followUps,
          contacts: state.contacts.map((contact) =>
            contact.id === followUp.contactId
              ? { ...contact, nextFollowUpAt: nextDueAt }
              : contact
          ),
        };
      });
      logActivity(
        followUp.contactId,
        followUp.done ? "重新打开跟进" : "完成跟进",
        followUp.note
      );
      finish();
    },

    addFollowUp(input: Omit<FollowUp, "id" | "done">) {
      scheduleFollowUp(input.contactId, input.dueAt, input.note);
    },

    scheduleFollowUp,

    scheduleFollowUps,

    scheduleTomorrowFollowUp(contactId: string, note?: string) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
      const day = String(tomorrow.getDate()).padStart(2, "0");
      return scheduleFollowUp(
        contactId,
        `${year}-${month}-${day}T10:00`,
        note || undefined
      );
    },
  };
}
