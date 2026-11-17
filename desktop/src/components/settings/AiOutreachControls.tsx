import type { AiOutreachRule } from "@/lib/aiOutreachRules";
import { normalizeOutreachRule } from "@/lib/aiOutreachRules";
import { TimeZoneSelect } from "@/components/ui/TimeZoneSelect";
import { useI18n } from "@/i18n";
import { Input, Switch, Textarea } from "@/components/ui/primitives";

export function AiOutreachControls({value,onChange}:{value:AiOutreachRule;onChange:(rule:AiOutreachRule)=>void}) {
  const {t}=useI18n();
  const patch=(change:Partial<AiOutreachRule>)=>onChange(normalizeOutreachRule({...value,...change}));
  return <section className="mt-4 border-t border-zinc-800 pt-3">
    <label className="flex items-center justify-between gap-2 text-xs font-semibold">{t("aiOutreach.title")}<Switch checked={value.enabled} onChange={event=>patch({enabled:event.target.checked})}/></label>
    {value.enabled&&<div className="mt-3 space-y-3">
      {value.paused&&<p role="status" className="text-xs text-amber-500">{t("aiTasks.folderPaused")}</p>}
      <select aria-label={t("aiOutreach.mode")} value={value.mode} onChange={event=>patch({mode:event.target.value as AiOutreachRule["mode"]})} className="ui-control w-full px-2 py-2 text-xs">
        <option value="auto">{t("aiOutreach.auto")}</option><option value="draft">{t("aiOutreach.draft")}</option>
      </select>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-2xs">{t("aiOutreach.time")}<Input type="time" value={value.time} onChange={event=>patch({time:event.target.value})}/></label>
      <TimeZoneSelect value={value.timeZone} label={t("aiOutreach.zone")} automatic="UTC" onChange={zone=>patch({timeZone:zone||"UTC"})}/>
      </div>
      <label className="block text-2xs">{t("aiOutreach.goal")}<Textarea rows={3} maxLength={2000} placeholder={t("aiTasks.goalRequired")} value={value.goal} onChange={event=>onChange({...value,goal:event.target.value})}/></label>
      <div>
        <label className="flex items-center justify-between gap-3 text-2xs"><span>{t("aiOutreach.allowSidebarData")}</span><Switch checked={value.allowSidebarData===true} onChange={event=>patch({allowSidebarData:event.target.checked})}/></label>
        <p className="mt-1 text-2xs text-zinc-500">{t("aiOutreach.allowSidebarDataHint")}</p>
      </div>
      <p className="my-2 text-2xs text-zinc-500">{t("aiOutreach.hint")}</p>
    </div>}
  </section>;
}
