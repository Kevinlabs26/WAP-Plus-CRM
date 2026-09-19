import type { Activity, ActivityKind } from "@/types/crm";

type ActivityDeps = {
  getActivities: () => Activity[];
  setActivities: (updater: (activities: Activity[]) => Activity[]) => void;
  persist: () => void;
};

export function createActivityActions({
  getActivities,
  setActivities,
  persist,
}: ActivityDeps) {
  return {
    logActivity(
      contactId: string,
      kind: ActivityKind,
      title: string,
      detail?: string
    ) {
      if (!contactId) return;
      const activity: Activity = {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contactId,
        kind,
        title,
        detail,
        at: new Date().toISOString(),
      };
      setActivities((activities) => [activity, ...activities].slice(0, 2000));
      persist();
    },

    activitiesForContact(contactId: string) {
      return getActivities()
        .filter((activity) => activity.contactId === contactId)
        .sort((a, b) => b.at.localeCompare(a.at));
    },
  };
}
