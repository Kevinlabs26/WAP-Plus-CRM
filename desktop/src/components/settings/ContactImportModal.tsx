import { ClipboardPaste, FileSpreadsheet, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { savePhoneContacts } from "@/lib/bridge";
import {
  applyImportNameRule,
  parseContactsImport,
  type ContactImportResult,
  type ImportContactInput,
  type ImportNameRule,
} from "@/lib/contactImport";
import { useI18n } from "@/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
};

type TabId = "paste" | "file" | "template";

const TEMPLATE_TEXT = `Name\tPhone\tCompany\tTags
Sample Contact A\t12025550123\tExample Corp\tProspect
Sample Contact B\t12025550124\tDemo Industries\tPriority
\t12025550125\t\tFollow-up`;

const PREVIEW_LIMIT = 300;

function ResultSummary({ result }: { result: ContactImportResult | null }) {
  const { t } = useI18n();
  if (!result?.rows.length) return null;
  const duplicates = result.skipped.filter((row) => row.status === "skip_dup").length;
  const invalid = result.skipped.length - duplicates + result.errors.length;
  return (
    <div className="grid grid-cols-4 gap-2 text-[11px]">
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/55 px-3 py-2 text-zinc-300">
        {t("contactImport.total")} <strong className="ml-1 text-zinc-100">{result.rows.length}</strong>
      </div>
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-emerald-100">
        {t("contactImport.importable")} <strong className="ml-1">{result.created.length}</strong>
      </div>
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-100">
        {t("contactImport.duplicates")} <strong className="ml-1">{duplicates}</strong>
      </div>
      <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-rose-100">
        {t("contactImport.invalid")} <strong className="ml-1">{invalid}</strong>
      </div>
    </div>
  );
}

