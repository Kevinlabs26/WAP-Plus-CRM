import { savePhoneContacts } from "@/lib/bridge";
import { baileysSaveContacts } from "@/lib/baileys";
import type { BaileysSaveContactsProgress } from "@/lib/baileysChatActions";
import type { ContactImportResult } from "@/lib/contactImport";
import type { Contact } from "@/types/crm";
import type { useI18n } from "@/i18n";
import type { ImportExecutionPlan } from "./contactImportModalHelpers";

type TranslateFn = ReturnType<typeof useI18n>["t"];

export function resolveImportPrimaryButtonLabel(opts: {
  importing: boolean;
  saveProgress?: BaileysSaveContactsProgress | null;
  createdCount: number;
  updatedCount: number;
  hasExternalSync: boolean;
  t: TranslateFn;
}): string {
  const { importing, saveProgress, createdCount, updatedCount, hasExternalSync, t } = opts;
  if (importing) {
    if (saveProgress && saveProgress.total > 0) {
      return t("contactImport.savingProgress", {
        completed: saveProgress.completed,
        total: saveProgress.total,
      });
    }
    return t("common.saving");
  }
  return t(hasExternalSync ? "contactImport.saveAndSync" : "contactImport.import", {
    count: createdCount + updatedCount,
  });
}

export async function performContactImportExecution(opts: {
  importAnalysis: ContactImportResult;
  executionPlan: ImportExecutionPlan;
  saveToWhatsappCloud: boolean;
  selectedAccountId: string;
  syncToPhone: boolean;
  targetPhoneId: string;
  onCloudProgress?: (progress: BaileysSaveContactsProgress) => void;
  importContacts: (rows: Omit<Contact, "id">[]) => number;
  batchUpdateContacts?: (
    ids: string[],
    patch: Partial<Contact>,
    extra?: { mergeTags?: string[] }
  ) => number;
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
  t: TranslateFn;
}): Promise<void> {
  const {
    importAnalysis,
    executionPlan,
    saveToWhatsappCloud,
    selectedAccountId,
    syncToPhone,
    targetPhoneId,
    onCloudProgress,
    importContacts,
    batchUpdateContacts,
    pushToast,
    t,
  } = opts;

  const createdCount = executionPlan.contactsToCreate.length
    ? importContacts(executionPlan.contactsToCreate)
    : 0;

  // Count unique pasted contacts updated (1 per phone), even if multiple legacy duplicate records share the phone.
  let updatedCount = 0;
  if (typeof batchUpdateContacts === "function") {
    for (const updateItem of executionPlan.contactsToUpdate) {
      const touched = batchUpdateContacts(updateItem.targetContactIds, updateItem.patch, {
        mergeTags: updateItem.mergeTags,
      });
      if (touched > 0) updatedCount += 1;
    }
  }

  try {
    const summaryMessages: string[] = [];
    const remainingSkipped = Math.max(
      0,
      importAnalysis.skipped.length - executionPlan.contactsToUpdate.length
    );
    if (updatedCount > 0) {
      summaryMessages.push(
        t("contactImport.resultWithUpdates", {
          created: createdCount,
          updated: updatedCount,
          skipped: remainingSkipped,
        })
      );
    } else if (!syncToPhone) {
      summaryMessages.push(
        t("contactImport.result", {
          count: createdCount,
          skipped: importAnalysis.skipped.length,
          failed: importAnalysis.errors.length,
        })
      );
    }

    let hasSyncFailure = false;
    if (saveToWhatsappCloud && executionPlan.cloudContacts.length > 0) {
      const cloudSaveSummary = await baileysSaveContacts(
        selectedAccountId,
        executionPlan.cloudContacts,
        { onProgress: onCloudProgress }
      );
      summaryMessages.push(
        t("contactImport.cloudSummary", {
          saved: cloudSaveSummary.saved,
          failed: cloudSaveSummary.failed,
        })
      );
      if (cloudSaveSummary.failed > 0) hasSyncFailure = true;
    }

    if (syncToPhone && executionPlan.cloudContacts.length > 0) {
      const phoneSaveSummary = await savePhoneContacts(
        targetPhoneId,
        executionPlan.cloudContacts
      );
      summaryMessages.push(
        t("contactImport.phoneResult", {
          count: createdCount,
          saved: phoneSaveSummary.saved,
          exists: phoneSaveSummary.exists,
          failed: phoneSaveSummary.failed,
        })
      );
      if (phoneSaveSummary.failed > 0) hasSyncFailure = true;
    }

    pushToast(summaryMessages.join(" · "), hasSyncFailure ? "info" : "success");
  } catch (syncError) {
    pushToast(
      t("contactImport.phoneSyncFailed", {
        count: createdCount,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      }),
      "error"
    );
  }
}
