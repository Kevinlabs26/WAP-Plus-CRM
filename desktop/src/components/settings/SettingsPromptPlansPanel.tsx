import { useI18n } from "@/i18n";
import { PromptPlanLibrary } from "./PromptPlanLibrary";

export function SettingsPromptPlansPanel() {
  const { t } = useI18n();

  return <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-5 overflow-y-auto">
    <h3 className="shrink-0 text-lg font-semibold">{t("promptPlan.title")}</h3>
    <PromptPlanLibrary />
  </div>;
}
