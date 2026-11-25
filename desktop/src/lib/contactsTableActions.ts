import { useAppStore, flushPersist } from "@/store/appStore";
import { contactSendablePhone } from "@/lib/broadcastTemplate";
import { contactCopiesForAccount } from "@/lib/contactManagement";
import { baileysSaveContacts } from "@/lib/baileys";
import type { Contact } from "@/types/crm";

export interface BatchCloudSaveInput {
  selectedContacts: Contact[];
  targetAccountId: string;
  connectedAccountIds: string[];
  translate: (key: string, params?: Record<string, string | number>) => string;
}

/** Save selected CRM contacts into the chosen connected WhatsApp account address book. */
export async function runBatchCloudContactSave({
  selectedContacts,
  targetAccountId,
  connectedAccountIds,
  translate,
}: BatchCloudSaveInput): Promise<void> {
  const state = useAppStore.getState();
  if (!targetAccountId || !connectedAccountIds.includes(targetAccountId)) {
    state.pushToast(translate("batchContacts.selectConnectedAccount"), "error");
    return;
  }
  const byPhone = new Map<string, Contact>();
  for (const contact of selectedContacts) {
    const normalized = contactSendablePhone(contact);
    if (normalized) byPhone.set(normalized, contact);
  }
  if (!byPhone.size) {
    state.pushToast(translate("batchContacts.selectValid"), "error");
    return;
  }
  const payload = [...byPhone].map(([phoneE164, contact]) => ({
    name: contact.name.trim() || phoneE164,
    phoneE164,
  }));
  const saveResult = await baileysSaveContacts(targetAccountId, payload);
  const latest = useAppStore.getState();
  const copies = contactCopiesForAccount(
    [...byPhone.values()],
    latest.contacts,
    targetAccountId,
    saveResult.savedPhones,
    latest.settings.liveBaileysAccountId || latest.settings.activeAccountId
  );
  if (copies.length) latest.importContacts(copies);
  await flushPersist(useAppStore.getState);
  latest.pushToast(
    translate("contactManage.saved", {
      saved: saveResult.saved,
      failed: saveResult.failed,
      skipped: selectedContacts.length - byPhone.size,
    }),
    saveResult.failed ? "error" : "success"
  );
}
