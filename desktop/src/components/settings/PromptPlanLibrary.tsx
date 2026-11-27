import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Button, Input } from "@/components/ui/primitives";
import { normalizePromptPlan, validatePromptPlanDefinition, type PromptPlan, type PromptPlanRule } from "@/lib/promptPlans";
import { outreachClock } from "@/lib/aiOutreachRules";
import { systemTimeZone, validTimeZone } from "@/lib/timeZone";
import type { AppSettings } from "@/store/types";
import { PromptPlanFields } from "./PromptPlanFields";

function migrateRotationBindings(settings: AppSettings, id: string) {
  const defaultZone = validTimeZone(settings.aiTimeZone) || systemTimeZone() || "UTC";
  let initialized = 0;
  const migrate = (plan?: PromptPlan) => {
    if (plan?.mode !== "saved" || plan.planId !== id) return plan;
    const normalized = normalizePromptPlan(plan);
    if (normalized?.mode === "saved" && normalized.startDate && normalized.switchTime && normalized.timeZone) return plan;
    initialized++;
    const timeZone = validTimeZone(plan.timeZone) || defaultZone;
    return { ...plan, startDate: outreachClock(timeZone).day, switchTime: "09:00", timeZone };
  };
  const chatFolders = settings.chatFolders.map(folder => {
    const aiPromptPlan = migrate(folder.aiPromptPlan);
    return aiPromptPlan === folder.aiPromptPlan ? folder : { ...folder, aiPromptPlan };
  });
  const aiPromptPlanByChat: NonNullable<AppSettings["aiPromptPlanByChat"]> = {};
  for (const [key, plan] of Object.entries(settings.aiPromptPlanByChat || {})) {
    const migrated = migrate(plan);
    if (migrated) aiPromptPlanByChat[key] = migrated;
  }
  return { chatFolders, aiPromptPlanByChat, initialized };
}

function planInUse(settings: AppSettings, id: string) {
  return settings.chatFolders.some(folder => folder.aiPromptPlan?.mode === "saved" && folder.aiPromptPlan.planId === id)
    || Object.values(settings.aiPromptPlanByChat || {}).some(plan => plan?.mode === "saved" && plan.planId === id);
}