/** 批量联系人工作台：整块粘贴、命名处理、表格校对后一次导入。 */
export function ContactImportModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const contacts = useAppStore((state) => state.contacts);
  const importContacts = useAppStore((state) => state.importContacts);
  const pushToast = useAppStore((state) => state.pushToast);
  const phones = useAppStore((state) => state.phones);
  const selectedPhoneId = useAppStore((state) => state.selectedPhoneId);
  const bridgeConnected = useAppStore((state) => state.bridge.connected);
  const [tab, setTab] = useState<TabId>("paste");
  const [text, setText] = useState("");
  const [headerMode, setHeaderMode] = useState<"auto" | "yes" | "no">("auto");
  const [fileName, setFileName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [fallback, setFallback] = useState<ImportNameRule["fallback"]>("phone");
  const [nameOverrides, setNameOverrides] = useState<Record<number, string>>({});
  const [syncToPhone, setSyncToPhone] = useState(false);
  const [targetPhoneId, setTargetPhoneId] = useState(selectedPhoneId || "");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const availablePhones = useMemo(
    () => phones.filter((phone) => phone.online),
    [phones]
  );

  const result = useMemo(
    () => text.trim()
      ? parseContactsImport(text, contacts, {
          hasHeader: headerMode === "auto" ? undefined : headerMode === "yes",
        })
      : null,
    [text, contacts, headerMode]
  );
  const previewRows = result?.created.slice(0, PREVIEW_LIMIT) || [];
  const nameRule = useMemo<ImportNameRule>(
    () => ({ prefix, suffix, fallback }),
    [prefix, suffix, fallback]
  );

  useEffect(() => {
    if (!open) return;
    if (!availablePhones.some((phone) => phone.id === targetPhoneId)) {
      setTargetPhoneId(
        availablePhones.find((phone) => phone.id === selectedPhoneId)?.id ||
        availablePhones[0]?.id ||
        ""
      );
    }
    const close = (event: KeyboardEvent) => event.key === "Escape" && !importing && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [availablePhones, importing, onClose, open, selectedPhoneId, targetPhoneId]);

  const replaceText = (value: string) => {
    setText(value);
    setNameOverrides({});
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    replaceText(await file.text());
  };

  const doImport = async () => {
    if (!result?.created.length) return;
    const inputs: Omit<import("@/types/crm").Contact, "id">[] = result.created
      .map((row, index) => {
        const input = row.input as ImportContactInput;
        return {
          name: applyImportNameRule(
            nameOverrides[row.line] ?? input.name,
            input.phone,
            index,
            nameRule
          ),
          phone: input.phone || "",
          stage: (input.stage || "new") as import("@/types/crm").SalesStage,
          tags: input.tags || [],
          notes: input.notes,
          company: input.company,
          country: input.country,
          source: input.source || t("contactImport.source"),
          owner: input.owner,
          nextFollowUpAt: input.nextFollowUpAt,
          accountId: input.accountId,
        };
      });
    if (syncToPhone && (!bridgeConnected || !targetPhoneId)) {
      pushToast(t("contactImport.selectPhoneError"), "error");
      return;
    }
    setImporting(true);
    const count = importContacts(inputs);
    try {
      if (syncToPhone) {
        const phoneResult = await savePhoneContacts(
          targetPhoneId,
          inputs.map((input) => ({ name: input.name.slice(0, 100), phoneE164: input.phone }))
        );
        pushToast(
          t("contactImport.phoneResult", { count, saved: phoneResult.saved, exists: phoneResult.exists, failed: phoneResult.failed }),
          phoneResult.failed ? "info" : "success"
        );
      } else {
        pushToast(
          t("contactImport.result", { count, skipped: result.skipped.length, failed: result.errors.length }),
          "success"
        );
      }
    } catch (error) {
      pushToast(
        t("contactImport.phoneSyncFailed", { count, error: error instanceof Error ? error.message : String(error) }),
        "error"
      );
    } finally {
      setImporting(false);
      onClose();
      setText("");
      setFileName("");
      setNameOverrides({});
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-import-title"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && !importing && onClose()}
    >
      <div className="flex h-[min(88vh,820px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
        <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="contact-import-title" className="text-[15px] font-semibold text-zinc-100">
              {t("contactImport.title")}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {t("contactImport.description")}
            </p>
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
          <aside className="min-h-0 overflow-y-auto border-r border-zinc-800 p-4">
            <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/40 p-0.5">
              {([
                ["paste", t("contactImport.tab.paste"), ClipboardPaste],
                ["file", t("contactImport.tab.file"), Upload],
                ["template", t("contactImport.tab.example"), FileSpreadsheet],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium",
                    tab === id ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {tab === "file" ? (
                <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/35 p-5 text-center">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv,text/plain,.txt"
                    className="hidden"
                    onChange={(event) => {
                      void onPickFile(event.target.files?.[0] || null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  />
                  <Upload className="mx-auto h-6 w-6 text-zinc-600" />
                  <p className="mt-2 text-[11px] text-zinc-500">{t("contactImport.fileHint")}</p>
                  <Button size="sm" className="mt-3 text-2xs" onClick={() => fileRef.current?.click()}>
                    {t("contactImport.chooseFile")}
                  </Button>
                  {fileName && <p className="mt-2 truncate text-2xs text-brand">{fileName}</p>}
                </div>
              ) : tab === "template" ? (
                <div>
                  <pre className="max-h-52 overflow-auto whitespace-pre rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[10px] leading-5 text-zinc-400">
                    {TEMPLATE_TEXT}
                  </pre>
                  <Button
                    variant="secondary"
                    size="sm" className="mt-2 w-full text-2xs"
                    onClick={() => {
                      replaceText(TEMPLATE_TEXT);
                      setTab("paste");
                    }}
                  >
                    {t("contactImport.useExample")}
                  </Button>
                </div>
              ) : (
                <Textarea
                  autoFocus
                  value={text}
                  onChange={(event) => replaceText(event.target.value)}
                  rows={9}
                  placeholder={t("contactImport.pastePlaceholder")}
                  className="min-h-48 resize-y font-mono text-[11px] leading-5"
                />
              )}
            </div>

            <label className="mt-3 block text-[10px] text-zinc-500">
              {t("contactImport.headerDetection")}
              <select
                value={headerMode}
                onChange={(event) => setHeaderMode(event.target.value as typeof headerMode)}
                className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
              >
                <option value="auto">{t("contactImport.header.auto")}</option>
                <option value="yes">{t("contactImport.header.yes")}</option>
                <option value="no">{t("contactImport.header.no")}</option>
              </select>
            </label>

            <div className="mt-5 border-t border-zinc-800 pt-4">
              <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={syncToPhone}
                  disabled={!syncToPhone && (!bridgeConnected || availablePhones.length === 0)}
                  onChange={(event) => setSyncToPhone(event.target.checked)}
                />
                <span>
                  {t("contactImport.syncPhone")}
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                    {t("contactImport.syncPhoneHint")}
                  </span>
                </span>
              </label>
              {syncToPhone && (
                <label className="mt-2 block text-[10px] text-zinc-500">
                  {t("contactImport.targetPhone")}
                  <select
                    value={targetPhoneId}
                    onChange={(event) => setTargetPhoneId(event.target.value)}
                    className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
                  >
                    {availablePhones.map((phone) => (
                      <option key={phone.id} value={phone.id}>
                        {phone.remark || phone.name || phone.model || phone.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(!bridgeConnected || availablePhones.length === 0) && (
                <p className="mt-2 text-[10px] text-amber-400/80">{t("contactImport.bridgeHint")}</p>
              )}
            </div>

            <div className="mt-5 border-t border-zinc-800 pt-4">
              <div className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-zinc-200">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                {t("contactImport.naming")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-zinc-500">
                  {t("contactImport.prefix")}
                  <Input
                    value={prefix}
                    onChange={(event) => setPrefix(event.target.value)}
                    placeholder={t("contactImport.prefixPlaceholder")}
                    className="mt-1 h-8 text-[11px]"
                  />
                </label>
                <label className="text-[10px] text-zinc-500">
                  {t("contactImport.suffix")}
                  <Input
                    value={suffix}
                    onChange={(event) => setSuffix(event.target.value)}
                    placeholder={t("contactImport.suffixPlaceholder")}
                    className="mt-1 h-8 text-[11px]"
                  />
                </label>
              </div>
              <label className="mt-2 block text-[10px] text-zinc-500">
                {t("contactImport.missingName")}
                <select
                  value={fallback}
                  onChange={(event) => setFallback(event.target.value as ImportNameRule["fallback"])}
                  className="ui-control mt-1 h-8 w-full px-2.5 text-[11px]"
                >
                  <option value="phone">{t("contactImport.fallback.phone")}</option>
                  <option value="sequence">{t("contactImport.fallback.sequence")}</option>
                </select>
              </label>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-zinc-950/25 p-4">
            <ResultSummary result={result} />
            {!result?.rows.length ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <ClipboardPaste className="h-8 w-8 text-zinc-600" />
                <p className="mt-3 text-[13px] text-zinc-400">{t("contactImport.previewEmpty")}</p>
                <p className="mt-1 text-[11px] text-zinc-600">{t("contactImport.previewHint")}</p>
              </div>
            ) : (
              <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/45">
                <table className="w-full min-w-[650px] border-collapse text-left text-[11px]">
                  <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-500 shadow-[0_1px_0_#27272a]">
                    <tr>
                      <th className="w-14 px-3 py-2 font-medium">{t("contactImport.column.row")}</th>
                      <th className="w-56 px-3 py-2 font-medium">{t("contactImport.column.name")}</th>
                      <th className="w-44 px-3 py-2 font-medium">{t("contactImport.column.phone")}</th>
                      <th className="px-3 py-2 font-medium">{t("contactImport.column.company")}</th>
                      <th className="w-20 px-3 py-2 font-medium">{t("contactImport.column.status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {previewRows.map((row, index) => {
                      const input = row.input!;
                      const baseName = nameOverrides[row.line] ?? input.name ?? "";
                      const finalName = applyImportNameRule(baseName, input.phone, index, nameRule);
                      return (
                        <tr key={row.line} className="hover:bg-zinc-900/60">
                          <td className="px-3 py-2 font-mono text-zinc-600">{row.line}</td>
                          <td className="px-3 py-1.5">
                            <Input
                              value={baseName}
                              placeholder={t("contactImport.autoGenerated")}
                              className="h-7 text-[11px]"
                              onChange={(event) => setNameOverrides((current) => ({
                                ...current,
                                [row.line]: event.target.value,
                              }))}
                            />
                            {(prefix || suffix || !baseName.trim()) && (
                              <div className="mt-1 truncate text-[9px] text-brand/80">→ {finalName}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-zinc-300">{input.phone}</td>
                          <td className="max-w-52 truncate px-3 py-2 text-zinc-400">{input.company || "—"}</td>
                          <td className="px-3 py-2 text-emerald-400">{t("contactImport.importable")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {result.created.length > PREVIEW_LIMIT && (
                  <div className="border-t border-zinc-800 px-3 py-2 text-center text-[10px] text-zinc-500">
                    {t("contactImport.previewLimit", { preview: PREVIEW_LIMIT, total: result.created.length })}
                  </div>
                )}
              </div>
            )}
            {!!result?.skipped.length && (
              <p className="mt-2 text-[10px] text-zinc-500">
                {t("contactImport.skippedHint", { count: result.skipped.length })}
              </p>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-5 py-3">
          <p className="text-[10px] text-zinc-500">{t("contactImport.footerHint")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-2xs" disabled={importing} onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              size="sm" className="min-w-32 text-2xs"
              disabled={!result?.created.length || importing || (syncToPhone && !targetPhoneId)}
              onClick={() => void doImport()}
            >
              {importing
                ? t("common.saving")
                : t(syncToPhone ? "contactImport.saveAndSync" : "contactImport.import", { count: result?.created.length || 0 })}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
