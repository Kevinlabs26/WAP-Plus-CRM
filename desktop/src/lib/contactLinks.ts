import { escapeCsvCell } from "./csv.ts";
import { MAX_PASTED_CONTACTS, normalizePastedPhone, type PastedContact } from "./pastedContacts.ts";

export interface ContactLinkRule { prefix: string; start: number; message: string }
export interface ContactLinkEntry { name: string; phone: string; url: string }
const singleLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();

export function buildContactLinks(contacts: readonly PastedContact[], rule: ContactLinkRule): ContactLinkEntry[] {
  if (!Number.isSafeInteger(rule.start) || rule.start < 1 || rule.start + contacts.length > 1_000_000_000) throw new Error("start");
  if (contacts.length > MAX_PASTED_CONTACTS) throw new Error("limit");
  if (rule.message.length > 2000) throw new Error("length");
  const query = rule.message.trim() ? `?text=${encodeURIComponent(rule.message.trim())}` : "";
  let size = 0;
  return contacts.map((contact, index) => {
    if (normalizePastedPhone(contact.phone) !== contact.phone) throw new Error("phone");
    const name = [`${rule.start + index}.`, singleLine(rule.prefix), singleLine(contact.name)].filter(Boolean).join(" ");
    const url = `https://wa.me/${contact.phone.slice(1)}${query}`;
    size += name.length + url.length + 3;
    if (size > 1_000_000) throw new Error("length");
    return { name, phone: contact.phone, url };
  });
}

export function contactLinksText(entries: readonly ContactLinkEntry[]): string {
  return entries.map(entry => `${entry.name}\n${entry.url}`).join("\n\n");
}

export function contactLinksCsv(entries: readonly ContactLinkEntry[]): string {
  return "\uFEFF" + ["Name,Phone,Link", ...entries.map(entry => [escapeCsvCell(entry.name), escapeCsvCell(entry.phone, true), escapeCsvCell(entry.url)].join(","))].join("\r\n");
}
