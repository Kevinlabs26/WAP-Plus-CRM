import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { playbookBindingKey } from "@/lib/aiPlaybooks";
import { evaluatePromptPlan, type PromptPlan } from "@/lib/promptPlans";
import { PromptPlanBindingFields, PromptPlanStatus } from "@/components/settings/PromptPlanFields";

export function ChatPromptPlan({ accountId, chatId, inherited, now }: {
  accountId: string;
  chatId: string;
  inherited: { plan?: PromptPlan; folderName?: string };
  now?: number;
}) {
  const { t } = useI18n();
  const key = playbookBindingKey(accountId, chatId);
  const saved = useAppStore(state => state.settings.aiPromptPlanByChat?.[key]);
  const templates = useAppStore(state => state.settings.aiPromptTemplates);
  const savedPlans = useAppStore(state => state.settings.aiPromptPlans);
  const [draft, setDraft] = useState<PromptPlan | undefined>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const pending = JSON.stringify(saved) !== JSON.stringify(draft);
  const invalid = evaluatePromptPlan(draft, templates || [], now, savedPlans || []).error;
  return <div className="space-y-2">
    <PromptPlanBindingFields value={draft} onChange={setDraft} now={now} inheritLabel={t("promptPlan.followFolder")} />
    {!draft && <PromptPlanStatus {...inherited} now={now} />}
    {pending && <button type="button" className="ui-btn-secondary text-xs" disabled={!!invalid} onClick={() => {
      const state = useAppStore.getState();
      if (evaluatePromptPlan(draft, state.settings.aiPromptTemplates, now, state.settings.aiPromptPlans).error) return;
      const bindings = { ...state.settings.aiPromptPlanByChat };
      if (draft) bindings[key] = draft;
      else delete bindings[key];
      state.updateSettings({ aiPromptPlanByChat: bindings });
    }}>{t("dialog.save")}</button>}
  </div>;
}
