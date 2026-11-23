import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { TimeZoneSelect } from "@/components/ui/TimeZoneSelect";
import { evaluatePromptPlan, MAX_PROMPT_PLAN_DAYS, normalizePromptPlan, type PromptPlan } from "@/lib/promptPlans";
import { outreachClock } from "@/lib/aiOutreachRules";
import { systemTimeZone, validTimeZone } from "@/lib/timeZone";

export function PromptPlanStatus({ plan, now, folderName }: { plan?: PromptPlan; now?: number; folderName?: string }) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const status = evaluatePromptPlan(plan, settings.aiPromptTemplates || [], now, settings.aiPromptPlans || []);
  if (!plan) return null;
  if (status.error) return <p role="alert" className="text-xs text-amber-500">{t(`promptPlan.error.${status.error}`)}</p>;
  return <div role="status" className="space-y-1 text-xs text-zinc-500">
    {folderName && <p>{t("promptPlan.fromFolder", { name: folderName })}</p>}
    <p>{status.current ? t("promptPlan.current", { name: status.current.name }) : t("plan.notStarted")}</p>
    {status.next && status.nextTime && <p>{t("promptPlan.next", { name: status.next.name, time: status.nextTime })}</p>}
  </div>;
}

export function PromptPlanFields({ value, onChange, inheritLabel, now, showLibraryLink = true, definitionOnly = false }: {
  value?: PromptPlan;
  onChange: (value: PromptPlan | undefined) => void;
  inheritLabel: string;
  now?: number;
  showLibraryLink?: boolean;
  definitionOnly?: boolean;
}) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const templates = settings.aiPromptTemplates || [];
  const templateOptions = (id: string) => <>
    <option value="">{t("aiLibrary.choose")}</option>
    {id && !templates.some(template => template.id === id) && <option value={id} disabled>{t("playbook.missing")}</option>}
    {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
  </>;
  return <section className="space-y-2 border-t border-zinc-800/80 pt-2.5 text-xs">
    <label className="block">{t("promptPlan.title")}
      <select className="ui-control mt-1 w-full px-2 py-2" value={value?.mode || ""} onChange={event => {
        const mode = event.target.value;
        if (mode === "fixed") {
          onChange({ mode, templateId: value?.mode === "rotation" ? value.templateIds[0] : "" });
        } else if (mode === "rotation") {
          const timeZone = settings.aiTimeZone || systemTimeZone() || "UTC";
          const rotation = { mode: "rotation" as const, templateIds: [value?.mode === "fixed" ? value.templateId : ""], loop: true };
          onChange(definitionOnly ? rotation : { ...rotation,
            startDate: value?.mode === "rotation" && value.startDate || outreachClock(timeZone, now).day,
            switchTime: value?.mode === "rotation" && value.switchTime || "09:00",
            timeZone: value?.mode === "rotation" && value.timeZone || timeZone });
        } else {
          onChange(undefined);
        }
      }}>
        <option value="">{inheritLabel}</option>
        <option value="fixed">{t("promptPlan.fixed")}</option>
        <option value="rotation">{t("promptPlan.rotation")}</option>
        {value?.mode === "conflict" && <option value="conflict" disabled>{t("promptPlan.error.conflict")}</option>}
      </select>
    </label>
    {value?.mode === "fixed" && <label className="block">{t("aiLibrary.choose")}
      <select className="ui-control mt-1 w-full px-2 py-2" value={value.templateId} onChange={event => onChange({ ...value, templateId: event.target.value })}>
        {templateOptions(value.templateId)}
      </select>
    </label>}
    {value?.mode === "rotation" && <>
      {value.templateIds.map((id, index) => <div key={index} className="flex items-end gap-2">
        <label className="min-w-0 flex-1">{t("plan.day", { day: index + 1 })}
          <select className="ui-control mt-1 w-full px-2 py-2" value={id} onChange={event =>
            onChange({ ...value, templateIds: value.templateIds.map((item, day) => day === index ? event.target.value : item) })}>
            {templateOptions(id)}
          </select>
        </label>
        {value.templateIds.length > 1 && <button className="ui-btn-ghost" type="button"
          aria-label={t("promptPlan.removeDay", { day: index + 1 })}
          onClick={() => onChange({ ...value, templateIds: value.templateIds.filter((_, day) => day !== index) })}>
          {t("common.delete")}
        </button>}
      </div>)}
      <button className="text-brand" type="button" disabled={value.templateIds.length >= MAX_PROMPT_PLAN_DAYS}
        onClick={() => onChange({ ...value, templateIds: [...value.templateIds, ""] })}>{t("promptPlan.addDay")}</button>
      {!definitionOnly && <>
        <div className="grid grid-cols-2 gap-2">
          <label>{t("plan.start")}<input type="date" className="ui-control mt-1 w-full p-2" value={value.startDate || ""}
            onChange={event => onChange({ ...value, startDate: event.target.value })} /></label>
          <label>{t("plan.switchTime")}<input type="time" className="ui-control mt-1 w-full p-2" value={value.switchTime || ""}
            onChange={event => onChange({ ...value, switchTime: event.target.value })} /></label>
        </div>
        <TimeZoneSelect label={t("aiOutreach.zone")} value={value.timeZone} automatic="UTC"
          onChange={zone => onChange({ ...value, timeZone: zone || "UTC" })} />
      </>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.loop}
        onChange={event => onChange({ ...value, loop: event.target.checked })} />{t("promptPlan.loop")}</label>
    </>}
    {!definitionOnly && <PromptPlanStatus plan={value} now={now} />}
    {showLibraryLink && <button type="button" className="text-brand" onClick={() => {
      const state = useAppStore.getState();
      state.setSettingsCategory("prompt-library");
      state.setSettingsOpen(true);
    }}>{t("aiLibrary.title")}</button>}
  </section>;
}

