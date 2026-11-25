import { ClipboardPaste, FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { useRef } from "react";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { formatAccountDisplay } from "@/lib/accountLabels";
import { useI18n } from "@/i18n";
import type { DuplicateHandlingMode, ImportNameRule } from "@/lib/contactImport";
import type { WaAccount } from "@/types/account";
import type { PhoneDevice } from "@/types/crm";

export type ImportSourceTabId = "paste" | "file" | "template";

export const IMPORT_TEMPLATE_TEXT = `Name\tPhone\tCompany\tTags
Sample Contact A\t12025550123\tExample Corp\tProspect
Sample Contact B\t12025550124\tDemo Industries\tPriority
\t12025550125\t\tFollow-up`;

type SidebarProps = {
  activeTab: ImportSourceTabId;
  onSelectTab: (tab: ImportSourceTabId) => void;
  rawText: string;
  onChangeRawText: (nextText: string) => void;
  uploadedFileName: string;
  onPickCsvFile: (file: File | null) => Promise<void>;
  headerMode: "auto" | "yes" | "no";
  onChangeHeaderMode: (mode: "auto" | "yes" | "no") => void;
  duplicateMode: DuplicateHandlingMode;
  onChangeDuplicateMode: (mode: DuplicateHandlingMode) => void;
  isBaileysChannel: boolean;
  waAccounts: WaAccount[];
  connectedAccountIds: string[];
  selectedAccountId: string;
  onChangeAccountId: (accountId: string) => void;
  saveToWhatsappCloud: boolean;
  onChangeSaveToWhatsappCloud: (enabled: boolean) => void;
  syncToPhone: boolean;
  onChangeSyncToPhone: (enabled: boolean) => void;
  bridgeConnected: boolean;
  availablePhones: PhoneDevice[];
  targetPhoneId: string;
  onChangeTargetPhoneId: (phoneId: string) => void;
  prefix: string;
  onChangePrefix: (value: string) => void;
  suffix: string;
  onChangeSuffix: (value: string) => void;
  fallbackMode: ImportNameRule["fallback"];
  onChangeFallbackMode: (mode: ImportNameRule["fallback"]) => void;
};

export function ContactImportSidebarControls(props: SidebarProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canSyncWhatsappCloud =
    props.isBaileysChannel &&
    Boolean(props.selectedAccountId) &&
    props.connectedAccountIds.includes(props.selectedAccountId);

  return (
    <aside className="min-h-0 overflow-y-auto border-r border-zinc-800 p-4">
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/40 p-0.5">
        {(
          [
            ["paste", t("contactImport.tab.paste"), ClipboardPaste],
            ["file", t("contactImport.tab.file"), Upload],
            ["template", t("contactImport.tab.example"), FileSpreadsheet],
          ] as const
        ).map(([tabId, tabLabel, TabIcon]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => props.onSelectTab(tabId)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium",
              props.activeTab === tabId ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <TabIcon className="h-3.5 w-3.5" />
            {tabLabel}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {props.activeTab === "file" ? (
          <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/35 p-5 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain,.txt"
              className="hidden"
              onChange={(event) => {
                void props.onPickCsvFile(event.target.files?.[0] || null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <Upload className="mx-auto h-6 w-6 text-zinc-600" />
            <p className="mt-2 text-[11px] text-zinc-500">{t("contactImport.fileHint")}</p>
            <Button size="sm" className="mt-3 text-2xs" onClick={() => fileInputRef.current?.click()}>
              {t("contactImport.chooseFile")}
            </Button>
            {props.uploadedFileName && (
              <p className="mt-2 truncate text-2xs text-brand">{props.uploadedFileName}</p>
            )}
          </div>
        ) : props.activeTab === "template" ? (
          <div>
            <pre className="max-h-52 overflow-auto whitespace-pre rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[10px] leading-5 text-zinc-400">
              {IMPORT_TEMPLATE_TEXT}
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full text-2xs"
              onClick={() => {
                props.onChangeRawText(IMPORT_TEMPLATE_TEXT);
                props.onSelectTab("paste");
              }}
            >
              {t("contactImport.useExample")}
            </Button>
          </div>
        ) : (
          <Textarea
            autoFocus
            value={props.rawText}
            onChange={(event) => props.onChangeRawText(event.target.value)}
            rows={8}
            aria-label={t("contactImport.tab.paste")}
            className="min-h-40 resize-y font-mono text-[11px] leading-5"
          />
        )}
      </div>

      <label className="mt-3 block text-[10px] text-zinc-500">
        {t("contactImport.headerDetection")}
        <select
          value={props.headerMode}
          onChange={(event) => props.onChangeHeaderMode(event.target.value as "auto" | "yes" | "no")}
          className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
        >
          <option value="auto">{t("contactImport.header.auto")}</option>
          <option value="yes">{t("contactImport.header.yes")}</option>
          <option value="no">{t("contactImport.header.no")}</option>
        </select>
      </label>

      <label className="mt-3 block text-[10px] text-zinc-500">
        {t("contactImport.duplicatePolicy")}
        <select
          value={props.duplicateMode}
          onChange={(event) => props.onChangeDuplicateMode(event.target.value as DuplicateHandlingMode)}
          className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
        >
          <option value="overwrite">{t("contactImport.duplicate.overwrite")}</option>
          <option value="skip">{t("contactImport.duplicate.skip")}</option>
        </select>
      </label>

      {props.isBaileysChannel && props.waAccounts.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <label className="block text-[10px] text-zinc-500">
            {t("contactManage.target")}
            <select
              value={props.selectedAccountId}
              onChange={(event) => props.onChangeAccountId(event.target.value)}
              className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
            >
              <option value="">{t("batchContacts.selectConnectedAccount")}</option>
              {props.waAccounts.map((account, index) => {
                const isOnline = props.connectedAccountIds.includes(account.id);
                const displayName = formatAccountDisplay({ ...account, index1: index + 1 });
                return (
                  <option key={account.id} value={account.id}>
                    {displayName} · {isOnline ? t("common.connected") : t("common.offline")}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="mt-3 flex items-start gap-2 text-[11px] text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={props.saveToWhatsappCloud}
              disabled={!props.saveToWhatsappCloud && !canSyncWhatsappCloud}
              onChange={(event) => props.onChangeSaveToWhatsappCloud(event.target.checked)}
            />
            <span>
              {t("contactImport.saveCloud")}
              <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                {t("contactImport.saveCloudHint")}
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-4">
        <label className="flex items-start gap-2 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={props.syncToPhone}
            disabled={!props.syncToPhone && (!props.bridgeConnected || props.availablePhones.length === 0)}
            onChange={(event) => props.onChangeSyncToPhone(event.target.checked)}
          />
          <span>
            {t("contactImport.syncPhone")}
            <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
              {t("contactImport.syncPhoneHint")}
            </span>
          </span>
        </label>
        {props.syncToPhone && (
          <label className="mt-2 block text-[10px] text-zinc-500">
            {t("contactImport.targetPhone")}
            <select
              value={props.targetPhoneId}
              onChange={(event) => props.onChangeTargetPhoneId(event.target.value)}
              className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
            >
              {props.availablePhones.map((phone) => (
                <option key={phone.id} value={phone.id}>
                  {phone.remark || phone.name || phone.model || phone.id}
                </option>
              ))}
            </select>
          </label>
        )}
        {(!props.bridgeConnected || props.availablePhones.length === 0) && (
          <p className="mt-2 text-[10px] text-amber-400/80">{t("contactImport.bridgeHint")}</p>
        )}
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-4">
        <div className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-zinc-200">
          <Sparkles className="h-3.5 w-3.5 text-brand" />
          {t("contactImport.naming")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-zinc-500">
            {t("contactImport.prefix")}
            <Input
              value={props.prefix}
              onChange={(event) => props.onChangePrefix(event.target.value)}
              placeholder={t("contactImport.prefixPlaceholder")}
              className="mt-1 h-8 text-[11px]"
            />
          </label>
          <label className="text-[10px] text-zinc-500">
            {t("contactImport.suffix")}
            <Input
              value={props.suffix}
              onChange={(event) => props.onChangeSuffix(event.target.value)}
              placeholder={t("contactImport.suffixPlaceholder")}
              className="mt-1 h-8 text-[11px]"
            />
          </label>
        </div>
        <label className="mt-2 block text-[10px] text-zinc-500">
          {t("contactImport.missingName")}
          <select
            value={props.fallbackMode}
            onChange={(event) => props.onChangeFallbackMode(event.target.value as ImportNameRule["fallback"])}
            className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
          >
            <option value="phone">{t("contactImport.fallback.phone")}</option>
            <option value="sequence">{t("contactImport.fallback.sequence")}</option>
          </select>
        </label>
      </div>
    </aside>
  );
}
