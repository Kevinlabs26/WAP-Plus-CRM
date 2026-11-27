import type { ChatPreview, Contact, SalesStage } from "../../types/crm.ts";
import type { WaAccount } from "../../types/account.ts";
import { formatAccountDisplay } from "../../lib/accountLabels.ts";
import { chatInView, contactInView } from "../../store/accountScope.ts";
import {
  applyImportNameRule,
  type ContactImportResult,
  type DuplicateHandlingMode,
  type ImportContactInput,
  type ImportNameRule,
  type ImportRowResult,
} from "../../lib/contactImport.ts";

/** Select all contacts linked to the target account via contact.accountId, boundPhoneId, or active chats. */
export function selectContactsInAccountScope(
  allContacts: readonly Contact[],
  allChats: readonly ChatPreview[],
  targetAccountId?: string | null,
  liveAccountId?: string | null
): Contact[] {
  const scopedAccountId = (targetAccountId || "").trim();
  if (!scopedAccountId) return [...allContacts];
  const accountView = { type: "account" as const, accountId: scopedAccountId };
  const contactIdsFromChats = new Set<string>();
  for (const chat of allChats) {
    if (
      chat.contactId &&
      chatInView(chat, accountView, liveAccountId || undefined, liveAccountId)
    ) {
      contactIdsFromChats.add(chat.contactId);
    }
  }
  return allContacts.filter(
    (contact) =>
      contact.boundPhoneId === scopedAccountId ||
      contactIdsFromChats.has(contact.id) ||
      contactInView(contact, accountView, liveAccountId || undefined, liveAccountId)
  );
}

export type ImportPreviewFilter = "all" | "ready" | "duplicates" | "invalid";

export type PlannedContactUpdate = {
  targetContactIds: string[];
  patch: Partial<Contact>;
  mergeTags?: string[];
  finalName: string;
  phoneE164: string;
};

export type ImportExecutionPlan = {
  contactsToCreate: Omit<Contact, "id">[];
  contactsToUpdate: PlannedContactUpdate[];
  cloudContacts: { name: string; phoneE164: string }[];
};

/** Format a WhatsApp account ID into a human-readable slot label such as '2: Alex'. */
export function resolveImportAccountDisplayName(
  accounts: readonly WaAccount[],
  targetAccountId?: string | null
): string {
  const trimmedAccountId = (targetAccountId || "").trim();
  if (!trimmedAccountId) return "";
  const accountIndex = accounts.findIndex((account) => account.id === trimmedAccountId);
  if (accountIndex < 0) return trimmedAccountId;
  const matchedAccount = accounts[accountIndex]!;
  return formatAccountDisplay({
    label: matchedAccount.label,
    userName: matchedAccount.userName,
    phoneE164: matchedAccount.phoneE164,
    index1: accountIndex + 1,
  });
}

/** Check whether an existing-account duplicate row should be updated under the chosen mode. */
export function shouldUpdateDuplicateRow(
  row: ImportRowResult,
  duplicateMode: DuplicateHandlingMode
): boolean {
  if (
    row.status !== "skip_dup" ||
    row.duplicateSource !== "existing_account" ||
    !row.existingContactId
  ) {
    return false;
  }
  if (duplicateMode === "overwrite") return true;
  if (duplicateMode === "fill_unnamed") return !row.existingContactHasHumanName;
  return false;
}

/** Filter parsed import rows according to the selected summary pill and duplicate policy. */
export function filterImportRowsForPreview(
  importAnalysis: ContactImportResult,
  activeFilter: ImportPreviewFilter,
  duplicateMode: DuplicateHandlingMode = "skip"
): ImportRowResult[] {
  if (activeFilter === "ready") {
    return importAnalysis.rows.filter(
      (row) => row.status === "ready" || shouldUpdateDuplicateRow(row, duplicateMode)
    );
  }
  if (activeFilter === "duplicates") {
    return importAnalysis.skipped.filter(
      (row) => row.status === "skip_dup" && !shouldUpdateDuplicateRow(row, duplicateMode)
    );
  }
  if (activeFilter === "invalid") {
    return [
      ...importAnalysis.skipped.filter((row) => row.status === "skip_no_phone"),
      ...importAnalysis.errors,
    ];
  }
  return importAnalysis.rows;
}

function buildUpdatePayloadForDuplicate(
  row: ImportRowResult,
  finalName: string,
  duplicateMode: DuplicateHandlingMode
): PlannedContactUpdate {
  const rowInput = row.input as ImportContactInput;
  const targetIds = row.existingContactIds?.length
    ? row.existingContactIds
    : [row.existingContactId!];
  const patch: Partial<Contact> = { name: finalName };
  if (duplicateMode === "overwrite") {
    if (rowInput.company) patch.company = rowInput.company;
    if (rowInput.country) patch.country = rowInput.country;
    if (rowInput.notes) patch.notes = rowInput.notes;
    if (rowInput.stage) patch.stage = rowInput.stage as SalesStage;
  } else if (rowInput.company) {
    patch.company = rowInput.company;
  }
  return {
    targetContactIds: targetIds,
    patch,
    mergeTags: rowInput.tags?.length ? rowInput.tags : undefined,
    finalName,
    phoneE164: rowInput.phone || "",
  };
}

/** Build the concrete creation, local update, and cloud-sync lists before executing import. */
export function buildImportExecutionPlan(opts: {
  importAnalysis: ContactImportResult;
  duplicateMode: DuplicateHandlingMode;
  nameOverrides: Record<number, string>;
  nameRule: ImportNameRule;
  targetAccountId?: string;
  defaultSourceLabel: string;
}): ImportExecutionPlan {
  const {
    importAnalysis,
    duplicateMode,
    nameOverrides,
    nameRule,
    targetAccountId,
    defaultSourceLabel,
  } = opts;

  const contactsToCreate: Omit<Contact, "id">[] = importAnalysis.created.map((row, index) => {
    const rowInput = row.input as ImportContactInput;
    const finalName = applyImportNameRule(
      nameOverrides[row.line] ?? rowInput.name,
      rowInput.phone,
      index,
      nameRule
    );
    return {
      name: finalName,
      phone: rowInput.phone || "",
      stage: (rowInput.stage || "new") as SalesStage,
      tags: rowInput.tags || [],
      notes: rowInput.notes,
      aiChatInstructions: rowInput.aiChatInstructions,
      company: rowInput.company,
      country: rowInput.country,
      source: rowInput.source || defaultSourceLabel,
      owner: rowInput.owner,
      nextFollowUpAt: rowInput.nextFollowUpAt,
      accountId: targetAccountId || rowInput.accountId,
    };
  });

  const updatableRows = importAnalysis.skipped.filter((row) =>
    shouldUpdateDuplicateRow(row, duplicateMode)
  );
  const contactsToUpdate: PlannedContactUpdate[] = updatableRows.map((row, index) => {
    const rowInput = row.input as ImportContactInput;
    const finalName = applyImportNameRule(
      nameOverrides[row.line] ?? rowInput.name,
      rowInput.phone,
      contactsToCreate.length + index,
      nameRule
    );
    return buildUpdatePayloadForDuplicate(row, finalName, duplicateMode);
  });

  const cloudContacts = [
    ...contactsToCreate.map((item) => ({ name: item.name.slice(0, 100), phoneE164: item.phone })),
    ...contactsToUpdate.map((item) => ({ name: item.finalName.slice(0, 100), phoneE164: item.phoneE164 })),
  ].filter((item) => Boolean(item.phoneE164));

  return { contactsToCreate, contactsToUpdate, cloudContacts };
}
