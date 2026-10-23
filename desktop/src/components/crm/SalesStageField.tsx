import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { salesStagesWithLabels } from "@/lib/contactWorkflow";
import { useI18n } from "@/i18n";
import { SalesStageManager } from "./SalesStageManager";

export function SalesStageField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const labels = useAppStore(s => s.settings.salesStageLabels);
  const order = useAppStore(s => s.settings.salesStageOrder);
  const [managing, setManaging] = useState(false);
  const stages = salesStagesWithLabels(labels, order);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-2xs text-zinc-500">
        <span>{t("crmPanel.salesStage")}</span>
        <button type="button" onClick={() => setManaging(true)} className="rounded px-1 py-1 text-brand hover:bg-brand/10">{t("crm.manageStages")}</button>
      </div>
      <select aria-label={t("crmPanel.salesStage")} value={value} onChange={event => onChange(event.target.value)} className="ui-control mt-1 w-full px-2.5 py-1.5 text-[13px]">
        {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
      </select>
      {managing && <SalesStageManager onClose={() => setManaging(false)} />}
    </div>
  );
}
