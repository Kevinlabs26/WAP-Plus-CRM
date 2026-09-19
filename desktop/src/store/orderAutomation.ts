import type { Activity, Contact, FollowUp, Message } from "@/types/crm";

function tomorrow(now: Date) {
  const value = new Date(now);
  value.setDate(value.getDate() + 1);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export function applyOrderAutomation(
  contacts: Contact[],
  followUps: FollowUp[],
  activities: Activity[],
  orders: Message[],
  now = new Date()
) {
  let nextContacts = contacts;
  let nextFollowUps = followUps;
  let nextActivities = activities;
  const dueAt = tomorrow(now);

  for (const order of orders) {
    if (
      order.direction !== "in" ||
      order.mediaType !== "order" ||
      !order.contactId
    ) {
      continue;
    }
    const key = order.waMessageId || order.id;
    const activityId = `act-order-${key}`;
    if (nextActivities.some((activity) => activity.id === activityId)) continue;
    const contact = nextContacts.find((item) => item.id === order.contactId);
    if (!contact) continue;

    const activity: Activity = {
      id: activityId,
      contactId: contact.id,
      kind: "system",
      title: "\u6536\u5230 WhatsApp \u8ba2\u5355",
      detail: order.body.slice(0, 2000),
      at: order.sentAt,
    };
    nextActivities = [activity, ...nextActivities].slice(0, 2000);

    const needsQuoting = contact.stage === "new" || contact.stage === "contacted";
    const hasOpenFollowUp = nextFollowUps.some(
      (followUp) => followUp.contactId === contact.id && !followUp.done
    );
    nextContacts = nextContacts.map((item) =>
      item.id === contact.id
        ? {
            ...item,
            stage: needsQuoting ? "quoting" : item.stage,
            nextFollowUpAt: hasOpenFollowUp ? item.nextFollowUpAt : dueAt,
          }
        : item
    );
    if (!hasOpenFollowUp) {
      nextFollowUps = [
        {
          id: `f-order-${key}`,
          contactId: contact.id,
          contactName: contact.name,
          dueAt,
          note: `WhatsApp \u8ba2\u5355\u8ddf\u8fdb \u00b7 ${order.body.split("\n")[0]}`,
          done: false,
        },
        ...nextFollowUps,
      ];
    }
  }

  return {
    contacts: nextContacts,
    followUps: nextFollowUps,
    activities: nextActivities,
  };
}
