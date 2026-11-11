import {useEffect,useState} from 'react';
import {useAppStore} from '@/store/appStore';
import {useI18n} from '@/i18n';
import {TimeZoneSelect} from '@/components/ui/TimeZoneSelect';
import {scheduledPlaybook,type PlaybookSchedule} from '@/lib/playbookPlans';
import {outreachClock} from '@/lib/aiOutreachRules';
export function PlaybookScheduleFields({value,onChange}:{value?:PlaybookSchedule;onChange:(value:PlaybookSchedule|undefined)=>void}){
 const settings=useAppStore(s=>s.settings),{t}=useI18n();const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!value)return;const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(timer);},[value]);
 const plans=settings.aiPlaybookPlans||[],status=value?scheduledPlaybook(plans,value,now):undefined;
 return <section className="mt-3 rounded-lg border border-zinc-800 p-3 text-xs space-y-2">
  <label className="flex justify-between items-center">{t('plan.enable')}<input type="checkbox" checked={!!value} onChange={e=>{const zone=settings.aiTimeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;onChange(e.target.checked?{planId:'',startDate:outreachClock(zone).day,timeZone:zone,switchTime:'09:00'}:undefined);}}/></label>
  {value&&<div className="space-y-2">
   <p className="text-zinc-500">{t('plan.folderHint')}</p>
   <label className="block">{t('plan.choose')}<select className="ui-control mt-1 w-full px-2 py-2" value={value.planId} onChange={e=>onChange({...value,planId:e.target.value})}><option value="">{t('plan.choose')}</option>{value.planId&&!plans.some(p=>p.id===value.planId)&&<option value={value.planId} disabled>{t('playbook.missing')}</option>}{plans.map(p=><option key={p.id} value={p.id}>{p.name} · {t('plan.days',{count:p.days.length})}</option>)}</select></label>
   <div className="grid grid-cols-2 gap-2"><label>{t('plan.start')}<input type="date" className="ui-control mt-1 w-full p-2" value={value.startDate} onChange={e=>onChange({...value,startDate:e.target.value})}/></label><label>{t('plan.switchTime')}<input type="time" className="ui-control mt-1 w-full p-2" value={value.switchTime} onChange={e=>onChange({...value,switchTime:e.target.value})}/></label></div>
   <TimeZoneSelect label={t('aiOutreach.zone')} value={value.timeZone} automatic="UTC" onChange={zone=>onChange({...value,timeZone:zone||'UTC'})}/>
   {status?.error?<p role="alert" className="text-amber-500">{status.error}</p>:status&&<p role="status">{status.day?t('plan.current',{name:status.name,day:status.day}):t('plan.notStarted')}{status.next?' · '+t('plan.next',{time:status.next}):' · '+t('plan.finished')}</p>}
   <button className="text-brand" type="button" onClick={()=>{const state=useAppStore.getState();state.setSettingsCategory('ai');state.setSettingsOpen(true);}}>{t('plan.manage')}</button>
  </div>}
 </section>;
}