const LEGACY_PLAN = "__legacy_prompt_plan__";

/** Assign a reusable plan to a folder/chat; inline plans remain selectable until replaced. */
export function PromptPlanBindingFields({ value, onChange, inheritLabel, now, showLibraryLink = true }: {
  value?: PromptPlan;
  onChange: (value: PromptPlan | undefined) => void;
  inheritLabel: string;
  now?: number;
  showLibraryLink?: boolean;
}) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const plans = settings.aiPromptPlans || [];
  const savedValue = value?.mode === "saved" ? value : undefined;
  const legacyValue = value && value.mode !== "saved" ? value : undefined;
  const editableLegacy = legacyValue?.mode === "fixed" || legacyValue?.mode === "rotation";
  const selectedId = savedValue?.planId || (legacyValue ? LEGACY_PLAN : "");
  const legacyLabel = legacyValue?.mode === "conflict" ? t("promptPlan.error.conflict")
    : legacyValue?.mode === "missing" ? t("promptPlan.error.missing") : t("promptPlan.legacy");
  const savedDefinition = savedValue ? plans.find(plan => plan.id === savedValue.planId)?.plan : undefined;
  const selectedPlan = savedValue ? savedDefinition : legacyValue;
  const missingSavedPlan = !!savedValue && !plans.some(plan => plan.id === savedValue.planId);
  const zone = validTimeZone(savedValue?.timeZone) || validTimeZone(settings.aiTimeZone) || systemTimeZone() || "UTC";
  const scheduleDefaults = { startDate: outreachClock(zone, now).day, switchTime: "09:00", timeZone: zone };
  const normalizedSavedValue = savedValue && normalizePromptPlan(savedValue);
  const savedRotation = savedValue && savedDefinition?.mode === "rotation";
  const bindingSchedule = savedValue ? {
    startDate: normalizedSavedValue?.mode === "saved" ? normalizedSavedValue.startDate || scheduleDefaults.startDate : scheduleDefaults.startDate,
    switchTime: normalizedSavedValue?.mode === "saved" ? normalizedSavedValue.switchTime || scheduleDefaults.switchTime : scheduleDefaults.switchTime,
    timeZone: normalizedSavedValue?.mode === "saved" ? normalizedSavedValue.timeZone || scheduleDefaults.timeZone : scheduleDefaults.timeZone,
  } : scheduleDefaults;
  const updateBindingSchedule = (patch: Partial<typeof scheduleDefaults>) => {
    if (savedValue) onChange({ ...savedValue, ...bindingSchedule, ...patch });
  };

  return <section className="space-y-2 border-t border-zinc-800/80 pt-2.5 text-xs">
    <label className="block">{t("promptPlan.assign")}
      <select className="ui-control mt-1 w-full px-2 py-2" value={selectedId} onChange={event => {
        const id = event.target.value;
        if (id === LEGACY_PLAN) onChange(legacyValue);
        else if (!id) onChange(undefined);
        else {
          const definition = plans.find(plan => plan.id === id)?.plan;
          onChange({ mode: "saved", planId: id, ...(definition?.mode === "rotation" ? scheduleDefaults : {}) });
        }
      }}>
        <option value="">{inheritLabel}</option>
        {legacyValue && <option value={LEGACY_PLAN}>{legacyLabel}</option>}
        {savedValue && missingSavedPlan && <option value={savedValue.planId} disabled>{t("promptPlan.error.missing")}</option>}
        {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
      </select>
    </label>
    {selectedPlan && !editableLegacy && <PromptPlanStatus plan={savedValue || selectedPlan} now={now} />}
    {savedRotation && <div className="space-y-2 rounded-lg bg-zinc-950/20 p-3">
      <p className="text-zinc-500">{t("promptPlan.folderScheduleHint")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label>{t("plan.start")}<input type="date" className="ui-control mt-1 w-full p-2" value={bindingSchedule.startDate}
          onChange={event => updateBindingSchedule({ startDate: event.target.value })} /></label>
        <label>{t("plan.switchTime")}<input type="time" className="ui-control mt-1 w-full p-2" value={bindingSchedule.switchTime}
          onChange={event => updateBindingSchedule({ switchTime: event.target.value })} /></label>
      </div>
      <TimeZoneSelect label={t("aiOutreach.zone")} value={bindingSchedule.timeZone} automatic="UTC"
        onChange={timeZone => updateBindingSchedule({ timeZone: timeZone || "UTC" })} />
    </div>}
    {editableLegacy && <PromptPlanFields value={value} onChange={onChange} now={now} inheritLabel={inheritLabel} showLibraryLink={false} />}
    {missingSavedPlan && <p role="alert" className="text-xs text-amber-500">{t("promptPlan.error.missing")}</p>}
    {showLibraryLink && <button type="button" className="text-brand" onClick={() => {
      const state = useAppStore.getState();
      state.setSettingsCategory("prompt-plans");
      state.setSettingsOpen(true);
    }}>{t("promptPlan.manage")}</button>}
  </section>;
}
