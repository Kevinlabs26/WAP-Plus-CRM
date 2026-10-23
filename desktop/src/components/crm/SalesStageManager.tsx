import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import { salesStagesWithLabels } from "@/lib/contactWorkflow";
import { useI18n } from "@/i18n";

export function SalesStageManager({ onClose, focusStageId }: { onClose: () => void; focusStageId?: string }) {
  const { t } = useI18n();
  const settings = useAppStore(s => s.settings);
  const contacts = useAppStore(s => s.contacts);
  const stages = salesStagesWithLabels(settings.salesStageLabels, settings.salesStageOrder);
  const [newName, setNewName] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = stages.find(stage => stage.id === removing);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const contact of contacts) result.set(contact.stage, (result.get(contact.stage) || 0) + 1);
    return result;
  }, [contacts]);
  const count = counts.get(removing || "") || 0;

  useEffect(() => {
    const previous = document.activeElement;
    (inputRef.current || closeRef.current)?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const current = () => {
    const store = useAppStore.getState();
    return { store, stages: salesStagesWithLabels(store.settings.salesStageLabels, store.settings.salesStageOrder) };
  };
  const rename = (id: string, raw: string) => {
    const { store, stages } = current();
    const stage = stages.find(stage => stage.id === id);
    if (!stage) { store.pushToast(t("crm.stageUnavailable"), "info"); return; }
    const label = raw.trim().slice(0, 20);
    if (!label) { store.pushToast(t("crm.stageNameRequired"), "info"); return; }
    if (label !== stage.label) store.updateSettings({ salesStageLabels: { ...store.settings.salesStageLabels, [id]: label } });
  };
  const move = (id: string, offset: number) => {
    const { store, stages } = current();
    const order = stages.map(stage => stage.id), index = order.indexOf(id), next = index + offset;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    store.updateSettings({ salesStageOrder: order });
  };
  const add = () => {
    const label = newName.trim().slice(0, 20);
    if (!label) return;
    const { store, stages } = current();
    if (stages.length >= 20) { store.pushToast(t("crm.stageLimit"), "info"); return; }
    const id = `stage_${crypto.randomUUID().replace(/-/g, "")}`;
    store.updateSettings({ salesStageOrder: [...stages.map(stage => stage.id), id], salesStageLabels: { ...store.settings.salesStageLabels, [id]: label } });
    setNewName("");
  };
  const cancelRemoval = () => {
    setRemoving(null);
    setTargetId("");
    closeRef.current?.focus();
  };
  const remove = () => {
    if (!selected || !targetId) return;
    const store = useAppStore.getState();
    const deleted = store.deleteSalesStage(selected.id, targetId);
    store.pushToast(t(deleted ? "crm.stageDeleted" : "crm.stageUnavailable"), deleted ? "success" : "info");
    cancelRemoval();
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sales-stage-manager-title"
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            if (removing) cancelRemoval(); else onClose();
          }
          if (event.key !== "Tab") return;
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="flex items-start gap-3 border-b border-zinc-800 p-4">
          <div className="min-w-0 flex-1">
            <h2 id="sales-stage-manager-title" className="text-base font-semibold text-zinc-100">{t("crm.manageStages")}</h2>
            <p className="mt-1 text-[13px] leading-5 text-zinc-400">{t("crm.manageStagesHint")}</p>
          </div>
          <button ref={closeRef} type="button" aria-label={t("common.close")} onClick={onClose} className="ui-btn-ghost !min-h-8 w-8 !px-0"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 overflow-y-auto p-4">
          {stages.map((stage, index) => (
            <div key={stage.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 p-2">
              <Input ref={stage.id === focusStageId ? inputRef : undefined} value={drafts[stage.id] ?? stage.label} maxLength={20}
                disabled={Boolean(removing)} aria-label={t("crm.stageName") + ` · ${stage.label}`}
                className="min-w-0 flex-1"
                onChange={event => setDrafts(previous => ({ ...previous, [stage.id]: event.target.value }))}
                onBlur={event => {
                  rename(stage.id, event.target.value);
                  setDrafts(previous => { const next = { ...previous }; delete next[stage.id]; return next; });
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); closeRef.current?.focus(); }
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.value = stage.label; event.currentTarget.blur(); closeRef.current?.focus(); }
                }} />
              <span className="shrink-0 text-2xs tabular-nums text-zinc-500">{counts.get(stage.id) || 0}</span>
              <button type="button" disabled={Boolean(removing) || index === 0} title={t("crm.stageUp")} aria-label={t("crm.stageUp") + ` · ${stage.label}`} className="ui-btn-ghost !min-h-8 w-8 !px-0" onClick={() => move(stage.id, -1)}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={Boolean(removing) || index === stages.length - 1} title={t("crm.stageDown")} aria-label={t("crm.stageDown") + ` · ${stage.label}`} className="ui-btn-ghost !min-h-8 w-8 !px-0" onClick={() => move(stage.id, 1)}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" disabled={Boolean(removing) || stages.length === 1} title={t(stages.length === 1 ? "crm.keepOneStage" : "crm.deleteStage")} aria-label={t("crm.deleteStage") + ` · ${stage.label}`} className="ui-btn-ghost !min-h-8 w-8 !px-0 hover:text-rose-400" onClick={() => { setRemoving(stage.id); setTargetId(""); }}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {selected && (
            <div className="space-y-3 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3">
              <p className="text-[13px] font-medium text-zinc-100">{t("crm.deleteStageTitle", { stage: selected.label })}</p>
              <p className="text-[13px] leading-5 text-zinc-400">{t("crm.stageDeleteHint", { count })}</p>
              {selected.id === "won" && <p className="text-2xs text-zinc-400">{t("crm.stageDeleteStatsHint")}</p>}
              <label className="block text-[13px] text-zinc-300">{t("crm.stageMoveTarget")}
                <select autoFocus className="ui-control mt-1 w-full px-2 py-2" value={targetId} onChange={event => setTargetId(event.target.value)}>
                  <option value="">{t("crm.chooseStage")}</option>
                  {stages.filter(stage => stage.id !== selected.id).map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={cancelRemoval}>{t("common.cancel")}</Button>
                <button type="button" disabled={!stages.some(stage => stage.id === targetId && stage.id !== selected.id)} onClick={remove} className="ui-btn-secondary border-rose-500/40 text-rose-400">{t("crm.deleteStage")}</button>
              </div>
            </div>
          )}
          <form className="flex gap-2 pt-2" onSubmit={event => { event.preventDefault(); add(); }}>
            <Input value={newName} maxLength={20} disabled={Boolean(removing) || stages.length >= 20} aria-label={t("crm.newStage")} placeholder={t("crm.stageName")} onChange={event => setNewName(event.target.value)} />
            <Button type="submit" disabled={Boolean(removing) || stages.length >= 20 || !newName.trim()} className="shrink-0"><Plus className="h-4 w-4" />{t("crm.addStage")}</Button>
          </form>
          <p className="text-2xs leading-5 text-zinc-500">{t(stages.length >= 20 ? "crm.stageLimit" : "crm.stageNewDefaultHint")}</p>
        </div>
      </div>
    </div>
  );
}
