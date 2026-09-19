import { useEffect, useMemo, useState } from "react";
import { UsersRound, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { savePhoneContacts } from "@/lib/bridge";
import { baileysSaveContacts } from "@/lib/baileys";
import type { WaAccount } from "@/types/account";
import { useI18n } from "@/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  accounts: WaAccount[];
  accountId?: string | null;
  connectedAccountIds: string[];
  cloudAvailable: boolean;
};

type Row = {
  id: string;
  name: string;
  phone: string;
  selected: boolean;
};

const MAX_VISIBLE_ROWS = 300;

function todayPrefix() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-`;
}

function normalizePhone(value: string) {
  const compact = value.trim().replace(/[^\d+]/g, "");
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("+")) return compact;
  return compact ? `+${compact}` : "";
}

function parsePastedContacts(text: string): Row[] {
  const rows: Row[] = [];
  const seenPhones = new Set<string>();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.includes("\t") ? line.split("\t") : line.split(/[;,]/);
    let name = cells[0]?.trim() || "";
    let phoneText = cells[1]?.trim() || "";
    if (/^(姓名|名称|name)$/i.test(name) && /^(号码|电话|phone|mobile)$/i.test(phoneText)) {
      continue;
    }
    if (/^\+?\d[\d\s().-]{6,}\d$/.test(name) && !/^\+?\d[\d\s().-]{6,}\d$/.test(phoneText)) {
      [name, phoneText] = [phoneText, name];
    } else if (!phoneText) {
      const match = line.match(/(?:\+|00)?\d[\d\s().-]{6,}\d/);
      if (!match) continue;
      phoneText = match[0];
      name = line.replace(match[0], "").trim();
    }
    const phone = normalizePhone(phoneText);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15 || seenPhones.has(digits)) continue;
    seenPhones.add(digits);
    rows.push({
      id: `pasted-${index}-${digits}`,
      name: name || phone,
      phone: phoneText,
      selected: true,
    });
  }
  return rows;
}

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
  const pushToast = useAppStore((state) => state.pushToast);
  const phones = useAppStore((state) => state.phones);
  const selectedPhoneId = useAppStore((state) => state.selectedPhoneId);
  const bridgeConnected = useAppStore((state) => state.bridge.connected);
  const [rows, setRows] = useState<Row[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [prefix, setPrefix] = useState(todayPrefix);
  const [suffix, setSuffix] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || "");
  const [saveToWhatsapp, setSaveToWhatsapp] = useState(false);
  const [syncToPhone, setSyncToPhone] = useState(false);
  const [targetPhoneId, setTargetPhoneId] = useState("");
  const [saving, setSaving] = useState(false);
  const availablePhones = useMemo(() => phones.filter((phone) => phone.online), [phones]);
  const selectedAccountConnected = connectedAccountIds.includes(selectedAccountId);
  const canSaveToWhatsapp = cloudAvailable && selectedAccountConnected;

  useEffect(() => {
    if (!open) return;
    const preferredAccountId =
      (accountId && accounts.some((account) => account.id === accountId)
        ? accountId
        : accounts.find((account) => connectedAccountIds.includes(account.id))?.id) ||
      accounts[0]?.id ||
      "";
    setRows([]);
    setPrefix(todayPrefix());
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [availablePhones, onClose, open, saving, selectedPhoneId, targetPhoneId]);

  if (!open) return null;

  const selectedRows = rows.filter((row) => row.selected);
  const validRows = selectedRows.filter((row) => /^\+\d{7,15}$/.test(normalizePhone(row.phone)));
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const loadPastedText = (value: string) => {
    setPasteText(value);
    setRows(parsePastedContacts(value));
  };

  const parsePaste = () => {
    const parsed = parsePastedContacts(pasteText);
    setRows(parsed);
    if (pasteText.trim() && !parsed.length) {
      pushToast(t("batchContacts.parseFailed"), "error");
    }
  };

  const save = async () => {
    if (!validRows.length) {
      pushToast(t("batchContacts.selectValid"), "error");
      return;
    }
    if (syncToPhone && (!bridgeConnected || !targetPhoneId)) {
      pushToast(t("contactImport.selectPhoneError"), "error");
      return;
    }
    if (saveToWhatsapp && !canSaveToWhatsapp) {
      pushToast(t("batchContacts.selectConnectedAccount"), "error");
      return;
    }
    setSaving(true);
    const inputs = validRows.map((row) => ({
      name: `${prefix}${row.name.trim() || normalizePhone(row.phone).slice(-4)}${suffix}`.slice(0, 100),
      phone: normalizePhone(row.phone),
      source: t("batchContacts.source"),
      stage: "new" as const,
      tags: [],
    }));
    try {
      const count = importContacts(inputs);
      let cloudResult: { saved: number; failed: number } | null = null;
      let phoneResult: Awaited<ReturnType<typeof savePhoneContacts>> | null = null;
      if (saveToWhatsapp) {
        cloudResult = await baileysSaveContacts(
          selectedAccountId,
          inputs.map(({ name, phone }) => ({ name, phoneE164: phone }))
        );
      }
      if (syncToPhone) {
        phoneResult = await savePhoneContacts(
          targetPhoneId,
          inputs.map(({ name, phone }) => ({ name, phoneE164: phone }))
        );
      }
      const summary = [t("batchContacts.crmAdded", { count })];
      if (cloudResult) {
        summary.push(t("batchContacts.cloudSaved", { count: cloudResult.saved }));
        if (cloudResult.failed) summary.push(t("batchContacts.cloudFailed", { count: cloudResult.failed }));
      }
      if (phoneResult) {
        summary.push(t("batchContacts.phoneSaved", { count: phoneResult.saved }));
        if (phoneResult.exists) summary.push(t("batchContacts.existing", { count: phoneResult.exists }));
        if (phoneResult.failed) summary.push(t("batchContacts.phoneFailed", { count: phoneResult.failed }));
      }
      pushToast(summary.join(" · "), cloudResult?.failed || phoneResult?.failed ? "info" : "success");
      onClose();
    } catch (error) {
      pushToast(
        t("batchContacts.syncFailed", { error: error instanceof Error ? error.message : String(error) }),
        "error"
      );
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
      <div className="flex h-[min(82vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
        <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <UsersRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="batch-save-contacts-title" className="text-[15px] font-semibold text-zinc-100">
              {t("batchContacts.title")}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {t("batchContacts.description")}
            </p>
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
          <aside className="min-h-0 overflow-y-auto border-r border-zinc-800 p-4">
            <label className="block text-[10px] text-zinc-500">
              {t("contactImport.prefix")}
              <Input value={prefix} onChange={(event) => setPrefix(event.target.value)} className="mt-1 h-8 text-[11px]" />
            </label>
            <label className="mt-3 block text-[10px] text-zinc-500">
              {t("contactImport.suffix")}
              <Input value={suffix} onChange={(event) => setSuffix(event.target.value)} placeholder={t("batchContacts.suffixPlaceholder")} className="mt-1 h-8 text-[11px]" />
            </label>
            <div className="mt-5 border-t border-zinc-800 pt-4 text-[11px] text-zinc-400">
              {t("batchContacts.selected", { selected: selectedRows.length, total: rows.length })}
              <div className="mt-1 text-[10px] text-zinc-600">{t("batchContacts.invalidSkipped")}</div>
            </div>
            <div className="mt-5 border-t border-zinc-800 pt-4">
              <label className="block text-[10px] text-zinc-500" htmlFor="batch-save-wa-account">
                {t("batchContacts.saveAccount")}
              </label>
              <select
                id="batch-save-wa-account"
                value={selectedAccountId}
                disabled={!cloudAvailable || accounts.length === 0}
                onChange={(event) => {
                  const nextAccountId = event.target.value;
                  setSelectedAccountId(nextAccountId);
                  setSaveToWhatsapp(cloudAvailable && connectedAccountIds.includes(nextAccountId));
                }}
                className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
              >
                {!accounts.length && <option value="">{t("batchContacts.noAccount")}</option>}
                {accounts.map((account) => {
                  const connected = connectedAccountIds.includes(account.id);
                  const accountName = account.label || account.userName || account.phoneE164 || account.id;
                  const detail = account.phoneE164 || account.userName;
                  return (
                    <option key={account.id} value={account.id} disabled={!connected}>
                      {accountName}{detail && detail !== accountName ? ` · ${detail}` : ""} · {connected ? t("common.connected") : t("batchContacts.disconnected")}
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-[10px] text-zinc-600">
                {t("batchContacts.accountHint")}
              </p>
            </div>
            <label className="mt-5 flex items-start gap-2 border-t border-zinc-800 pt-4 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={saveToWhatsapp}
                disabled={!canSaveToWhatsapp}
                onChange={(event) => setSaveToWhatsapp(event.target.checked)}
              />
              <span>
                {t("batchContacts.saveCloud")}
                <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                  {t("batchContacts.saveCloudHint")}
                </span>
              </span>
            </label>
            {!cloudAvailable && (
              <p className="mt-2 text-[10px] text-amber-400/80">
                {t("batchContacts.cloudUnavailable")}
              </p>
            )}
            {cloudAvailable && accounts.length > 0 && !selectedAccountConnected && (
              <p className="mt-2 text-[10px] text-amber-400/80">
                {t("batchContacts.accountDisconnected")}
              </p>
            )}
            <label className="mt-5 flex items-start gap-2 border-t border-zinc-800 pt-4 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={syncToPhone}
                disabled={!bridgeConnected || availablePhones.length === 0}
                onChange={(event) => setSyncToPhone(event.target.checked)}
              />
              <span>
                {t("batchContacts.syncPhone")}
                <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">{t("batchContacts.syncPhoneHint")}</span>
              </span>
            </label>
            {syncToPhone && (
              <select value={targetPhoneId} onChange={(event) => setTargetPhoneId(event.target.value)} className="ui-control mt-2 h-8 w-full px-2.5 text-[11px]">
                {availablePhones.map((phone) => (
                  <option key={phone.id} value={phone.id}>{phone.remark || phone.name || phone.model || phone.id}</option>
                ))}
              </select>
            )}
            {!bridgeConnected && <p className="mt-2 text-[10px] text-amber-400/80">{t("batchContacts.bridgeHint")}</p>}
          </aside>

          <section className="min-h-0 overflow-auto bg-zinc-950/25 p-4">
            <div className="mb-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-zinc-300">
                  {t("batchContacts.pasteTitle")}
                </span>
                <span className="text-[10px] text-zinc-600">{t("batchContacts.pasteHint")}</span>
              </div>
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                onPaste={(event) => {
                  event.preventDefault();
                  loadPastedText(event.clipboardData.getData("text/plain"));
                }}
                placeholder={t("batchContacts.pastePlaceholder")}
                rows={3}
                className="ui-control min-h-16 w-full resize-y px-2.5 py-2 text-[11px] leading-5"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-zinc-600">
                  {t("batchContacts.autoLoadHint")}
                </span>
                <Button variant="ghost" size="sm" className="text-2xs" onClick={parsePaste}>
                  {t("batchContacts.parse")}
                </Button>
              </div>
            </div>
            <table className="w-full min-w-[620px] border-collapse text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-500 shadow-[0_1px_0_#27272a]">
                <tr>
                  <th className="w-10 px-2 py-2"><input type="checkbox" checked={allSelected} onChange={(event) => setRows((current) => current.map((row) => ({ ...row, selected: event.target.checked })))} /></th>
                  <th className="w-56 px-2 py-2 font-medium">{t("batchContacts.name")}</th>
                  <th className="w-52 px-2 py-2 font-medium">{t("batchContacts.phone")}</th>
                  <th className="px-2 py-2 font-medium">{t("batchContacts.previewName")}</th>
                  <th className="w-16 px-2 py-2 font-medium">{t("contactImport.column.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {visibleRows.map((row) => {
                  const phone = normalizePhone(row.phone);
                  const valid = /^\+\d{7,15}$/.test(phone);
                  const finalName = `${prefix}${row.name.trim() || phone.slice(-4)}${suffix}`;
                  return (
                    <tr key={row.id} className="hover:bg-zinc-900/60">
                      <td className="px-2 py-2"><input type="checkbox" checked={row.selected} onChange={(event) => updateRow(row.id, { selected: event.target.checked })} /></td>
                      <td className="px-2 py-1.5"><Input value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })} className="h-7 text-[11px]" placeholder={t("batchContacts.namePlaceholder")} /></td>
                      <td className="px-2 py-1.5"><Input value={row.phone} onChange={(event) => updateRow(row.id, { phone: event.target.value })} className="h-7 font-mono text-[11px]" /></td>
                      <td className="max-w-64 truncate px-2 py-2 text-brand/80" title={finalName}>{finalName}</td>
                      <td className={cn("px-2 py-2", valid ? "text-emerald-400" : "text-rose-400")}>{valid ? t("batchContacts.valid") : t("contactImport.invalid")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <div className="flex h-20 items-center justify-center text-[12px] text-zinc-600">{t("batchContacts.empty")}</div>}
            {rows.length > MAX_VISIBLE_ROWS && (
              <p className="mt-2 text-center text-[10px] text-zinc-600">
                {t("batchContacts.previewLimit", { total: rows.length, visible: MAX_VISIBLE_ROWS })}
              </p>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-5 py-3">
          <p className="text-[10px] text-zinc-500">{t("batchContacts.footerHint")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-2xs" disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" size="sm" className="min-w-32 text-2xs" disabled={!validRows.length || saving} onClick={() => void save()}>
              {saving ? t("common.saving") : t("batchContacts.save", { count: validRows.length })}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
