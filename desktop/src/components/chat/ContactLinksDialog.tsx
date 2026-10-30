import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, X } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { MAX_PASTED_CONTACTS, normalizeCallingCode, parsePastedContacts } from "@/lib/pastedContacts";
import { buildContactLinks, contactLinksCsv, contactLinksText } from "@/lib/contactLinks";
import { downloadText } from "@/lib/exportData";
import { MAX_CHAT_DRAFT_LENGTH } from "@/lib/chatDrafts";

const EXAMPLE = "Jean Exemple\t+12025550101\nNathalie Exemple\t+12025550102\n+12025550103";

export function ContactLinksDialog({ onClose, onInsert, canInsert = true }: {
  onClose: () => void; onInsert: (text: string) => boolean; canInsert?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [prefix, setPrefix] = useState("");
  const [country, setCountry] = useState("");
  const [start, setStart] = useState("1");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [copying, setCopying] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pasteInput = useRef<HTMLTextAreaElement>(null);
  const code = normalizeCallingCode(country);
  const number = Number(start);
  const validStart = Number.isSafeInteger(number) && number >= 1 && number <= 999_998_000;
  const parsed = useMemo(() => parsePastedContacts(text, { defaultCallingCode: code || "", allowUnnamed: true }), [text, code]);
  const generated = useMemo(() => {
    if (code === null || !validStart || parsed.issues.length) return { entries: [], error: "" };
    try { return { entries: buildContactLinks(parsed.contacts, { prefix, start: number, message }), error: "" }; }
    catch { return { entries: [], error: "links.tooLong" as const }; }
  }, [parsed, prefix, number, validStart, message, code]);
  const output = useMemo(() => contactLinksText(generated.entries), [generated]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    pasteInput.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { setFeedback(""); }, [output]);
  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onPointerDown={() => closeRef.current()}>
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby="contact-links-title"
      className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
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
        <div><h3 id="contact-links-title" className="flex items-center gap-2 text-base font-semibold text-zinc-100"><Link2 className="h-5 w-5 text-brand" />{t("links.title")}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{t("links.hint")}</p></div>
        <button type="button" aria-label={t("common.close")} onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 p-3">
          <label className="min-w-36 flex-1 text-xs text-zinc-400">{t("links.prefix")}<Input value={prefix} maxLength={80} onChange={event => setPrefix(event.target.value)} className="mt-1 px-3 py-2 text-sm" /></label>
          <label className="w-36 text-xs text-zinc-400">{t("links.country")}<Input value={country} maxLength={5} placeholder="33 / 86" onChange={event => setCountry(event.target.value)} className="mt-1 px-3 py-2 text-sm" /></label>
          <label className="w-28 text-xs text-zinc-400">{t("links.start")}<Input type="number" min={1} max={999998000} value={start} onChange={event => setStart(event.target.value)} className="mt-1 px-3 py-2 text-sm" /></label>
        </div>
        <p className="text-xs leading-5 text-zinc-500">{t("links.ruleHint")}</p>
        <label className="block text-sm text-zinc-300">{t("links.message")}<Textarea value={message} rows={2} onChange={event => setMessage(event.target.value)} placeholder={t("links.messageHint")} className="mt-1 px-3 text-sm leading-5" /></label>
        <label className="block text-sm text-zinc-300">{t("links.paste")}<Textarea ref={pasteInput} value={text} rows={4} onChange={event => setText(event.target.value)} placeholder={EXAMPLE} className="mt-1 px-3 text-sm leading-6" /></label>
        <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-zinc-500">{t("vcf.summary", { count: parsed.contacts.length, duplicates: parsed.duplicates, errors: parsed.issues.length })}</p><div className="flex gap-2"><Button size="xs" onClick={() => setText(EXAMPLE)}>{t("links.example")}</Button><Button size="xs" disabled={!text} onClick={() => setText("")}>{t("links.clear")}</Button></div></div>
        {(code === null || !validStart || generated.error || parsed.issues.length > 0) && <div role="alert" className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-500">
          {code === null && <p>{t("links.invalidCountry")}</p>}{!validStart && <p>{t("links.invalidStart")}</p>}{generated.error && <p>{t("links.tooLong")}</p>}
          {parsed.issues.slice(0, 10).map((issue, index) => <p key={index}>{issue.line ? t("vcf.line", { line: issue.line }) : ""}{t(issue.kind === "format" ? "links.formatError" : `vcf.issue.${issue.kind}`, { max: MAX_PASTED_CONTACTS })}</p>)}
        </div>}
        {generated.entries.length > 0 && <div className="max-h-56 overflow-auto rounded-lg border border-zinc-800"><table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500"><tr><th className="w-1/4 px-3 py-2 font-medium">{t("vcf.finalName")}</th><th className="w-1/4 px-3 py-2 font-medium">{t("vcf.phone")}</th><th className="px-3 py-2 font-medium">{t("links.result")}</th></tr></thead>
          <tbody>{generated.entries.slice(0, 100).map(entry => <tr key={entry.phone} className="border-t border-zinc-800"><td className="break-words px-3 py-2 text-zinc-200">{entry.name}</td><td className="break-all px-3 py-2 tabular-nums text-zinc-400">{entry.phone}</td><td className="px-3 py-2"><span className="line-clamp-2 break-all text-xs text-brand" title={entry.url}>{entry.url}</span></td></tr>)}</tbody></table></div>}
        {generated.entries.length > 100 && <p className="text-xs text-zinc-500">{t("links.previewLimit")}</p>}
        {output.length > MAX_CHAT_DRAFT_LENGTH && <p className="text-xs text-amber-500">{t("links.draftTooLong", { max: MAX_CHAT_DRAFT_LENGTH })}</p>}
        {feedback && <p role="status" className="text-xs text-zinc-400">{feedback}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
        <p className="max-w-xs text-xs leading-5 text-zinc-500">{t(canInsert ? "links.insertHint" : "links.insertUnavailable")}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!output} onClick={() => { try { downloadText("contact-links.csv", contactLinksCsv(generated.entries), "text/csv;charset=utf-8"); setFeedback(t("links.exported")); } catch { setFeedback(t("links.failed")); } }}>{t("links.csv")}</Button>
          <Button disabled={!output || copying} onClick={async () => { setCopying(true); try { await navigator.clipboard.writeText(output); setFeedback(t("links.copied")); } catch { setFeedback(t("links.failed")); } finally { setCopying(false); } }}>{t("links.copy")}</Button>
          <Button variant="primary" disabled={!output || !canInsert || output.length > MAX_CHAT_DRAFT_LENGTH} onClick={() => { try { if (onInsert(output)) onClose(); } catch { setFeedback(t("links.failed")); } }}>{t("links.insert")}</Button>
        </div>
      </footer>
    </div>
  </div>;
}
