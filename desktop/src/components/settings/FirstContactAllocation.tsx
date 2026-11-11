import { useAppStore } from '@/store/appStore';
import { useI18n } from '@/i18n';
import { allocateFirstContacts } from '@/lib/aiOutreachAllocation';
import { isWaAccountConnected } from '@/lib/accountConnection';
import type { AiOutreachRule } from '@/lib/aiOutreachRules';
export function FirstContactAllocation({folderId,value,onChange}:{folderId:string;value:AiOutreachRule;onChange:(rule:AiOutreachRule)=>void}){
 const state=useAppStore(s=>s),{t}=useI18n();
 const ids=state.settings.chatFolders.find(f=>f.id===folderId)?.chatIds||[];
 const quotas=value.firstContactQuotas;
 const plan=allocateFirstContacts(state,ids,quotas||{},value.firstContactAssignments);
 const people=[...plan.people.values()],fresh=people.filter(p=>p.kind==='new').length;
 const update=(next:Record<string,number>)=>onChange({...value,firstContactQuotas:next,firstContactAssignments:allocateFirstContacts(state,ids,next,value.firstContactAssignments).assignments});
 return <section className="mt-3 rounded-lg border border-zinc-800 p-3 text-xs space-y-2">
  <label className="flex items-center justify-between gap-2 font-medium">{t('allocation.title')}<input type="checkbox" checked={!!quotas} onChange={e=>e.target.checked?update({}):onChange({...value,firstContactQuotas:undefined,firstContactAssignments:undefined})}/></label>
  {quotas&&<div className="space-y-2">
   <p className="text-zinc-500">{t('allocation.hint')}</p>
   <button type="button" className="text-brand" onClick={()=>{
    const accounts=state.settings.waAccounts.filter(a=>isWaAccountConnected(state.settings.waAccounts,a.id,state.settings.liveBaileysAccountId,state.baileysUi.connection));
    update(Object.fromEntries(accounts.map((a,i)=>[a.id,Math.min(100,Math.floor(fresh/accounts.length)+(i<fresh%accounts.length?1:0))])));
   }}>{t('allocation.average')}</button>
   <p className="text-right text-zinc-500">{t('allocation.quotaHeader')}</p>
   {state.settings.waAccounts.map((account,i)=>{const online=isWaAccountConnected(state.settings.waAccounts,account.id,state.settings.liveBaileysAccountId,state.baileysUi.connection);return <div key={account.id} className="flex items-center gap-2">
    <input type="checkbox" aria-label={account.label} checked={Object.hasOwn(quotas,account.id)} onChange={e=>{const next={...quotas};if(e.target.checked)next[account.id]=0;else delete next[account.id];update(next);}}/>
    <span className="min-w-0 flex-1 truncate">{i+1}: {account.label} · {t(online?'allocation.online':'allocation.offline')}</span>
    <input type="number" aria-label={t('allocation.quota',{name:account.label})} className="ui-control w-20 px-2 py-1" min={0} max={100} disabled={!Object.hasOwn(quotas,account.id)} value={quotas[account.id]||0} onChange={e=>update({...quotas,[account.id]:Math.min(100,Math.max(0,Math.floor(Number(e.target.value)||0)))})}/>
   </div>})}
   <p role="status">{t('allocation.counts',{existing:people.filter(p=>p.kind==='existing').length,fresh,assigned:Object.keys(plan.assignments).length,unknown:people.filter(p=>p.kind==='unknown').length,remaining:fresh-Object.keys(plan.assignments).length})}</p>
  </div>}
 </section>;
}
