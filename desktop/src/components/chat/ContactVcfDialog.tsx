import { useEffect, useMemo, useRef, useState } from "react";
import { ContactRound, X } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { buildContactsVcf, MAX_VCF_CONTACTS, parseVcfContacts, vcfContactName } from "@/lib/contactVcf";

export function ContactVcfDialog({ onClose, onAttach, disabled = false }: {
  onClose: () => void; onAttach: (file: File) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [lastFour, setLastFour] = useState(false);
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const result = useMemo(() => parseVcfContacts(text), [text]);
  const rule = { prefix, suffix, lastFour };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onPointerDown={() => closeRef.current()}>
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby="contact-vcf-title"
      className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (!event.currentTarget.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        }
      }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div><h3 id="contact-vcf-title" className="flex items-center gap-2 text-base font-semibold text-zinc-100"><ContactRound className="h-5 w-5 text-brand" />{t("vcf.title")}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{t("vcf.hint")}</p></div>
        <button type="button" aria-label={t("common.close")} onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        <label className="block text-sm text-zinc-300">{t("vcf.paste")}
          <Textarea value={text} rows={5} onChange={event => { setText(event.target.value); setError(false); }}
            placeholder={"Jean Exemple\t12025550101\nNathalie Exemple\t12025550102"} className="mt-2 px-3 text-sm leading-6" />
        </label>
        <p className="text-xs leading-5 text-zinc-500">{t("vcf.formatHint", { max: MAX_VCF_CONTACTS })}</p>
        <fieldset className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 p-3">
          <legend className="px-1 text-sm font-medium text-zinc-300">{t("vcf.nameRule")}</legend>
          <label className="min-w-36 flex-1 text-xs text-zinc-400">{t("vcf.prefix")}<Input value={prefix} maxLength={80} placeholder="10/30" onChange={event => setPrefix(event.target.value)} className="mt-1 px-3 py-2 text-sm" /></label>
          <label className="min-w-36 flex-1 text-xs text-zinc-400">{t("vcf.suffix")}<Input value={suffix} maxLength={80} onChange={event => setSuffix(event.target.value)} className="mt-1 px-3 py-2 text-sm" /></label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={lastFour} onChange={event => setLastFour(event.target.checked)} />{t("vcf.lastFour")}</label>
        </fieldset>
        <p role="status" className="text-sm text-zinc-400">{t("vcf.summary", { count: result.contacts.length, duplicates: result.duplicates, errors: result.issues.length })}</p>
        {result.issues.length > 0 && <div role="alert" className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-500">
          <p>{t("vcf.fixErrors")}</p>
          {result.issues.slice(0, 10).map((issue, index) => <p key={index}>{issue.line ? t("vcf.line", { line: issue.line }) : ""}{t(`vcf.issue.${issue.kind}`, { max: MAX_VCF_CONTACTS })}</p>)}
        </div>}
        {result.contacts.length > 0 && <div className="max-h-56 overflow-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500"><tr><th className="px-3 py-2 font-medium">{t("vcf.finalName")}</th><th className="px-3 py-2 font-medium">{t("vcf.phone")}</th></tr></thead>
            <tbody>{result.contacts.slice(0, 100).map(contact => <tr key={contact.phone} className="border-t border-zinc-800"><td className="break-words px-3 py-2 text-zinc-200">{vcfContactName(contact, rule)}</td><td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">{contact.phone}</td></tr>)}</tbody></table>
        </div>}
        {result.contacts.length > 100 && <p className="text-xs text-zinc-500">{t("vcf.previewLimit")}</p>}
        {error && <p role="alert" className="text-sm text-red-400">{t("vcf.failed")}</p>}
        {disabled && <p role="status" className="text-xs text-zinc-500">{t("vcf.busy")}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
        <p className="max-w-sm text-xs leading-5 text-zinc-500">{t("vcf.attachHint")}</p>
        <Button variant="primary" disabled={disabled || !result.contacts.length || result.issues.length > 0} onClick={() => {
          try { onAttach(new File([buildContactsVcf(result.contacts, rule)], "contacts.vcf", { type: "text/vcard;charset=utf-8" })); onClose(); }
          catch { setError(true); }
        }}>{t("vcf.attach")}</Button>
      </footer>
    </div>
  </div>;
}
