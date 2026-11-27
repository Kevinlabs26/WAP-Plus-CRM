import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { inactiveFolderPhones, folderPhoneCandidates } from "@/lib/folderUnreplied";
import { useAppStore } from "@/store/appStore";

type Props = {
  folderId: string;
  folderName: string;
  onClose: () => void;
  onCopy: (cutoffMs: number, includeNeverContacted: boolean) => Promise<number | null>;
};

type FilterMode = "days" | "date";

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateEndMs(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  return new Date(year, month - 1, day + 1).getTime() - 1;
}

export function FolderInactiveCopyDialog({ folderId, folderName, onClose, onCopy }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const chats = useAppStore(state => state.chats);
  const contacts = useAppStore(state => state.contacts);
  const messages = useAppStore(state => state.messages);
  const settings = useAppStore(state => state.settings);
  const [mode, setMode] = useState<FilterMode>("days");
  const [days, setDays] = useState("30");
  const [date, setDate] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() - 30);
    return localDateString(value);
  });
  const [includeNeverContacted, setIncludeNeverContacted] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  const candidates = useMemo(() => {
    try {
      return folderPhoneCandidates({ chats, contacts, settings }, folderId);
    } catch {
      return [];
    }
  }, [chats, contacts, folderId, settings]);

  const daysValue = Number(days);
  const validDays = Number.isInteger(daysValue) && daysValue >= 1 && daysValue <= 36500;
  const cutoffMs = mode === "days"
    ? validDays ? Date.now() - daysValue * 24 * 60 * 60 * 1000 : Number.NaN
    : dateEndMs(date);
  const previewCount = useMemo(
    () => inactiveFolderPhones(candidates, chats, messages, cutoffMs, includeNeverContacted).length,
    [candidates, chats, cutoffMs, includeNeverContacted, messages],
  );
  const canCopy = Number.isFinite(cutoffMs) && previewCount > 0 && !busy;

  const copy = async () => {
    if (!canCopy) return;
    setBusy(true);
    try {
      const count = await onCopy(cutoffMs, includeNeverContacted);
      if (count && count > 0) onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <dialog ref={dialog} aria-labelledby="folder-inactive-copy-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto w-[min(92vw,32rem)] max-w-none rounded-xl border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/65">
      <section className="flex max-h-[85dvh] flex-col gap-4 p-5">
        <header>
          <h2 id="folder-inactive-copy-title" className="text-base font-semibold">{t("folder.copyInactiveTitle")}</h2>
          <p className="mt-1 truncate text-sm text-zinc-400">{folderName}</p>
        </header>

        <fieldset className="space-y-3 text-sm">
          <legend className="sr-only">{t("folder.copyInactiveMode")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="folder-inactive-mode" checked={mode === "days"} onChange={() => setMode("days")} />
            <span>{t("folder.copyInactiveDays")}</span>
            <input aria-label={t("folder.copyInactiveDaysInput")} type="number" min={1} max={36500} step={1} value={days}
              onChange={event => setDays(event.target.value)} disabled={mode !== "days"}
              className="h-9 w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 disabled:opacity-50" />
            <span className="text-zinc-400">{t("folder.copyInactiveDaysUnit")}</span>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="folder-inactive-mode" checked={mode === "date"} onChange={() => setMode("date")} />
            <span>{t("folder.copyInactiveBeforeDate")}</span>
            <input aria-label={t("folder.copyInactiveDateInput")} type="date" max={localDateString(new Date())} value={date}
              onChange={event => setDate(event.target.value)} disabled={mode !== "date"}
              className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 disabled:opacity-50" />
          </label>
          <label className="flex items-center gap-2 text-zinc-300">
            <input type="checkbox" checked={includeNeverContacted} onChange={event => setIncludeNeverContacted(event.target.checked)} />
            {t("folder.copyInactiveIncludeNever")}
          </label>
        </fieldset>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
          <p role="status" className="text-sm font-medium text-brand">{t("folder.copyInactivePreview", { count: previewCount })}</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("folder.copyInactiveHint")}</p>
        </div>

        <footer className="flex justify-end gap-2">
          <button type="button" className="ui-btn-secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="ui-btn-primary" disabled={!canCopy} onClick={() => void copy()}>
            {busy ? t("folder.copyInactiveWorking") : t("folder.copyInactiveCopy", { count: previewCount })}
          </button>
        </footer>
      </section>
    </dialog>,
    document.body,
  );
}
