import { normalizePastedPhone as phoneNumber, type PastedContact } from "./pastedContacts.ts";
export { MAX_PASTED_CONTACTS as MAX_VCF_CONTACTS, MAX_PASTED_CONTACT_TEXT_LENGTH as MAX_VCF_TEXT_LENGTH, parsePastedContacts as parseVcfContacts } from "./pastedContacts.ts";
import { MAX_PASTED_CONTACTS as MAX_VCF_CONTACTS } from "./pastedContacts.ts";
export type VcfContact = PastedContact;
export interface VcfNameRule { prefix: string; suffix: string; lastFour: boolean }

export function vcfContactName(contact: VcfContact, rule: VcfNameRule): string {
  return [rule.prefix.trim(), contact.name.trim(), rule.suffix.trim(), rule.lastFour ? contact.phone.slice(-4) : ""].filter(Boolean).join(" ");
}

function escapeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldLine(value: string): string {
  const encoder = new TextEncoder();
  let folded = "", width = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (width + size > 75) { folded += "\r\n "; width = 1; }
    folded += character; width += size;
  }
  return folded;
}

/** vCard 3.0: UTF-8, CRLF, escaped text and folded content lines. */
export function buildContactsVcf(contacts: readonly VcfContact[], rule: VcfNameRule): string {
  if (!contacts.length || contacts.length > MAX_VCF_CONTACTS) throw new Error("Invalid contact count");
  return contacts.map(contact => {
    if (!contact.name.trim() || phoneNumber(contact.phone) !== contact.phone) throw new Error("Invalid contact");
    const name = escapeText(vcfContactName(contact, rule));
    return ["BEGIN:VCARD", "VERSION:3.0", `FN:${name}`, `N:;${name};;;`, `TEL;TYPE=CELL:${contact.phone}`, "END:VCARD"].map(foldLine).join("\r\n");
  }).join("\r\n") + "\r\n";
}
