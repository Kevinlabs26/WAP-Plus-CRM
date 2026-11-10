import type { AiOutreachRule } from "@/lib/aiOutreachRules";
import { normalizeOutreachRule } from "@/lib/aiOutreachRules";
import { TimeZoneSelect } from "@/components/ui/TimeZoneSelect";
import { useI18n } from "@/i18n";
import { Input, Switch, Textarea } from "@/components/ui/primitives";

export function AiOutreachControls({value,onChange}:{value:AiOutreachRule;onChange:(rule:AiOutreachRule)=>void}) {
  const {t}=useI18n();
  const patch=(change:Partial<AiOutreachRule>)=>onChange(normalizeOutreachRule({...value,...change}));
  return <section className="mt-4 rounded-lg border border-zinc-800 p-3">
    <label className="flex items-center justify-between gap-2 text-xs font-semibold">{t("aiOutreach.title")}<Switch checked={value.enabled} onChange={event=>patch({enabled:event.target.checked})}/></label>
    {value.enabled&&<div className="mt-3 space-y-3">
      {value.paused&&<p role="status" className="text-xs text-amber-500">{t("aiTasks.folderPaused")}</p>}
      <select aria-label={t("aiOutreach.mode")} value={value.mode} onChange={event=>patch({mode:event.target.value as AiOutreachRule["mode"]})} className="ui-control w-full px-2 py-2 text-xs">
        <option value="auto">{t("aiOutreach.auto")}</option><option value="draft">{t("aiOutreach.draft")}</option>
      </select>
      <label className="block text-2xs">{t("aiOutreach.time")}<Input type="time" value={value.time} onChange={event=>patch({time:event.target.value})}/></label>
      <label className="block text-2xs">{t("aiOutreach.goal")}<Textarea rows={3} maxLength={2000} placeholder={t("aiTasks.goalRequired")} value={value.goal} onChange={event=>onChange({...value,goal:event.target.value})}/></label>
      <details className="text-xs"><summary className="cursor-pointer text-zinc-500">{t("aiFolder.advanced")}</summary>
      <p className="my-2 text-2xs text-zinc-500">{t("aiOutreach.hint")}</p>
      <select aria-label={t("aiOutreach.trigger")} value={value.trigger} onChange={event=>patch({trigger:event.target.value as AiOutreachRule["trigger"]})} className="ui-control w-full px-2 py-2 text-xs">
        <option value="new">{t("aiOutreach.newContacts")}</option><option value="daily">{t("aiOutreach.nextDay")}</option>
        <option value="both">{t("aiOutreach.both")}</option>
      </select>
      <label className="mt-2 block text-2xs">{t("aiOutreach.limit")}<Input type="number" min={1} max={100} value={value.dailyLimit} onChange={event=>patch({dailyLimit:Number(event.target.value)})}/></label>
      <TimeZoneSelect value={value.timeZone} label={t("aiOutreach.zone")} automatic="UTC" onChange={zone=>patch({timeZone:zone||"UTC"})}/>
      {value.trigger!=="new"&&<label className="block text-2xs">{t("aiOutreach.idle")}<Input type="number" min={1} max={168} value={value.minIdleHours} onChange={event=>patch({minIdleHours:Number(event.target.value)})}/></label>}
      </details>
    </div>}
  </section>;
}
