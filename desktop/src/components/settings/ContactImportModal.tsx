import { FileSpreadsheet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/primitives";
import { isWaAccountConnected } from "@/lib/accountConnection";
import type { BaileysSaveContactsProgress } from "@/lib/baileysChatActions";
import { parseContactsImport, type DuplicateHandlingMode, type ImportNameRule } from "@/lib/contactImport";
import { useI18n } from "@/i18n";
import type { WaAccount } from "@/types/account";
import type { ChatPreview } from "@/types/crm";
import { ContactImportSidebarControls, type ImportSourceTabId } from "./ContactImportSidebarControls";
import { ContactImportPreviewSection } from "./ContactImportPreviewSection";
import {
  buildImportExecutionPlan,
  resolveImportAccountDisplayName,
  selectContactsInAccountScope,
  type ImportPreviewFilter,
} from "./contactImportModalHelpers";
import { performContactImportExecution, resolveImportPrimaryButtonLabel } from "./runContactImportExecution";

const EMPTY_WA_ACCOUNTS: WaAccount[] = [];
const EMPTY_CHATS: ChatPreview[] = [];

type Props = {
  open: boolean;
  onClose: () => void;
  accountId?: string;
  initialTab?: ImportSourceTabId;
};

export function ContactImportModal({ open, onClose, accountId, initialTab = "paste" }: Props) {
  const { t } = useI18n();
  const contacts = useAppStore((state) => state.contacts);
  const chats = useAppStore((state) => state.chats ?? EMPTY_CHATS);
  const sendChannel = useAppStore((state) => state.settings.sendChannel);
  const waAccounts = useAppStore((state) => state.settings.waAccounts ?? EMPTY_WA_ACCOUNTS);
  const liveAccountId = useAppStore(
    (state) => state.settings.liveBaileysAccountId || state.settings.activeAccountId
  );
  const baileysConnection = useAppStore((state) => state.baileysUi?.connection);
  const importContacts = useAppStore((state) => state.importContacts);
  const batchUpdateContacts = useAppStore((state) => state.batchUpdateContacts);
  const pushToast = useAppStore((state) => state.pushToast);
  const phones = useAppStore((state) => state.phones);
  const selectedPhoneId = useAppStore((state) => state.selectedPhoneId);
  const bridgeConnected = useAppStore((state) => state.bridge.connected);
  const bridgeDeviceId = useAppStore((state) => state.bridge.deviceId);

  const [activeTab, setActiveTab] = useState<ImportSourceTabId>("paste");
  const [rawText, setRawText] = useState("");
  const [headerMode, setHeaderMode] = useState<"auto" | "yes" | "no">("auto");
  const [duplicateMode, setDuplicateMode] = useState<DuplicateHandlingMode>("overwrite");
  const [activeFilter, setActiveFilter] = useState<ImportPreviewFilter>("all");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [fallbackMode, setFallbackMode] = useState<ImportNameRule["fallback"]>("phone");
  const [nameOverrides, setNameOverrides] = useState<Record<number, string>>({});
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || "");
  const [saveToWhatsappCloud, setSaveToWhatsappCloud] = useState(false);
  const [syncToPhone, setSyncToPhone] = useState(false);
  const [targetPhoneId, setTargetPhoneId] = useState(selectedPhoneId || "");
  const [importing, setImporting] = useState(false);
  const [saveProgress, setSaveProgress] = useState<BaileysSaveContactsProgress | null>(null);

  const isBaileysChannel = sendChannel !== "android_bridge";
  const connectedAccountIds = useMemo(
    () =>
      waAccounts
        .filter((acc) => isWaAccountConnected(waAccounts, acc.id, liveAccountId, baileysConnection))
        .map((acc) => acc.id),
    [waAccounts, liveAccountId, baileysConnection]
  );
  const availablePhones = useMemo(
    () => phones.filter((phone) => bridgeConnected && phone.id === bridgeDeviceId),
    [phones, bridgeConnected, bridgeDeviceId]
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    const initialAccountId = accountId || "";
    setSelectedAccountId(initialAccountId);
    setSaveToWhatsappCloud(
      Boolean(isBaileysChannel && initialAccountId && connectedAccountIds.includes(initialAccountId))
    );
  }, [open, accountId, initialTab, isBaileysChannel]);

  useEffect(() => {
    if (!open) return;
    if (!availablePhones.some((phone) => phone.id === targetPhoneId)) {
      setTargetPhoneId(
        availablePhones.find((phone) => phone.id === selectedPhoneId)?.id || availablePhones[0]?.id || ""
      );
    }
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !importing) onClose();
    };
    window.addEventListener("keydown", handleEscapeKey);
    return () => window.removeEventListener("keydown", handleEscapeKey);
  }, [availablePhones, importing, onClose, open, selectedPhoneId, targetPhoneId]);

  const scopedExistingContacts = useMemo(
    () => selectContactsInAccountScope(contacts, chats, selectedAccountId, liveAccountId),
    [contacts, chats, selectedAccountId, liveAccountId]
  );

  const importAnalysis = useMemo(
    () =>
      rawText.trim()
        ? parseContactsImport(rawText, scopedExistingContacts, {
            hasHeader: headerMode === "auto" ? undefined : headerMode === "yes",
          })
        : null,
    [rawText, scopedExistingContacts, headerMode]
  );

  const nameRule = useMemo<ImportNameRule>(
    () => ({ prefix, suffix, fallback: fallbackMode }),
    [prefix, suffix, fallbackMode]
  );

  const executionPlan = useMemo(
    () =>
      importAnalysis
        ? buildImportExecutionPlan({
            importAnalysis,
            duplicateMode,
            nameOverrides,
            nameRule,
            targetAccountId: selectedAccountId || undefined,
            defaultSourceLabel: t("contactImport.source"),
          })
        : null,
    [importAnalysis, duplicateMode, nameOverrides, nameRule, selectedAccountId, t]
  );

  const createdCount = executionPlan?.contactsToCreate.length || 0;
  const updatedCount = executionPlan?.contactsToUpdate.length || 0;
  const totalActionableCount = createdCount + updatedCount;

  const handleReplaceRawText = (nextValue: string) => {
    setRawText(nextValue);
    setNameOverrides({});
    setActiveFilter("all");
  };

  const handleSubmitImport = async () => {
    if (!importAnalysis || !executionPlan || totalActionableCount === 0) return;
    if (syncToPhone && (!bridgeConnected || !targetPhoneId)) {
      return pushToast(t("contactImport.selectPhoneError"), "error");
    }
    if (saveToWhatsappCloud && (!selectedAccountId || !connectedAccountIds.includes(selectedAccountId))) {
      return pushToast(t("batchContacts.selectConnectedAccount"), "error");
    }
    setImporting(true);
    setSaveProgress(null);
    try {
      await performContactImportExecution({
        importAnalysis,
        executionPlan,
        saveToWhatsappCloud,
        selectedAccountId,
        syncToPhone,
        targetPhoneId,
        onCloudProgress: setSaveProgress,
        importContacts,
        batchUpdateContacts,
        pushToast,
        t,
      });
    } finally {
      setImporting(false);
      setSaveProgress(null);
      onClose();
      setRawText("");
      setUploadedFileName("");
      setNameOverrides({});
      setActiveFilter("all");
    }
  };

  if (!open) return null;

  const accountDisplayLabel = resolveImportAccountDisplayName(waAccounts, selectedAccountId);
  const primaryButtonLabel = resolveImportPrimaryButtonLabel({
    importing,
    saveProgress,
    createdCount,
    updatedCount,
    hasExternalSync: saveToWhatsappCloud || syncToPhone,
    t,
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-import-title"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && !importing && onClose()}
    >
      <div className="flex h-[min(88vh,820px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
        <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="contact-import-title" className="text-[15px] font-semibold text-zinc-100">
              {t("contactImport.title")}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t("contactImport.description")}</p>
            {accountDisplayLabel && (
              <p className="mt-1 text-[11px] text-brand">
                {t("contactManage.target")} · {accountDisplayLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            disabled={importing}
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,0.78fr)_minmax(0,1.7fr)]">
          <ContactImportSidebarControls
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            rawText={rawText}
            onChangeRawText={handleReplaceRawText}
            uploadedFileName={uploadedFileName}
            onPickCsvFile={async (file) => {
              if (!file) return;
              setUploadedFileName(file.name);
              handleReplaceRawText(await file.text());
            }}
            headerMode={headerMode}
            onChangeHeaderMode={setHeaderMode}
            duplicateMode={duplicateMode}
            onChangeDuplicateMode={setDuplicateMode}
            isBaileysChannel={isBaileysChannel}
            waAccounts={waAccounts}
            connectedAccountIds={connectedAccountIds}
            selectedAccountId={selectedAccountId}
            onChangeAccountId={(nextId) => {
              setSelectedAccountId(nextId);
              setSaveToWhatsappCloud(Boolean(nextId && connectedAccountIds.includes(nextId)));
            }}
            saveToWhatsappCloud={saveToWhatsappCloud}
            onChangeSaveToWhatsappCloud={setSaveToWhatsappCloud}
            syncToPhone={syncToPhone}
            onChangeSyncToPhone={setSyncToPhone}
            bridgeConnected={bridgeConnected}
            availablePhones={availablePhones}
            targetPhoneId={targetPhoneId}
            onChangeTargetPhoneId={setTargetPhoneId}
            prefix={prefix}
            onChangePrefix={setPrefix}
            suffix={suffix}
            onChangeSuffix={setSuffix}
            fallbackMode={fallbackMode}
            onChangeFallbackMode={setFallbackMode}
          />
          <ContactImportPreviewSection
            importAnalysis={importAnalysis}
            activeFilter={activeFilter}
            onSelectFilter={setActiveFilter}
            duplicateMode={duplicateMode}
            nameRule={nameRule}
            nameOverrides={nameOverrides}
            onChangeNameOverride={(lineNo, val) =>
              setNameOverrides((prev) => ({ ...prev, [lineNo]: val }))
            }
          />
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-zinc-800 bg-zinc-900 px-5 py-3">
          {importing && saveProgress && saveProgress.total > 0 ? (
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-[11px] font-medium text-brand">
                {t("contactImport.savingCloudDetail", saveProgress)}
              </p>
              <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-brand transition-all duration-200"
                  style={{ width: `${Math.round((saveProgress.completed / saveProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-zinc-500">{t("contactImport.footerHint")}</p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-2xs" disabled={importing} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="min-w-32 text-2xs"
              disabled={totalActionableCount === 0 || importing || (syncToPhone && !targetPhoneId)}
              onClick={() => void handleSubmitImport()}
            >
              {primaryButtonLabel}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
