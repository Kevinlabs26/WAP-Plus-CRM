import type { AiOutreachRule } from "@/lib/aiOutreachRules";
import type { ReactNode } from "react";
import { isImmediateOutreach, nextScheduledOutreachAt, normalizeOutreachRule } from "@/lib/aiOutreachRules";
import { TimeZoneSelect } from "@/components/ui/TimeZoneSelect";
import { useI18n } from "@/i18n";
import { Button, Input, Switch, Textarea } from "@/components/ui/primitives";

export function AiOutreachControls({value,onChange,children}:{value:AiOutreachRule;onChange:(rule:AiOutreachRule)=>void;children?:ReactNode}) {
  const {t}=useI18n();
  const patch=(change:Partial<AiOutreachRule>)=>{
    const next={...value,...change};
    if(change.enabled===false){next.startMode="scheduled";next.runNowAt=undefined;next.scheduleStartAt=undefined;}
    else if(next.startMode==="immediate"){next.runNowAt=value.startMode==="immediate"&&isImmediateOutreach(value)?value.runNowAt:Date.now();next.scheduleStartAt=undefined;}
    else{
      next.runNowAt=undefined;
      if(change.startMode!==undefined||change.time!==undefined||change.timeZone!==undefined||change.enabled!==undefined||change.paused!==undefined)next.scheduleStartAt=nextScheduledOutreachAt(next)??undefined;
    }
    onChange(normalizeOutreachRule(next));
  };
  return <section className="mt-4 border-t border-zinc-800 pt-3">
    <label className="flex items-center justify-between gap-2 text-xs font-semibold">{t("aiOutreach.title")}<Switch checked={value.enabled} onChange={event=>patch({enabled:event.target.checked})}/></label>
    {value.enabled&&<div className="mt-3 space-y-3">
      {value.paused&&<p role="status" className="flex items-center gap-2 text-xs text-amber-500">{t("aiTasks.folderPaused")}<Button size="xs" onClick={()=>patch({paused:false})}>{t("aiTasks.resume")}</Button></p>}
      <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-2xs">{t("aiOutreach.mode")}<select aria-label={t("aiOutreach.mode")} value={value.mode} onChange={event=>patch({mode:event.target.value as AiOutreachRule["mode"]})} className="ui-control mt-1 w-full px-2 py-2 text-xs">
        <option value="auto">{t("aiOutreach.auto")}</option><option value="draft">{t("aiOutreach.draft")}</option>
      </select></label>
      <label className="block text-2xs">{t("aiOutreach.startMode")}<select aria-label={t("aiOutreach.startMode")} value={value.startMode} onChange={event=>patch({startMode:event.target.value as AiOutreachRule["startMode"]})} className="ui-control mt-1 w-full px-2 py-2 text-xs">
        <option value="scheduled">{t("aiOutreach.startScheduled")}</option><option value="immediate">{t("aiOutreach.startImmediate")}</option>
      </select></label>
      </div>
      {value.startMode==="scheduled"?<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-2xs">{t("aiOutreach.time")}<Input type="time" value={value.time} onChange={event=>patch({time:event.target.value})}/></label>
        <TimeZoneSelect value={value.timeZone} label={t("aiOutreach.zone")} automatic="UTC" onChange={zone=>patch({timeZone:zone||"UTC"})}/>
      </div>:<p className="text-2xs text-zinc-500">{t("aiOutreach.startImmediateHint")}</p>}
      {children}
      <label className="block text-2xs">{t("aiOutreach.goal")}<Textarea rows={3} maxLength={2000} placeholder={t("aiTasks.goalRequired")} value={value.goal} onChange={event=>onChange({...value,goal:event.target.value})}/></label>
      <div>
        <label className="flex items-center justify-between gap-3 text-2xs"><span>{t("aiOutreach.allowSidebarData")}</span><Switch checked={value.allowSidebarData===true} onChange={event=>patch({allowSidebarData:event.target.checked})}/></label>
        <p className="mt-1 text-2xs text-zinc-500">{t("aiOutreach.allowSidebarDataHint")}</p>
      </div>
      <p className="my-2 text-2xs text-zinc-500">{t("aiOutreach.hint")}</p>
    </div>}
  </section>;
}
