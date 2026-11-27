import { scheduledPlan, type PlaybookSchedule } from "./playbookPlans.ts";
import type { AiPromptTemplate } from "./aiPromptScope.ts";
import { validTimeZone } from "./timeZone.ts";

export const MAX_PROMPT_PLAN_DAYS = 30;
export type PromptPlanSchedule = Omit<PlaybookSchedule, "planId">;
type PromptPlanFixed = { mode: "fixed"; templateId: string };
type PromptPlanRotationDefinition = { mode: "rotation"; templateIds: string[]; loop: boolean };
type PromptPlanRotation = PromptPlanRotationDefinition & Partial<PromptPlanSchedule>;
export type PromptPlanRule = PromptPlanFixed | PromptPlanRotationDefinition;
export type PromptPlan = PromptPlanFixed | PromptPlanRotation
  | ({ mode: "saved"; planId: string } & Partial<PromptPlanSchedule>)
  | { mode: "conflict" } | { mode: "missing" };
export type SavedPromptPlan = { id: string; name: string; plan: PromptPlanRule };

export function usesPromptPlans(provider?: string) {
  return !!provider && provider !== "muse" && provider !== "mock";
}

export function promptPlanTemplateIds(plan?: PromptPlan): string[] {
  if (plan?.mode === "fixed") return [plan.templateId];
  return plan?.mode === "rotation" ? plan.templateIds : [];
}

export function normalizePromptPlan(value: unknown, legacySchedules?: ReadonlyMap<string, PromptPlanSchedule>): PromptPlan | undefined {
  if (!value || typeof value !== "object") return;
  const plan = value as { templateId?: unknown; templateIds?: unknown; startDate?: unknown; switchTime?: unknown; timeZone?: unknown; loop?: unknown };
  const mode = (value as { mode?: unknown }).mode;
  const validId = (id: unknown): id is string => typeof id === "string" && !!id.trim() && id.length <= 120;
  const schedule = normalizeSchedule(value);
  if (mode === "conflict") return { mode };
  if (mode === "saved" && validId((value as { planId?: unknown }).planId)) {
    const planId = (value as { planId: string }).planId;
    return { mode, planId, ...(schedule || legacySchedules?.get(planId) || {}) };
  }
  if (mode === "fixed" && validId(plan.templateId)) return { mode, templateId: plan.templateId };
  if (mode === "rotation" && Array.isArray(plan.templateIds) && plan.templateIds.length > 0
    && plan.templateIds.length <= MAX_PROMPT_PLAN_DAYS && plan.templateIds.every(validId)) {
    return { mode, templateIds: [...plan.templateIds], loop: plan.loop === true, ...schedule };
  }
}

function normalizeSchedule(value: unknown): PromptPlanSchedule | undefined {
  if (!value || typeof value !== "object") return;
  const schedule = value as { startDate?: unknown; switchTime?: unknown; timeZone?: unknown };
  const start = typeof schedule.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(schedule.startDate)
    ? Date.parse(`${schedule.startDate}T00:00:00Z`) : NaN;
  const timeZone = validTimeZone(schedule.timeZone);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== schedule.startDate ||
      typeof schedule.switchTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.switchTime) || !timeZone) return;
  return { startDate: schedule.startDate, switchTime: schedule.switchTime, timeZone };
}

/** Pull schedule fields out of pre-library plan definitions so they can be copied onto each binding. */
export function legacySavedPromptPlanSchedules(value: unknown): Map<string, PromptPlanSchedule> {
  const schedules = new Map<string, PromptPlanSchedule>();
  for (const item of Array.isArray(value) ? value.slice(0, 100) : []) {
    if (!item || typeof item.id !== "string" || !item.id || !item.plan || typeof item.plan !== "object" ||
        (item.plan as { mode?: unknown }).mode !== "rotation") continue;
    const schedule = normalizeSchedule(item.plan);
    if (schedule) schedules.set(item.id, schedule);
  }
  return schedules;
}

