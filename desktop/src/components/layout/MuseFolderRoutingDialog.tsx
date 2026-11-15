import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { sheetConnections } from "@/lib/googleSheets";
import {
  buildMuseFolderRoutingSnapshot,
  classifyMuseFolderCandidates,
  isMuseRoutingFolder,
  type MuseFolderDecision,
  type MuseFolderSnapshot,
} from "@/lib/museFolderRouting";
import { useAppStore, flushPersist } from "@/store/appStore";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";

export function MuseFolderRoutingDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const [rules, setRules] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<MuseFolderSnapshot | null>(null);
  const [decisions, setDecisions] = useState<MuseFolderDecision[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const [classified, setClassified] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const connections = sheetConnections();
  const fields = [...new Set(connections.flatMap(connection =>
    connection.config.fields.map(field => field.label.trim()).filter(Boolean)
  ))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const destinations = (settings.chatFolders || []).filter(folder => isMuseRoutingFolder(folder.id, settings.chatFolders));

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };
  const resetResults = () => {
    setSnapshot(null);
    setDecisions([]);
    setClassified(false);
    setError("");
  };
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    setBusy(true);
    setError("");
    setApplied(false);
    setClassified(false);
    setSnapshot(null);
    setDecisions([]);
    setCompleted(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const current = useAppStore.getState();
      const next = buildMuseFolderRoutingSnapshot(
        current.contacts,
        current.chats,
        current.settings,
        sheetConnections(),
        selectedFields,
        rules,
      );
      setSnapshot(next);
      if (!next.candidates.length) return;
      const result = await classifyMuseFolderCandidates(
        next.candidates,
        next.destinations,
        rules,
        controller.signal,
        setCompleted,
      );
      setDecisions(result);
      setClassified(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      abortRef.current = null;
    }
  };

  const apply = async () => {
    if (!snapshot) return;
    const current = useAppStore.getState();
    const contactById = new Map(current.contacts.map(contact => [contact.id, contact]));
    const chatById = new Map(current.chats.map(chat => [chat.id, chat]));
    const assignments = decisions.flatMap(decision => {
      const candidate = snapshot.candidates.find(item => item.ref === decision.ref);
      const folder = snapshot.destinations.find(item => item.key === decision.folderKey);
      const liveFolder = folder && current.settings.chatFolders.find(item => item.id === folder.id);
      if (!candidate || !folder || !liveFolder) return [];
      const chatIds = candidate.chatIds.filter(chatId => chatById.has(chatId));
      const accountId = liveFolder.scope?.type === "all" ? undefined :
        liveFolder.scope?.accountId || current.settings.liveBaileysAccountId || current.settings.activeAccountId || DEFAULT_ACCOUNT_ID;
      if (accountId && !chatIds.every(chatId => {
        const chat = chatById.get(chatId);
        const contact = chat && contactById.get(chat.contactId);
        return !!chat && (chat.accountId || chat.phoneId || contact?.accountId || DEFAULT_ACCOUNT_ID) === accountId;
      })) return [];
      return chatIds.map(chatId => ({ chatId, folderId: folder.id }));
    });
    if (!assignments.length) {
      setError(t("museRouting.noValidMoves"));
      return;
    }
    setApplying(true);
    try {
      const count = current.moveChatsToFolders(assignments);
      if (!count) {
        setError(t("museRouting.noValidMoves"));
        return;
      }
      await flushPersist(() => useAppStore.getState());
      setApplied(true);
      useAppStore.getState().pushToast(t("museRouting.applied", { count }), "success");
    } catch (cause) {
      useAppStore.getState().pushToast(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setApplying(false);
    }
  };

  const destinationByKey = new Map(snapshot?.destinations.map(folder => [folder.key, folder]) || []);
  const candidateByRef = new Map(snapshot?.candidates.map(candidate => [candidate.ref, candidate]) || []);
  const planned = decisions.filter(decision => decision.folderKey && destinationByKey.has(decision.folderKey));
  const canRun = !!rules.trim() && selectedFields.length > 0 && destinations.length > 0 && fields.length > 0;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4" onClick={close}>
      <section role="dialog" aria-modal="true" aria-labelledby="muse-routing-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") close(); }}>
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 id="muse-routing-title" className="text-base font-semibold text-zinc-100">{t("museRouting.title")}</h2>
          <button type="button" className="ui-btn-ghost px-3 py-1.5" onClick={close}>{t("settings.close")}</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-zinc-300">{t("museRouting.disclosure")}</p>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-2 font-medium text-zinc-200">{t("museRouting.fields")}</legend>
            {fields.length ? <div className="flex flex-wrap gap-2">
              {fields.map(field => <label key={field} className="flex items-center gap-2 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300">
              <input type="checkbox" checked={selectedFields.includes(field)} disabled={busy || (!selectedFields.includes(field) && selectedFields.length >= 5)}
                  onChange={event => { resetResults(); setSelectedFields(current => event.target.checked ? [...current, field] : current.filter(item => item !== field)); }} />
                {field}
              </label>)}
            </div> : <p className="text-xs text-amber-400">{t("museRouting.noFields")}</p>}
            <p className="text-xs text-zinc-500">{t("museRouting.fieldsHint")}</p>
          </fieldset>
          <label className="block font-medium text-zinc-200">{t("museRouting.rules")}
            <textarea value={rules} onChange={event => { resetResults(); setRules(event.target.value); }} disabled={busy} rows={5} maxLength={6000}
              placeholder={t("museRouting.rulesPlaceholder")} className="ui-control mt-1.5 min-h-28 w-full resize-y p-3 text-xs font-normal" />
          </label>
          {!destinations.length && <p className="text-xs text-amber-400">{t("museRouting.noFolders")}</p>}
          <div className="flex items-center gap-2">
            <button type="button" disabled={!canRun || busy} onClick={() => void run()} className="ui-btn-primary px-3 py-2 disabled:opacity-45">
              {busy ? t("museRouting.analyzing", { completed, total: snapshot?.candidates.length || 0 }) : t("museRouting.start")}
            </button>
            {busy && <button type="button" className="ui-btn-secondary px-3 py-2" onClick={close}>{t("dialog.cancel")}</button>}
            {applying && <span role="status" className="text-xs text-zinc-400">{t("museRouting.applying")}</span>}
            {classified && snapshot && !busy && !applying && !applied && planned.length > 0 && <button type="button" className="ui-btn-primary px-3 py-2" onClick={() => void apply()}>{t("museRouting.apply", { count: planned.length })}</button>}
          </div>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          {snapshot && <div className="space-y-3 border-t border-zinc-800 pt-3">
            <h3 className="font-medium text-zinc-200">{t("museRouting.results", { count: snapshot.candidates.length })}</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              {snapshot.destinations.map(folder => {
                const count = planned.filter(item => item.folderKey === folder.key).length;
                return count ? <span key={folder.key} className="rounded-md bg-zinc-800 px-2 py-1 text-zinc-300">{folder.label} · {count}</span> : null;
              })}
              <span className="rounded-md bg-zinc-800 px-2 py-1 text-zinc-400">{t("museRouting.noMatch", { count: decisions.length - planned.length })}</span>
            </div>
            {Object.entries(snapshot.skipped).length > 0 && <p className="text-xs text-amber-400">{t("museRouting.skipped")}: {Object.entries(snapshot.skipped).map(([reason, count]) => `${reason} ${count}`).join("、")}</p>}
            <div className="max-h-56 overflow-auto rounded-lg border border-zinc-800">
              {decisions.map(decision => {
                const candidate = candidateByRef.get(decision.ref);
                const folder = destinationByKey.get(decision.folderKey || "");
                if (!candidate) return null;
                return <div key={decision.ref} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-zinc-800 px-3 py-2 last:border-b-0 text-xs">
                  <span className="font-medium text-zinc-200">{candidate.name}</span>
                  <span className={folder ? "text-emerald-400" : "text-zinc-500"}>{folder?.label || decision.reason}</span>
                </div>;
              })}
              {busy && <p className="px-3 py-2 text-xs text-zinc-500">{t("museRouting.analyzing", { completed, total: snapshot.candidates.length })}</p>}
              {!busy && decisions.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">{t("museRouting.noCandidates")}</p>}
            </div>
          </div>}
        </div>
        <footer className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button type="button" className="ui-btn-secondary px-3 py-2" onClick={close}>{t("settings.close")}</button>
        </footer>
      </section>
    </div>
  );
}
