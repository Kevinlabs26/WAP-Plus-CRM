import type { Contact } from "@/types/crm";
import { contactSendablePhone } from "./broadcastTemplate.ts";
import { contactInView } from "../store/accountScope.ts";

/** Copy personal details only; conversations and protocol identities stay with their original account. */
export function contactCopiesForAccount(selected: Contact[], existing: Contact[], accountId: string,
  savedPhones: string[], liveAccountId?: string): Omit<Contact, "id">[] {
  if (!accountId) throw new Error("Select a target account");
  const saved = new Set(savedPhones);
  const known = new Set(existing.filter(contact => contactInView(contact, {type: "account", accountId}, liveAccountId, liveAccountId))
    .map(contactSendablePhone).filter(Boolean));
  const copies: Omit<Contact, "id">[] = [];
  for (const contact of selected) {
    const phone = contactSendablePhone(contact);
    if (!phone || !saved.has(phone) || known.has(phone)) continue;
    known.add(phone);
    copies.push({ name: contact.name.trim() || phone, phone, accountId, stage: contact.stage,
      tags: [...contact.tags], notes: contact.notes, company: contact.company,
      preferredLang: contact.preferredLang, timeZone: contact.timeZone, source: "account-save",
      channelAddress: `${phone.slice(1)}@s.whatsapp.net` });
  }
  return copies;
}
