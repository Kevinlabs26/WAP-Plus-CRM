type ComparableLabel = {
  id: string;
  name: string;
  color: number;
  predefinedId?: string;
};

export function sameWhatsAppLabels(
  previousLabels: ComparableLabel[],
  previousChatLabelIds: Record<string, string[]>,
  labels: ComparableLabel[],
  chatLabelIds: Record<string, string[]>
): boolean {
  if (previousLabels.length !== labels.length) return false;
  for (let i = 0; i < labels.length; i++) {
    const a = previousLabels[i]!;
    const b = labels[i]!;
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.color !== b.color ||
      a.predefinedId !== b.predefinedId
    ) return false;
  }
  const keys = Object.keys(chatLabelIds);
  if (Object.keys(previousChatLabelIds).length !== keys.length) return false;
  return keys.every((key) => {
    const a = previousChatLabelIds[key];
    const b = chatLabelIds[key];
    return !!a && a.length === b.length && a.every((id, i) => id === b[i]);
  });
}

type LabelContact = {
  id: string;
  accountId?: string;
  phone?: string;
  channelAddress?: string;
  tags: string[];
};

function whatsappContactKeys(contact: LabelContact): string[] {
  const digits = (contact.phone || "").replace(/\D/g, "");
  return Array.from(
    new Set(
      [
        contact.channelAddress,
        contact.id.includes("@") ? contact.id : "",
        digits ? `${digits}@s.whatsapp.net` : "",
      ]
        .filter(Boolean)
        .map((value) => String(value).replace(/@c\.us$/, "@s.whatsapp.net"))
    )
  );
}

export function applyWhatsAppLabelsToContacts<T extends LabelContact>(
  contacts: readonly T[],
  accountId: string,
  previousLabels: ComparableLabel[],
  labels: ComparableLabel[],
  chatLabelIds: Record<string, string[]>
): T[] {
  const previousNames = new Set(
    previousLabels.map((label) => label.name).filter(Boolean)
  );
  const namesById = new Map(labels.map((label) => [label.id, label.name]));
  return contacts.map((contact) => {
    if (contact.accountId !== accountId) return contact;
    const assignedIds = whatsappContactKeys(contact).flatMap(
      (key) => chatLabelIds[key] || []
    );
    const assignedNames = assignedIds
      .map((id) => namesById.get(id))
      .filter((name): name is string => Boolean(name));
    // ponytail: 标签名作为来源标识；需要同名本地/WhatsApp 标签并存时再引入 tag id。
    const localTags = contact.tags.filter((tag) => !previousNames.has(tag));
    const tags = Array.from(new Set([...localTags, ...assignedNames]));
    return tags.join("\0") === contact.tags.join("\0")
      ? contact
      : { ...contact, tags };
  });
}