export function PromptPlanLibrary() {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const plans = settings.aiPromptPlans || [];
  const templates = settings.aiPromptTemplates || [];
  const [id, setId] = useState(plans[0]?.id || "");
  const selected = plans.find(plan => plan.id === id);
  const [name, setName] = useState(selected?.name || "");
  const [draft, setDraft] = useState<PromptPlan | undefined>(selected?.plan);
  const dirty = name !== (selected?.name || "") || JSON.stringify(draft) !== JSON.stringify(selected?.plan);
  const invalid = !draft || !!validatePromptPlanDefinition(draft, templates).error;

  const load = (nextId: string) => {
    const plan = plans.find(item => item.id === nextId);
    setId(nextId);
    setName(plan?.name || "");
    setDraft(plan?.plan);
  };
  const select = async (nextId: string, force = false) => {
    if (nextId === id && !force) return true;
    if (dirty && !await useAppStore.getState().requestConfirm({
      title: t("aiLibrary.unsavedDraft"), description: t("aiLibrary.discardDescription"),
      confirmLabel: t("aiLibrary.discardDraft"), cancelLabel: t("settings.keepEditing"), tone: "danger",
    })) return false;
    load(nextId);
    return true;
  };
  const create = async () => {
    if (id === "" && !dirty) return;
    await select("", true);
  };
  const save = () => {
    if (!name.trim() || !draft || draft.mode === "saved" || draft.mode === "conflict" || draft.mode === "missing" || invalid) return;
    const state = useAppStore.getState();
    const current = state.settings.aiPromptPlans || [];
    const cleanName = name.trim().slice(0, 80);
    if (current.some(plan => plan.id !== id && plan.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      state.pushToast(t("promptPlan.duplicate"), "error"); return;
    }
    if (!id && current.length >= 100) { state.pushToast(t("promptPlan.capacity"), "error"); return; }
    if (id && !current.some(plan => plan.id === id)) return;
    const definition: PromptPlanRule = draft.mode === "rotation"
      ? { mode: draft.mode, templateIds: draft.templateIds, loop: draft.loop }
      : draft;
    const next = { id: id || crypto.randomUUID(), name: cleanName, plan: definition };
    const previous = current.find(plan => plan.id === id);
    const rotationBindings = previous?.plan.mode === "fixed" && definition.mode === "rotation"
      ? migrateRotationBindings(state.settings, id) : undefined;
    state.updateSettings({ aiPromptPlans: id ? current.map(plan => plan.id === id ? next : plan) : [...current, next],
      ...(rotationBindings ? { chatFolders: rotationBindings.chatFolders, aiPromptPlanByChat: rotationBindings.aiPromptPlanByChat } : {}) });
    if (rotationBindings?.initialized) state.pushToast(t("promptPlan.rotationScheduleDefaultsApplied", { count: rotationBindings.initialized }), "info");
    setId(next.id); setName(next.name); setDraft(next.plan);
  };
  const remove = async () => {
    const state = useAppStore.getState();
    if (!id || planInUse(state.settings, id)) return;
    if (!await state.requestConfirm({ title: t("promptPlan.deleteTitle", { name: selected?.name || name }), description: t("promptPlan.deleteHint"), confirmLabel: t("common.delete"), tone: "danger" })) return;
    const remaining = (useAppStore.getState().settings.aiPromptPlans || []).filter(plan => plan.id !== id);
    useAppStore.getState().updateSettings({ aiPromptPlans: remaining });
    load(remaining[0]?.id || "");
  };

  return <section className="space-y-3 border-t border-zinc-800 pt-4">
    <div>
      <h4 className="text-sm font-semibold">{t("promptPlan.library")} · {plans.length}</h4>
      <p className="mt-1 text-xs text-zinc-500">{t("promptPlan.libraryHint")}</p>
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.5fr)]">
      <aside className="min-w-0 space-y-2">
        <Button disabled={plans.length >= 100} onClick={() => void create()}>{t("promptPlan.new")}</Button>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {plans.map(plan => <Button key={plan.id} size="sm" variant={plan.id === id ? "primary" : "ghost"}
            className="h-auto w-full justify-start text-left" aria-pressed={plan.id === id} onClick={() => void select(plan.id)}>
            <span className="min-w-0 flex-1 truncate">{plan.name}</span>
            <span className="ml-2 shrink-0 text-2xs opacity-70">{t(plan.plan.mode === "fixed" ? "promptPlan.fixed" : "promptPlan.rotation")}</span>
          </Button>)}
          {!plans.length && <p className="px-2 py-3 text-xs text-zinc-500">{t("promptPlan.empty")}</p>}
        </div>
      </aside>
      <div className="min-w-0 space-y-2">
        <Input maxLength={80} value={name} aria-label={t("promptPlan.name")} placeholder={t("promptPlan.name")} onChange={event => setName(event.target.value)} />
        <PromptPlanFields value={draft} onChange={setDraft} inheritLabel={t("promptPlan.chooseType")} showLibraryLink={false} definitionOnly />
        {dirty && <p role="status" className="text-2xs text-amber-500">{t("aiLibrary.unsavedDraft")}</p>}
        {id && selected?.plan.mode === "fixed" && draft?.mode === "rotation" && planInUse(settings, id)
          && <p role="status" className="text-2xs text-amber-500">{t("promptPlan.rotationScheduleMigrationHint")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!name.trim() || invalid || !!id && !selected} onClick={save}>{t(id ? "dialog.save" : "promptPlan.createAndSave")}</Button>
          <Button disabled={!id || planInUse(settings, id)} title={id && planInUse(settings, id) ? t("promptPlan.inUse") : t("common.delete")} onClick={() => void remove()}>{t("common.delete")}</Button>
        </div>
      </div>
    </div>
  </section>;
}
