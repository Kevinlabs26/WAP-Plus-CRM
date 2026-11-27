import { useEffect, useMemo, useRef, useState } from "react";
import { UsersRound, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/primitives";
import { savePhoneContacts } from "@/lib/bridge";
import { baileysSaveContacts } from "@/lib/baileys";
import type { WaAccount } from "@/types/account";
import type { ChatPreview } from "@/types/crm";
import { useI18n } from "@/i18n";
import { selectContactsInAccountScope } from "./contactImportModalHelpers";
import { BatchSaveSidebarControls } from "./BatchSaveSidebarControls";
import { BatchSavePreviewSection } from "./BatchSavePreviewSection";
import {
  buildTodayBatchPrefix,
  normalizeBatchPhone,
  partitionBatchSaveForCrm,
  type BatchContactRow,
} from "./batchSaveContactsHelpers";

const EMPTY_CHATS: ChatPreview[] = [];

type Props = {
  open: boolean;
  onClose: () => void;
  accounts: WaAccount[];
  accountId?: string | null;
  connectedAccountIds: string[];
  cloudAvailable: boolean;
};

export function BatchSaveContactsModal({
  open,
  onClose,
  accounts,
  accountId,
  connectedAccountIds,
  cloudAvailable,
}: Props) {
  const { t } = useI18n();
  const importContacts = useAppStore((state) => state.importContacts);
  const batchUpdateContacts = useAppStore((state) => state.batchUpdateContacts);
  const updateContact = useAppStore((state) => state.updateContact);
  const contacts = useAppStore((state) => state.contacts);
  const chats = useAppStore((state) => state.chats ?? EMPTY_CHATS);
  const liveAccountId = useAppStore(
    (state) => state.settings.liveBaileysAccountId || state.settings.activeAccountId
  );
  const pushToast = useAppStore((state) => state.pushToast);
  const phones = useAppStore((state) => state.phones);
  const selectedPhoneId = useAppStore((state) => state.selectedPhoneId);
  const bridgeConnected = useAppStore((state) => state.bridge.connected);
  const bridgeDeviceId = useAppStore((state) => state.bridge.deviceId);
  const [rows, setRows] = useState<BatchContactRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [prefix, setPrefix] = useState(buildTodayBatchPrefix);
  const [suffix, setSuffix] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || "");
  const [saveToWhatsapp, setSaveToWhatsapp] = useState(false);
  const [syncToPhone, setSyncToPhone] = useState(false);
  const [targetPhoneId, setTargetPhoneId] = useState("");
  const [saving, setSaving] = useState(false);
  const openedRef = useRef(false);
  const availablePhones = useMemo(
    () => phones.filter((phone) => bridgeConnected && phone.id === bridgeDeviceId),
    [phones, bridgeConnected, bridgeDeviceId]
  );
  const selectedAccountConnected = connectedAccountIds.includes(selectedAccountId);
  const canSaveToWhatsapp = cloudAvailable && selectedAccountConnected;

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    const preferredAccountId =
      (accountId && accounts.some((account) => account.id === accountId)
        ? accountId
        : accounts.find((account) => connectedAccountIds.includes(account.id))?.id) ||
      accounts[0]?.id ||
      "";
    setRows([]);
    setPrefix(buildTodayBatchPrefix());
    setSuffix("");
    setSelectedAccountId(preferredAccountId);
    setSaveToWhatsapp(cloudAvailable && connectedAccountIds.includes(preferredAccountId));
    setSyncToPhone(false);
    setPasteText("");
  }, [accountId, accounts, cloudAvailable, connectedAccountIds, open]);

  useEffect(() => {
    if (!open) return;
    if (!availablePhones.some((phone) => phone.id === targetPhoneId)) {
      setTargetPhoneId(
        availablePhones.find((phone) => phone.id === selectedPhoneId)?.id ||
          availablePhones[0]?.id ||
          ""
      );
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [availablePhones, onClose, open, saving, selectedPhoneId, targetPhoneId]);

  if (!open) return null;

  const selectedRows = rows.filter((row) => row.selected);
  const validRows = selectedRows.filter((row) =>
    /^\+\d{7,15}$/.test(normalizeBatchPhone(row.phone))
  );

  const handleSaveBatch = async () => {
    if (!validRows.length) return pushToast(t("batchContacts.selectValid"), "error");
    if (syncToPhone && (!bridgeConnected || !targetPhoneId)) {
      return pushToast(t("contactImport.selectPhoneError"), "error");
    }
    if (saveToWhatsapp && !canSaveToWhatsapp) {
      return pushToast(t("batchContacts.selectConnectedAccount"), "error");
    }
    setSaving(true);
    try {
      const scopedExistingContacts = cloudAvailable
        ? selectContactsInAccountScope(contacts, chats, selectedAccountId, liveAccountId)
        : contacts;
      const partition = partitionBatchSaveForCrm({
        validRows,
        prefix,
        suffix,
        sourceLabel: t("batchContacts.source"),
        targetAccountId: cloudAvailable ? selectedAccountId || undefined : undefined,
        scopedExistingContacts,
      });
      const addedCount = importContacts(partition.contactsToCreate);
      let updatedCount = 0;
      for (const updateItem of partition.unnamedContactsToUpdate) {
        if (typeof batchUpdateContacts === "function") {
          if (batchUpdateContacts(updateItem.targetContactIds, { name: updateItem.finalName }) > 0) {
            updatedCount += 1;
          }
        } else if (typeof updateContact === "function") {
          updateItem.targetContactIds.forEach((id) => updateContact(id, { name: updateItem.finalName }));
          updatedCount += 1;
        }
      }
      const cloudSummary = saveToWhatsapp ? await baileysSaveContacts(selectedAccountId, partition.allCloudInputs) : null;
      const phoneSummary = syncToPhone ? await savePhoneContacts(targetPhoneId, partition.allCloudInputs) : null;
      const summaryParts = [t("batchContacts.crmAdded", { count: addedCount })];
      if (updatedCount > 0) summaryParts.push(t("batchContacts.crmUpdated", { count: updatedCount }));
      if (cloudSummary) {
        summaryParts.push(t("batchContacts.cloudSaved", { count: cloudSummary.saved }));
        if (cloudSummary.failed) summaryParts.push(t("batchContacts.cloudFailed", { count: cloudSummary.failed }));
      }
      if (phoneSummary) {
        summaryParts.push(t("batchContacts.phoneSaved", { count: phoneSummary.saved }));
        if (phoneSummary.exists) summaryParts.push(t("batchContacts.existing", { count: phoneSummary.exists }));
        if (phoneSummary.failed) summaryParts.push(t("batchContacts.phoneFailed", { count: phoneSummary.failed }));
      }
      pushToast(summaryParts.join(" · "), cloudSummary?.failed || phoneSummary?.failed ? "info" : "success");
      onClose();
    } catch (syncError) {
      pushToast(t("batchContacts.syncFailed", { error: syncError instanceof Error ? syncError.message : String(syncError) }), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-save-contacts-title"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <div className="flex h-[min(82vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
        <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <UsersRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="batch-save-contacts-title" className="text-[15px] font-semibold text-zinc-100">
              {t("batchContacts.title")}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t("batchContacts.description")}</p>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            disabled={saving}
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
          {BatchSaveSidebarControls({
            t,
            prefix,
            onChangePrefix: setPrefix,
            suffix,
            onChangeSuffix: setSuffix,
            selectedCount: selectedRows.length,
            totalCount: rows.length,
            cloudAvailable,
            accounts,
            connectedAccountIds,
            selectedAccountId,
            selectedAccountConnected,
            canSaveToWhatsapp,
            onSelectAccount: (nextAccountId) => {
              setSelectedAccountId(nextAccountId);
              setSaveToWhatsapp(cloudAvailable && connectedAccountIds.includes(nextAccountId));
            },
            saveToWhatsapp,
            onChangeSaveToWhatsapp: setSaveToWhatsapp,
            bridgeConnected,
            availablePhones,
            syncToPhone,
            onChangeSyncToPhone: setSyncToPhone,
            targetPhoneId,
            onChangeTargetPhoneId: setTargetPhoneId,
          })}
          {BatchSavePreviewSection({
            t,
            rows,
            pasteText,
            prefix,
            suffix,
            onChangePasteText: setPasteText,
            onReplaceRows: setRows,
            onNotifyParseFailed: () => pushToast(t("batchContacts.parseFailed"), "error"),
          })}
        </div>

        <footer className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-5 py-3">
          <p className="text-[10px] text-zinc-500">{t("batchContacts.footerHint")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-2xs" disabled={saving} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="min-w-32 text-2xs"
              disabled={!validRows.length || saving}
              onClick={() => void handleSaveBatch()}
            >
              {saving ? t("common.saving") : t("batchContacts.save", { count: validRows.length })}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
