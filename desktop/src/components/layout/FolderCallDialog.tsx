import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n";
import { cloneCallInvoke } from "@/lib/cloneCalls";
import { filterFolderCallRows, folderCallDecision, folderCallDirectTarget, folderCallRows, runFolderCallQueue, type FolderCallStatus } from "@/lib/folderCallQueue";
import { loadLatestOutgoingMessage } from "@/lib/storage";
import { flushPersist, useAppStore } from "@/store/appStore";
import { isDataRestoreActive } from "@/store/restoreGuard";

export function FolderCallDialog({ folderId, folderName, onClose }: {
  folderId: string;
  folderName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const request = useRef<string | null>(null);
  const resume = useRef<(() => void) | null>(null);
  const [candidates] = useState(() => folderCallRows(useAppStore.getState(), folderId));
  const [mode, setMode] = useState<"all" | "paste">("all");
  const [requireDelivery, setRequireDelivery] = useState(true);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"setup" | "running" | "paused" | "cooldown" | "done" | "stopped">("setup");
  const [results, setResults] = useState<Record<number, FolderCallStatus>>({});
  const [error, setError] = useState("");
  const pasted = filterFolderCallRows(candidates, text);
  const rows = mode === "all" ? candidates : pasted.selected;
  const live = phase === "running" || phase === "paused" || phase === "cooldown";

  const abort = () => {
    controller.current?.abort();
    resume.current?.();
    resume.current = null;
    if (request.current) {
      void cloneCallInvoke("clone_call_cancel", { requestId: request.current }).catch(console.error);
    }
  };

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      abort();
      element?.close();
    };
  }, []);

  const start = async () => {
    if (controller.current || !rows.length) return;
    const run = new AbortController();
    controller.current = run;
    setPhase("running");
    try {
      await runFolderCallQueue(rows, {
        signal: run.signal,
        check: async row => {
          if (isDataRestoreActive()) return "unknown";
          if (!requireDelivery) return folderCallDirectTarget(row, useAppStore.getState());
          await flushPersist(useAppStore.getState);
          const stored = await Promise.all(row.chatIds.map(loadLatestOutgoingMessage));
          if (isDataRestoreActive()) return "unknown";
          return folderCallDecision(row, useAppStore.getState(), stored);
        },
        dial: async target => {
          const requestId = crypto.randomUUID();
          request.current = requestId;
          try {
            return await cloneCallInvoke<boolean>("clone_call_start", {
              ownerPhone: target.ownerPhone, recipientPhone: target.recipientPhone, requestId, waitForEnd: true,
            });
          } finally {
            request.current = null;
          }
        },
        status: (index, status, detail) => {
          setResults(previous => ({ ...previous, [index]: status }));
          if (status === "paused") setError(detail || "");
        },
        waitForUser: () => new Promise(resolve => {
          resume.current = resolve;
          setPhase("paused");
        }),
        wait: async ms => {
          setPhase("cooldown");
          await new Promise<void>(resolve => {
            const finish = () => {
              clearTimeout(timer);
              run.signal.removeEventListener("abort", finish);
              resolve();
            };
            const timer = window.setTimeout(finish, ms);
            run.signal.addEventListener("abort", finish, { once: true });
          });
          if (!run.signal.aborted) setPhase("running");
        },
      });
      if (!run.signal.aborted) setPhase("done");
    } finally {
      controller.current = null;
    }
  };

  return createPortal(
    <dialog ref={dialog} aria-labelledby="folder-call-title"
      onCancel={event => { event.preventDefault(); if (!live) onClose(); }}
      className="m-auto w-[min(92vw,36rem)] max-w-none rounded-xl border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/65">
      <section className="flex max-h-[85dvh] flex-col gap-4 p-5">
        <header>
          <h2 id="folder-call-title" className="text-base font-semibold">{t("folderCall.title")}</h2>
          <p className="mt-1 truncate text-sm text-zinc-400">{folderName}</p>
        </header>
        {phase === "setup" && <fieldset className="space-y-3 text-sm">
          <legend className="sr-only">{t("folderCall.recipients")}</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input type="radio" name="folder-call-mode" checked={mode === "all"} onChange={() => setMode("all")} />
            {t("folderCall.all")}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="folder-call-mode" checked={mode === "paste"} onChange={() => setMode("paste")} />
            {t("folderCall.paste")}
          </label>
          {mode === "paste" && <>
            <textarea aria-label={t("folderCall.paste")} value={text} onChange={event => setText(event.target.value)}
              placeholder={t("folderCall.placeholder")} rows={4}
              className="block w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 placeholder:text-zinc-500" />
            {(pasted.invalid > 0 || pasted.unmatched > 0) && <p className="text-amber-400">
              {t("folderCall.pasteSkipped", { invalid: pasted.invalid, unmatched: pasted.unmatched })}
            </p>}
          </>}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={requireDelivery} onChange={event => setRequireDelivery(event.target.checked)} />
            {t("folderCall.requireDelivery")}
          </label>
        </fieldset>}
        <p role="status" className="text-sm text-zinc-300">
          {t(phase === "setup" && !requireDelivery ? "folderCall.setupDirect" : `folderCall.${phase}`, { count: rows.length })}
        </p>
        {phase === "paused" && error && <p role="alert" className="text-sm text-amber-400">{error}</p>}
        {rows.length > 0 && <ol aria-label={t("folderCall.recipients")} className="min-h-0 overflow-y-auto divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {rows.map((row, index) => <li key={row.phone} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={row.name} seed={row.phone} src={row.avatarUrl} size="md" />
              <span className="min-w-0">
                <span className="block truncate">{row.name}</span>
                {row.name !== row.phone && <span className="block text-xs text-zinc-400">{row.phone}</span>}
              </span>
            </span>
            {phase !== "setup" && <span className="shrink-0 text-xs text-zinc-400">
              {t(`folderCall.status.${results[index] || "waiting"}`)}
            </span>}
          </li>)}
        </ol>}
        <footer className="flex justify-end gap-2">
          {live ? <button type="button" className="ui-btn-secondary" onClick={() => { abort(); setPhase("stopped"); }}>
            {t("folderCall.stop")}
          </button> : <button type="button" className="ui-btn-secondary" onClick={onClose}>{t("common.close")}</button>}
          {phase === "setup" && <button type="button" className="ui-btn-primary" disabled={!rows.length} onClick={() => void start()}>
            {t("folderCall.start")}
          </button>}
          {phase === "paused" && <button type="button" className="ui-btn-primary" onClick={() => {
            const proceed = resume.current;
            resume.current = null;
            setError("");
            setPhase("running");
            proceed?.();
          }}>{t("folderCall.continue")}</button>}
        </footer>
      </section>
    </dialog>,
    document.body,
  );
}
