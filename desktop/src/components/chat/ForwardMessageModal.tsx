import { Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";

export type ForwardTarget = {
  chatId: string;
  accountId?: string;
  label: string;
  subtitle: string;
  recipient: string;
};

type Props = {
  preview: string;
  targets: ForwardTarget[];
  sending: boolean;
  onClose: () => void;
  onSend: (targets: ForwardTarget[]) => Promise<string[]>;
};

export function ForwardMessageModal({ preview, targets, sending, onClose, onSend }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q
      ? targets.filter((target) => `${target.label} ${target.subtitle}`.toLocaleLowerCase().includes(q))
      : targets;
  }, [query, targets]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, sending]);

  const chosen = targets.filter((target) => selected.includes(target.chatId));
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" onPointerDown={() => !sending && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t("forward.title")} className="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onPointerDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">{t("forward.title")}</div>
            <div className="mt-0.5 max-w-xs truncate text-2xs text-zinc-500">{preview}</div>
          </div>
          <button type="button" disabled={sending} onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40" aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="m-3 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("forward.search")} className="h-9 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-zinc-600" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((target) => {
            const checked = selected.includes(target.chatId);
            return (
              <label key={target.chatId} className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-zinc-800/80">
                <input type="checkbox" checked={checked} onChange={() => setSelected((items) => checked ? items.filter((id) => id !== target.chatId) : [...items, target.chatId])} className="accent-emerald-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-zinc-100">{target.label}</span>
                  <span className="block truncate text-2xs text-zinc-500">{target.subtitle}</span>
                </span>
              </label>
            );
          })}
          {visible.length === 0 && <div className="py-10 text-center text-[11px] text-zinc-600">{t("forward.empty")}</div>}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <span className="text-2xs text-zinc-500">{t("forward.selected", { count: chosen.length })}</span>
          <button type="button" disabled={!chosen.length || sending} onClick={() => void onSend(chosen).then(setSelected)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="h-3.5 w-3.5" />
            {sending ? t("forward.sending") : t("forward.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
