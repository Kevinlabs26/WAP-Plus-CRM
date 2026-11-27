import type { Contact } from "@/types/crm";
import {
  HEADER_ALIASES,
  STAGE_ALIASES,
  type ImportContactInput,
} from "./contactImportTypes.ts";

const PLACEHOLDER_NAMES = new Set([
  "群成员",
  "群聊",
  "?",
  "未知",
  "未知联系人",
  "unknown",
  "whatsapp",
]);

export type ExistingPhoneMatch = {
  primaryContactId: string;
  allContactIds: string[];
  displayName: string;
  hasHumanName: boolean;
};

/** Parse a single CSV/TSV line supporting escaped quotes. */
export function splitCsvLine(lineText: string, delimiter: string): string[] {
  const parsedCells: string[] = [];
  let currentCell = "";
  let insideQuotes = false;
  for (let charIndex = 0; charIndex < lineText.length; charIndex++) {
    const currentChar = lineText[charIndex]!;
    if (insideQuotes) {
      if (currentChar === '"') {
        if (lineText[charIndex + 1] === '"') {
          currentCell += '"';
          charIndex += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += currentChar;
      }
    } else if (currentChar === '"') {
      insideQuotes = true;
    } else if (currentChar === delimiter) {
      parsedCells.push(currentCell);
      currentCell = "";
    } else {
      currentCell += currentChar;
    }
  }
  parsedCells.push(currentCell);
  return parsedCells.map((cell) => cell.trim());
}

/** Detect primary column delimiter, preferring tab for spreadsheet pastes. */
export function detectDelimiter(rawText: string): string {
  const firstLine = String(rawText || "").split(/\r?\n/)[0] || "";
  if (firstLine.includes("\t")) return "\t";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return commaCount >= semicolonCount && commaCount > 0 ? "," : ";";
}

/** Normalize raw phone input or WhatsApp JID into strict E.164 (+digits). */
export function normalizeImportPhone(rawPhone: string): string {
  const trimmed = String(rawPhone || "").trim();
  if (!trimmed || trimmed.includes("@lid")) return "";
  if (trimmed.includes("@s.whatsapp.net") || trimmed.includes("@c.us")) {
    const jidDigits = trimmed.split("@")[0]?.split(":")[0] || "";
    return /^\d{7,15}$/.test(jidDigits) ? `+${jidDigits}` : "";
  }
  if (trimmed.startsWith("+") && /^\+\d{7,15}$/.test(trimmed)) return trimmed;
  if (/^\d{7,15}$/.test(trimmed)) return `+${trimmed}`;
  return "";
}

/** Determine whether a stored contact name is empty, numeric-only, or a system placeholder. */
export function isPlaceholderContactName(
  rawName?: string | null,
  phoneE164?: string | null
): boolean {
  const trimmedName = String(rawName || "").trim();
  if (!trimmedName) return true;
  if (PLACEHOLDER_NAMES.has(trimmedName.toLowerCase()) || PLACEHOLDER_NAMES.has(trimmedName)) {
    return true;
  }
  const normalizedPhone = normalizeImportPhone(phoneE164 || "");
  if (normalizedPhone && (trimmedName === normalizedPhone || trimmedName === normalizedPhone.slice(1))) {
    return true;
  }
  // Bare phone-like strings containing only digits and formatting punctuation are not real names.
  return /^\+?[\d\s().-]{6,}$/.test(trimmedName);
}

function normalizeHeaderLookupKey(rawHeader: string): string {
  return String(rawHeader || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** Map a header cell to an ImportContactInput field name if recognized. */
export function mapHeaderToField(headerCell: string): keyof ImportContactInput | null {
  const normalizedKey = normalizeHeaderLookupKey(headerCell);
  if (!normalizedKey) return null;
  const exactMatch = HEADER_ALIASES[normalizedKey] || HEADER_ALIASES[headerCell.trim()];
  if (exactMatch) return exactMatch;
  for (const [aliasText, targetField] of Object.entries(HEADER_ALIASES)) {
    const normalizedAlias = normalizeHeaderLookupKey(aliasText);
    if (normalizedAlias && normalizedKey.includes(normalizedAlias)) {
      return targetField;
    }
  }
  return null;
}

function parseTagList(rawTags: string): string[] {
  return String(rawTags || "")
    .split(/[|,，;；]/)
    .map((tagItem) => tagItem.trim())
    .filter(Boolean);
}

/** Convert raw cell strings for a row into a normalized ImportContactInput payload. */
export function normalizeImportRowFields(
  rawFields: Record<keyof ImportContactInput, string>
): ImportContactInput {
  const normalizedInput: ImportContactInput = {
    name: rawFields.name || undefined,
    phone: normalizeImportPhone(rawFields.phone || "") || undefined,
    company: rawFields.company || undefined,
    country: rawFields.country || undefined,
    source: rawFields.source || undefined,
    owner: rawFields.owner || undefined,
    notes: rawFields.notes || undefined,
    aiChatInstructions: rawFields.aiChatInstructions?.slice(0, 4000) || undefined,
    nextFollowUpAt: rawFields.nextFollowUpAt || undefined,
    accountId: rawFields.accountId || undefined,
  };
  const stageKey = (rawFields.stage || "").trim().toLowerCase();
  const mappedStage = stageKey ? STAGE_ALIASES[stageKey] : undefined;
  if (mappedStage) normalizedInput.stage = mappedStage;
  if ((rawFields.tags || "").trim()) {
    normalizedInput.tags = parseTagList(rawFields.tags);
  }
  return normalizedInput;
}

/** Extract normalized E.164 phone from an existing contact's phone or WhatsApp channelAddress. */
export function extractExistingContactPhone(contact: Partial<Contact>): string {
  const rawPhone = String(contact.phone || "").trim();
  if (rawPhone && !rawPhone.includes("@lid")) {
    const strictPhone = normalizeImportPhone(rawPhone);
    if (strictPhone) return strictPhone;
    // Existing CRM contacts may contain formatting spaces, hyphens, or parentheses.
    const compactDigits = rawPhone.replace(/\D/g, "");
    if (compactDigits.length >= 7 && compactDigits.length <= 15) {
      return `+${compactDigits}`;
    }
  }
  return normalizeImportPhone(contact.channelAddress || "");
}

/** Index existing contacts by normalized E.164 phone, preferring human-named records. */
export function buildExistingPhoneMatchMap(
  existingContacts: readonly Partial<Contact>[]
): Map<string, ExistingPhoneMatch> {
  const matchByPhone = new Map<string, ExistingPhoneMatch>();
  for (const contact of existingContacts) {
    const normalizedPhone = extractExistingContactPhone(contact);
    if (!normalizedPhone) continue;
    const candidateId = String(contact.id || "");
    const candidateName = String(contact.name || "").trim();
    const candidateHasHumanName = !isPlaceholderContactName(candidateName, normalizedPhone);
    const currentMatch = matchByPhone.get(normalizedPhone);
    if (!currentMatch) {
      matchByPhone.set(normalizedPhone, {
        primaryContactId: candidateId,
        allContactIds: candidateId ? [candidateId] : [],
        displayName: candidateName,
        hasHumanName: candidateHasHumanName,
      });
      continue;
    }
    if (candidateId && !currentMatch.allContactIds.includes(candidateId)) {
      currentMatch.allContactIds.push(candidateId);
    }
    if (!currentMatch.hasHumanName && candidateHasHumanName) {
      currentMatch.primaryContactId = candidateId || currentMatch.primaryContactId;
      currentMatch.displayName = candidateName;
      currentMatch.hasHumanName = true;
    }
  }
  return matchByPhone;
}
