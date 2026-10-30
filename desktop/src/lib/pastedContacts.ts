import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/min";
import { normalizeImportPhone, splitCsvLine } from "./contactImport.ts";

export const MAX_PASTED_CONTACTS = 2000;
export const MAX_PASTED_CONTACT_TEXT_LENGTH = 300_000;
export interface PastedContact { name: string; phone: string }
export type PastedContactIssue = { line: number; kind: "format" | "name" | "phone" | "limit" };
const callingCodes = new Set<string>(getCountries().map(country => getCountryCallingCode(country)));

export function normalizeCallingCode(value: string): string | null {
  const raw = value.normalize("NFKC").trim();
  if (!raw) return "";
  const code = raw.replace(/^(?:\+|00)/, "");
  return callingCodes.has(code) ? code : null;
}

export function normalizePastedPhone(value: string, defaultCallingCode = ""): string {
  const raw = value.normalize("NFKC").trim().replace(/^'/, "");
  if (!/^[+\d][\d ()\s.-]*$/.test(raw)) return "";
  const compact = raw.replace(/[ ()\s.-]/g, "");
  if (defaultCallingCode && !/^(?:\+|00)/.test(compact)) {
    const code = normalizeCallingCode(defaultCallingCode);
    if (!code) return "";
    const number = parsePhoneNumberFromString(compact, { defaultCallingCode: code, extract: false });
    return number?.isPossible() && /^\+[1-9]\d{6,14}$/.test(number.number) ? number.number : "";
  }
  const phone = normalizeImportPhone(compact.replace(/^00/, "+"));
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : "";
}

/** Parse pasted columns without guessing the country of an unprefixed local number. */
export function parsePastedContacts(text: string, options: { defaultCallingCode?: string; allowUnnamed?: boolean } = {}) {
  const contacts: PastedContact[] = [], issues: PastedContactIssue[] = [];
  const seen = new Set<string>();
  const phoneNumber = (value: string) => normalizePastedPhone(value, options.defaultCallingCode);
  let duplicates = 0, first = true, count = 0;
  if (text.length > MAX_PASTED_CONTACT_TEXT_LENGTH) return { contacts, issues: [{ line: 0, kind: "limit" } as PastedContactIssue], duplicates };
  for (const [index, raw] of text.split(/\r\n|\n|\r/).entries()) {
    if (!raw.trim()) continue;
    if (++count > MAX_PASTED_CONTACTS + 1) { issues.push({ line: index + 1, kind: "limit" }); break; }
    let cells: string[];
    const delimiters = raw.includes("\t") ? ["\t"] : [";", ","].filter(delimiter => raw.includes(delimiter));
    if (delimiters.length) {
      const candidates = delimiters.map(delimiter => {
        const values = splitCsvLine(raw, delimiter);
        while (values.length > 2 && !values.at(-1)) values.pop();
        return values;
      });
      cells = candidates.find(values => values.length === 2 && phoneNumber(values[1])) || candidates.find(values => values.length === 2) || [];
    } else if (options.allowUnnamed && /^[+\d][\d ()\s.-]*$/.test(raw.trim())) {
      cells = ["", raw.trim()];
    } else {
      const match = raw.trim().match(/^(.+?)\s+((?:\+|00)?\d{4,15}|\+[\d ().-]+)$/);
      cells = match ? [match[1], match[2]] : [];
    }
    if (first && cells.length === 2 && /^(name|nom|姓名|名字|联系人)$/i.test(cells[0]) && /^(phone|number|telephone|téléphone|numéro|电话|号码|手机号)$/i.test(cells[1])) {
      first = false; continue;
    }
    first = false;
    if (cells.length !== 2) { issues.push({ line: index + 1, kind: "format" }); continue; }
    const name = cells[0].trim(), phone = phoneNumber(cells[1]);
    if (!name && !options.allowUnnamed) { issues.push({ line: index + 1, kind: "name" }); continue; }
    if (!phone) { issues.push({ line: index + 1, kind: "phone" }); continue; }
    if (seen.has(phone)) { duplicates++; continue; }
    if (contacts.length >= MAX_PASTED_CONTACTS) { issues.push({ line: index + 1, kind: "limit" }); break; }
    seen.add(phone); contacts.push({ name, phone });
  }
  return { contacts, issues, duplicates };
}
