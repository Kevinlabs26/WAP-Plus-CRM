import {useRef,useState} from 'react';
import {useAppStore} from '@/store/appStore';
import {useI18n} from '@/i18n';
import {Button,Input} from '@/components/ui/primitives';
import type {PlaybookPlan} from '@/lib/playbookPlans';
export function PlaybookPlans(){
 const settings=useAppStore(s=>s.settings),{t}=useI18n();
 const [draft,setDraft]=useState<PlaybookPlan|null>(null),[error,setError]=useState('');const snapshot=useRef('');
 const plans=settings.aiPlaybookPlans||[],books=settings.aiPlaybooks.filter(b=>!b.museMissing);
 const used=!!draft&&settings.chatFolders.some(f=>f.aiPlaybookSchedule?.planId===draft.id);
 const choose=(id:string)=>{const p=plans.find(p=>p.id===id);snapshot.current=p?JSON.stringify(p):'';setDraft(p?{...p,days:[...p.days]}:null);setError('');};
 const save=()=>{if(!draft)return;const state=useAppStore.getState(),current=state.settings.aiPlaybookPlans||[];
  if((JSON.stringify(current.find(p=>p.id===draft.id))||'')!==snapshot.current){setError(t('playbook.editChanged'));return;}
  if(!draft.name.trim()||!draft.days.length||draft.days.some(id=>id!=='off'&&!state.settings.aiPlaybooks.some(b=>b.id===id&&!b.museMissing))){setError(t('plan.incomplete'));return;}
  const next={...draft,name:draft.name.trim()};state.updateSettings({aiPlaybookPlans:current.some(p=>p.id===next.id)?current.map(p=>p.id===next.id?next:p):[...current,next]});snapshot.current=JSON.stringify(next);setDraft(next);setError('');
 };
 return <section className="mt-4 space-y-3 rounded-xl border border-zinc-800 p-3 text-xs">
  <div className="flex justify-between items-center"><h5 className="font-semibold">{t('plan.library')}</h5><Button size="xs" disabled={plans.length>=100} onClick={()=>{snapshot.current='';setDraft({id:crypto.randomUUID(),name:'',days:['']});setError('');}}>{t('plan.create')}</Button></div>
  <p className="text-zinc-500">{t('plan.libraryHint')}</p>
  <select aria-label={t('plan.choose')} className="ui-control w-full px-2 py-2" value={plans.some(p=>p.id===draft?.id)?draft!.id:''} onChange={e=>choose(e.target.value)}><option value="">{t('plan.choose')}</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name} · {t('plan.days',{count:p.days.length})}</option>)}</select>
  {draft&&<div className="space-y-2">
   <Input aria-label={t('plan.name')} placeholder={t('plan.name')} maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/>
   {draft.days.map((id,index)=><div key={index} className="flex items-center gap-2"><span className="shrink-0">{t('plan.day',{day:index+1})}</span>
    <select aria-label={t('plan.day',{day:index+1})} className="ui-control min-w-0 flex-1 px-2 py-2" value={id} onChange={e=>setDraft({...draft,days:draft.days.map((v,i)=>i===index?e.target.value:v)})}><option value="">{t('playbook.choose')}</option><option value="off">{t('playbook.off')}</option>{id&&id!=='off'&&!books.some(b=>b.id===id)&&<option value={id} disabled>{t('playbook.missing')}</option>}{books.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
    <Button size="xs" aria-label={t('plan.removeDay',{day:index+1})} disabled={draft.days.length<=1} onClick={()=>setDraft({...draft,days:draft.days.filter((_,i)=>i!==index)})}>×</Button>
   </div>)}
   <Button size="xs" disabled={draft.days.length>=365} onClick={()=>setDraft({...draft,days:[...draft.days,'']})}>{t('plan.addDay')}</Button>
   <div className="flex gap-2"><Button variant="primary" disabled={!draft.name.trim()||draft.days.some(id=>!id)} onClick={save}>{t('dialog.save')}</Button>
    <Button disabled={used} onClick={async()=>{const state=useAppStore.getState();if(state.settings.chatFolders.some(f=>f.aiPlaybookSchedule?.planId===draft.id))return;if(!await state.requestConfirm({title:t('plan.delete'),description:draft.name,confirmLabel:t('common.delete'),tone:'danger'}))return;const latest=useAppStore.getState();if(latest.settings.chatFolders.some(f=>f.aiPlaybookSchedule?.planId===draft.id))return;latest.updateSettings({aiPlaybookPlans:(latest.settings.aiPlaybookPlans||[]).filter(p=>p.id!==draft.id)});setDraft(null);}}>{t('common.delete')}</Button></div>
   {used&&<p className="text-zinc-500">{t('plan.used')}</p>}
  </div>}
  {error&&<p role="alert" className="text-amber-500">{error}</p>}
 </section>;
}
