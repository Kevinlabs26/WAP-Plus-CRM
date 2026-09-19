import { Search, Send, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Contact } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  contacts: Contact[];
  sending: boolean;
  onClose: () => void;
  onSend: (contact: Contact) => Promise<void>;
};

export function ContactCardPicker({ contacts, sending, onClose, onSend }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const rows = contacts.filter((contact) => {
      if (contact.isGroup) return false;
      const digits = contact.phone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return false;
      return !q || `${contact.name} ${contact.phone}`.toLocaleLowerCase().includes(q);
    });
    return rows.slice(0, 100);
  }, [contacts, query]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, sending]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
      onPointerDown={() => !sending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("contactCard.title")}
        className="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">{t("contactCard.title")}</div>
            <div className="mt-0.5 text-2xs text-zinc-500">{t("contactCard.hint")}</div>
          </div>
          <button type="button" disabled={sending} onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40" aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="m-3 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("contactCard.search")} className="h-9 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-600" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((contact) => (
            <button
              key={contact.id}
              type="button"
              disabled={sending}
              onClick={() => void onSend(contact)}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-zinc-800/80 disabled:opacity-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
                <UserRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-zinc-100">{contact.name || contact.phone}</span>
                <span className="block truncate font-mono text-2xs text-zinc-500">{contact.phone}</span>
              </span>
              <Send className="h-3.5 w-3.5 text-brand" />
            </button>
          ))}
          {visible.length === 0 && (
            <div className="py-10 text-center text-[11px] text-zinc-600">{t("contactCard.empty")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
