import type { Contact } from "../../types/crm.ts";
import {
  buildExistingPhoneMatchMap,
  isPlaceholderContactName,
} from "../../lib/contactImportRowHelpers.ts";

export type BatchContactRow = {
  id: string;
  name: string;
  phone: string;
  selected: boolean;
};

export type UnnamedContactNameUpdate = {
  targetContactIds: string[];
  finalName: string;
};

export type BatchCrmPartition = {
  allCloudInputs: { name: string; phoneE164: string }[];
  contactsToCreate: Omit<Contact, "id">[];
  unnamedContactsToUpdate: UnnamedContactNameUpdate[];
};

export function buildTodayBatchPrefix(): string {
  const currentTime = new Date();
  const year = currentTime.getFullYear();
  const month = String(currentTime.getMonth() + 1).padStart(2, "0");
  const day = String(currentTime.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}-`;
}

export function normalizeBatchPhone(rawValue: string): string {
  const compact = rawValue.trim().replace(/[^\d+]/g, "");
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("+")) return compact;
  return compact ? `+${compact}` : "";
}

/** Parse spreadsheet two-column or single-line text into editable batch contact rows. */
export function parseBatchPastedContacts(rawText: string): BatchContactRow[] {
  const parsedRows: BatchContactRow[] = [];
  const seenDigitPhones = new Set<string>();
  for (const [lineIndex, rawLine] of rawText.split(/\r?\n/).entries()) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) continue;
    const cells = trimmedLine.includes("\t")
      ? trimmedLine.split("\t")
      : trimmedLine.split(/[;,]/);
    let parsedName = cells[0]?.trim() || "";
    let phoneCell = cells[1]?.trim() || "";
    if (
      /^(姓名|名称|name)$/i.test(parsedName) &&
      /^(号码|电话|phone|mobile)$/i.test(phoneCell)
    ) {
      continue;
    }
    if (
      /^\+?\d[\d\s().-]{6,}\d$/.test(parsedName) &&
      !/^\+?\d[\d\s().-]{6,}\d$/.test(phoneCell)
    ) {
      [parsedName, phoneCell] = [phoneCell, parsedName];
    } else if (!phoneCell) {
      const phoneMatch = trimmedLine.match(/(?:\+|00)?\d[\d\s().-]{6,}\d/);
      if (!phoneMatch) continue;
      phoneCell = phoneMatch[0];
      parsedName = trimmedLine.replace(phoneMatch[0], "").trim();
    }
    const normalizedPhone = normalizeBatchPhone(phoneCell);
    const phoneDigits = normalizedPhone.replace(/\D/g, "");
    if (
      phoneDigits.length < 7 ||
      phoneDigits.length > 15 ||
      seenDigitPhones.has(phoneDigits)
    ) {
      continue;
    }
    seenDigitPhones.add(phoneDigits);
    parsedRows.push({
      id: `pasted-${lineIndex}-${phoneDigits}`,
      name: parsedName || normalizedPhone,
      phone: phoneCell,
      selected: true,
    });
  }
  return parsedRows;
}

/** Partition valid rows into new CRM contacts vs name upgrades for existing unnamed/group-member contacts. */
export function partitionBatchSaveForCrm(opts: {
  validRows: BatchContactRow[];
  prefix: string;
  suffix: string;
  sourceLabel: string;
  targetAccountId?: string;
  scopedExistingContacts: readonly Partial<Contact>[];
}): BatchCrmPartition {
  const {
    validRows,
    prefix,
    suffix,
    sourceLabel,
    targetAccountId,
    scopedExistingContacts,
  } = opts;
  const existingByPhone = buildExistingPhoneMatchMap(scopedExistingContacts);
  const allCloudInputs: { name: string; phoneE164: string }[] = [];
  const contactsToCreate: Omit<Contact, "id">[] = [];
  const unnamedContactsToUpdate: UnnamedContactNameUpdate[] = [];

  for (const row of validRows) {
    const normalizedPhone = normalizeBatchPhone(row.phone);
    const finalName = `${prefix}${row.name.trim() || normalizedPhone.slice(-4)}${suffix}`.slice(
      0,
      100
    );
    allCloudInputs.push({ name: finalName, phoneE164: normalizedPhone });
    const existingMatch = existingByPhone.get(normalizedPhone);
    if (!existingMatch) {
      contactsToCreate.push({
        name: finalName,
        phone: normalizedPhone,
        source: sourceLabel,
        stage: "new",
        tags: [],
        accountId: targetAccountId,
      });
      continue;
    }
    const pastedHasHumanName = !isPlaceholderContactName(row.name, normalizedPhone);
    if (pastedHasHumanName && existingMatch.allContactIds.length > 0) {
      unnamedContactsToUpdate.push({
        targetContactIds: existingMatch.allContactIds,
        finalName,
      });
    }
  }

  return { allCloudInputs, contactsToCreate, unnamedContactsToUpdate };
}
