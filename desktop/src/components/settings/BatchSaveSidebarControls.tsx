import { Input } from "@/components/ui/primitives";
import { formatAccountDisplay } from "@/lib/accountLabels";
import type { useI18n } from "@/i18n";
import type { WaAccount } from "@/types/account";
import type { PhoneDevice } from "@/types/crm";

type TranslateFn = ReturnType<typeof useI18n>["t"];

type SidebarControlsProps = {
  t: TranslateFn;
  prefix: string;
  onChangePrefix: (nextValue: string) => void;
  suffix: string;
  onChangeSuffix: (nextValue: string) => void;
  selectedCount: number;
  totalCount: number;
  cloudAvailable: boolean;
  accounts: WaAccount[];
  connectedAccountIds: string[];
  selectedAccountId: string;
  selectedAccountConnected: boolean;
  canSaveToWhatsapp: boolean;
  onSelectAccount: (accountId: string) => void;
  saveToWhatsapp: boolean;
  onChangeSaveToWhatsapp: (enabled: boolean) => void;
  bridgeConnected: boolean;
  availablePhones: PhoneDevice[];
  syncToPhone: boolean;
  onChangeSyncToPhone: (enabled: boolean) => void;
  targetPhoneId: string;
  onChangeTargetPhoneId: (phoneId: string) => void;
};

export function BatchSaveSidebarControls(props: SidebarControlsProps) {
  const { t } = props;
  return (
    <aside className="min-h-0 overflow-y-auto border-r border-zinc-800 p-4">
      <label className="block text-[10px] text-zinc-500">
        {t("contactImport.prefix")}
        <Input
          value={props.prefix}
          onChange={(event) => props.onChangePrefix(event.target.value)}
          className="mt-1 h-8 text-[11px]"
        />
      </label>
      <label className="mt-3 block text-[10px] text-zinc-500">
        {t("contactImport.suffix")}
        <Input
          value={props.suffix}
          onChange={(event) => props.onChangeSuffix(event.target.value)}
          placeholder={t("batchContacts.suffixPlaceholder")}
          className="mt-1 h-8 text-[11px]"
        />
      </label>
      <div className="mt-5 border-t border-zinc-800 pt-4 text-[11px] text-zinc-400">
        {t("batchContacts.selected", { selected: props.selectedCount, total: props.totalCount })}
        <div className="mt-1 text-[10px] text-zinc-600">{t("batchContacts.invalidSkipped")}</div>
      </div>
      <div className="mt-5 border-t border-zinc-800 pt-4">
        <label className="block text-[10px] text-zinc-500" htmlFor="batch-save-wa-account">
          {t("batchContacts.saveAccount")}
        </label>
        <select
          id="batch-save-wa-account"
          value={props.selectedAccountId}
          disabled={!props.cloudAvailable || props.accounts.length === 0}
          onChange={(event) => props.onSelectAccount(event.target.value)}
          className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
        >
          {!props.accounts.length && <option value="">{t("batchContacts.noAccount")}</option>}
          {props.accounts.map((account, index) => {
            const connected = props.connectedAccountIds.includes(account.id);
            const accountName = formatAccountDisplay({ ...account, index1: index + 1 });
            const detail = account.phoneE164 || account.userName;
            return (
              <option key={account.id} value={account.id} disabled={!connected}>
                {accountName}
                {detail && detail !== accountName ? ` · ${detail}` : ""} ·{" "}
                {connected ? t("common.connected") : t("batchContacts.disconnected")}
              </option>
            );
          })}
        </select>
        <p className="mt-1 text-[10px] text-zinc-600">{t("batchContacts.accountHint")}</p>
      </div>
      <label className="mt-5 flex items-start gap-2 border-t border-zinc-800 pt-4 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={props.saveToWhatsapp}
          disabled={!props.canSaveToWhatsapp}
          onChange={(event) => props.onChangeSaveToWhatsapp(event.target.checked)}
        />
        <span>
          {t("batchContacts.saveCloud")}
          <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
            {t("batchContacts.saveCloudHint")}
          </span>
        </span>
      </label>
      {!props.cloudAvailable && (
        <p className="mt-2 text-[10px] text-amber-400/80">{t("batchContacts.cloudUnavailable")}</p>
      )}
      {props.cloudAvailable && props.accounts.length > 0 && !props.selectedAccountConnected && (
        <p className="mt-2 text-[10px] text-amber-400/80">
          {t("batchContacts.accountDisconnected")}
        </p>
      )}
      <label className="mt-5 flex items-start gap-2 border-t border-zinc-800 pt-4 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={props.syncToPhone}
          disabled={!props.bridgeConnected || props.availablePhones.length === 0}
          onChange={(event) => props.onChangeSyncToPhone(event.target.checked)}
        />
        <span>
          {t("batchContacts.syncPhone")}
          <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
            {t("batchContacts.syncPhoneHint")}
          </span>
        </span>
      </label>
      {props.syncToPhone && (
        <select
          value={props.targetPhoneId}
          onChange={(event) => props.onChangeTargetPhoneId(event.target.value)}
          className="ui-control mt-2 h-8 w-full px-2.5 text-[11px]"
        >
          {props.availablePhones.map((phone) => (
            <option key={phone.id} value={phone.id}>
              {phone.remark || phone.name || phone.model || phone.id}
            </option>
          ))}
        </select>
      )}
      {!props.bridgeConnected && (
        <p className="mt-2 text-[10px] text-amber-400/80">{t("batchContacts.bridgeHint")}</p>
      )}
    </aside>
  );
}