export function normalizeSavedPromptPlans(value: unknown): SavedPromptPlan[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).slice(0, 100).flatMap(item => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 120 || seen.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 80) return [];
    const plan = normalizePromptPlan(item.plan);
    if (!plan || plan.mode === "saved" || plan.mode === "conflict" || plan.mode === "missing") return [];
    seen.add(item.id);
    const definition: PromptPlanRule = plan.mode === "rotation"
      ? { mode: plan.mode, templateIds: plan.templateIds, loop: plan.loop }
      : plan;
    return [{ id: item.id, name: item.name.trim(), plan: definition }];
  });
}

export function normalizePromptPlanBindings(value: unknown, legacySchedules?: ReadonlyMap<string, PromptPlanSchedule>): Record<string, PromptPlan> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 50_000).flatMap(([key, raw]) => {
    const plan = normalizePromptPlan(raw, legacySchedules);
    if (!plan) return [];
    try {
      const parts = JSON.parse(key);
      return Array.isArray(parts) && parts.length === 2 && JSON.stringify(parts) === key
        && parts.every(part => typeof part === "string" && part.trim() && part.length <= 240) ? [[key, plan]] : [];
    } catch { return []; }
  }));
}

export function remapPromptPlanBindings(bindings: Record<string, PromptPlan>, replacements: ReadonlyMap<string, string | null>) {
  let changed = false;
  const next: Record<string, PromptPlan> = {};
  for (const [key, plan] of Object.entries(bindings)) {
    const [account, chat] = JSON.parse(key);
    const target = replacements.has(chat) ? replacements.get(chat) : chat;
    if (target !== chat) changed = true;
    if (!target) continue;
    const targetKey = target === chat ? key : JSON.stringify([account, target]);
    next[targetKey] = next[targetKey] && JSON.stringify(next[targetKey]) !== JSON.stringify(plan) ? { mode: "conflict" } : plan;
  }
  return changed ? next : bindings;
}

export function evaluatePromptPlan(plan: PromptPlan | undefined, templates: readonly AiPromptTemplate[], now = Date.now(), savedPlans: readonly SavedPromptPlan[] = []) {
  if (!plan) return {};
  if (plan.mode === "conflict") return { error: "conflict" as const };
  if (plan.mode === "missing") return { error: "missing" as const };
  if (plan.mode === "saved") {
    const saved = savedPlans.find(item => item.id === plan.planId);
    if (!saved) return { error: "missing" as const };
    if (saved.plan.mode === "fixed") return evaluatePromptPlan(saved.plan, templates, now);
    const legacySchedule = normalizeSchedule(saved.plan);
    return evaluatePromptPlan({ ...saved.plan,
      startDate: plan.startDate ?? legacySchedule?.startDate,
      switchTime: plan.switchTime ?? legacySchedule?.switchTime,
      timeZone: plan.timeZone ?? legacySchedule?.timeZone,
    }, templates, now);
  }
  const ids = promptPlanTemplateIds(plan);
  const selected = ids.map(id => templates.find(template => template.id === id));
  if (!ids.length || selected.some(template => !template)) return { error: "missing" as const };
  if (plan.mode === "fixed") return { current: selected[0] };
  if (!plan.startDate || !plan.switchTime || !plan.timeZone) return { error: "schedule" as const };
  const schedule = scheduledPlan({ name: "", days: ids }, { startDate: plan.startDate, switchTime: plan.switchTime, timeZone: plan.timeZone }, now, plan.loop);
  if (schedule.error) return { error: "schedule" as const };
  return {
    current: selected[schedule.day - 1],
    next: schedule.next ? selected[schedule.day % selected.length] : undefined,
    nextTime: schedule.next,
  };
}

export function validatePromptPlanDefinition(plan: PromptPlan | undefined, templates: readonly AiPromptTemplate[]) {
  if (!plan || plan.mode === "saved" || plan.mode === "conflict" || plan.mode === "missing") return { error: "missing" as const };
  const ids = promptPlanTemplateIds(plan);
  return !ids.length || ids.some(id => !templates.some(template => template.id === id))
    ? { error: "missing" as const } : {};
}
