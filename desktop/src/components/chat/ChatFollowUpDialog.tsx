import { CalendarClock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";

function tomorrowAtTen(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function normalizeDueAt(value?: string): string {
  if (!value) return tomorrowAtTen();
  return value.length === 10 ? `${value}T10:00` : value.slice(0, 16);
}

type Props = {
  contactName: string;
  initialDueAt?: string;
  initialNote?: string;
  onClose: () => void;
  onSubmit: (dueAt: string, note: string) => void;
};

export function ChatFollowUpDialog({
  contactName,
  initialDueAt,
  initialNote,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const [dueAt, setDueAt] = useState(normalizeDueAt(initialDueAt));
  const [note, setNote] = useState(initialNote || "");

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("followDialog.title")}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (dueAt) onSubmit(dueAt, note.trim());
        }}
      >
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-brand" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-100">{t("followDialog.title")}</h2>
            <p className="truncate text-2xs text-zinc-500">{contactName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mb-3 block text-[11px] text-zinc-400">
          {t("followDialog.time")}
          <Input
            type="datetime-local"
            required
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className="mt-1 h-9"
          />
        </label>
        <label className="block text-[11px] text-zinc-400">
          {t("followDialog.note")}
          <Textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("followDialog.notePlaceholder")}
            className="mt-1"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!dueAt}>{t("followDialog.save")}</Button>
        </div>
      </form>
    </div>
  );
}
