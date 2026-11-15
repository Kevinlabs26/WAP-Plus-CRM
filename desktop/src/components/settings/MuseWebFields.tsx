import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, Copy, LogIn, RefreshCw, Star } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/primitives';
import { hasMuseAccountPlaybook } from '@/lib/aiPlaybooks';
import { syncMuseIdentityToAccount } from '@/lib/museIdentitySync';
import { addMuseWebAccount, museWebAccounts, museWebStatus, openMuseWeb, selectMuseWebAccount, setMuseWebPrimaryAccount, type MuseWebAccountPool, type MuseWebStatus } from '@/lib/museWeb';
import { museQueueSnapshot, subscribeMuseQueue } from '@/lib/museQueue';
import { useI18n } from '@/i18n';
import { MuseQueueStatus } from './MuseQueueStatus';

type AccountState = Pick<MuseWebStatus, 'ready' | 'state' | 'message'>;

export function MuseWebFields(){
  const {t}=useI18n();
  const [pool,setPool]=useState<MuseWebAccountPool>();
  const playbooks=useAppStore(state=>state.settings.aiPlaybooks);
  const playbookMode=useAppStore(state=>state.settings.aiPlaybookMuseMode);
  const identityModes=useAppStore(state=>state.settings.museIdentityModeByAccountId);
  const identitySyncs=useAppStore(state=>state.settings.museIdentitySyncByAccountId);
  const [statuses,setStatuses]=useState<Record<string,AccountState>>({});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
  const queue=useSyncExternalStore(subscribeMuseQueue,museQueueSnapshot);
  const queueBusy=!!(queue.textRunning||queue.textWaiting||queue.mediaRunning||queue.mediaWaiting);
  useEffect(()=>{let active=true;void museWebAccounts().then(value=>{if(active)setPool(value);}).catch(e=>{if(active){setError(true);setMessage(e instanceof Error?e.message:String(e));}});return()=>{active=false;};},[]);
  const run=async(work:()=>Promise<string>)=>{
    if(busy)return;setBusy(true);setError(false);
    try{setMessage(await work());}catch(e){setError(true);setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const syncIdentity=async(account:MuseWebAccountPool['accounts'][number])=>{
    if(!pool||account.id===pool.primaryId)return;
    const primaryName=pool.accounts.find(item=>item.id===pool.primaryId)?.name||pool.primaryId;
    const confirmed=await useAppStore.getState().requestConfirm({
      title:t('muse.identitySyncTitle',{primary:primaryName,name:account.name}),
      description:t('muse.identitySyncConfirm',{primary:primaryName,name:account.name}),
      confirmLabel:t('muse.identitySync'),cancelLabel:t('common.cancel'),tone:'danger',
    });
    if(!confirmed)return;
    await run(async()=>{
      const digest=await syncMuseIdentityToAccount(account.id);
      const latestPool=await museWebAccounts();
      if(latestPool.primaryId!==pool.primaryId||!latestPool.accounts.some(item=>item.id===account.id))throw Error(t('muse.identityPoolChanged'));
      const settings=useAppStore.getState().settings;
      useAppStore.getState().updateSettings({
        museIdentityModeByAccountId:{...settings.museIdentityModeByAccountId,[account.id]:'follow-primary'},
        museIdentitySyncByAccountId:{...settings.museIdentitySyncByAccountId,[account.id]:{primaryId:pool.primaryId,sha256:digest,syncedAt:Date.now()}},
      });
      return t('muse.identitySynced',{name:account.name});
    });
  };
  const setIdentityMode=async(account:MuseWebAccountPool['accounts'][number],mode:'follow-primary'|'independent')=>{
    if(mode==='follow-primary'){await syncIdentity(account);return;}
    await run(async()=>{
      const settings=useAppStore.getState().settings;
      useAppStore.getState().updateSettings({museIdentityModeByAccountId:{...settings.museIdentityModeByAccountId,[account.id]:'independent'}});
      return t('muse.identityIndependentSet',{name:account.name});
    });
  };
  const checkAccount=async(id:string)=>{
    setStatuses(current=>({...current,[id]:{state:'checking',ready:false,message:''}}));
    try{
      const status=await museWebStatus(false,id);
      setStatuses(current=>({...current,[id]:status}));
      return status;
    }catch(e){
      const status={state:'error',ready:false,message:e instanceof Error?e.message:String(e)};
      setStatuses(current=>({...current,[id]:status}));
      return status;
    }
  };
  const checkAll=()=>void run(async()=>{
    if(!pool)return t('muse.poolLoading');
    const statuses=await Promise.all(pool.accounts.map(account=>checkAccount(account.id)));
    const ready=statuses.filter(status=>status.ready).length;
    return t('muse.poolChecked',{ready,total:pool.accounts.length});
  });
  const statusText=(status?:AccountState)=>{
    if(!status)return t('muse.statusUnknown');
    if(status.ready)return t('muse.statusReady');
    if(status.state==='checking'||status.state==='loading')return t('muse.statusChecking');
    if(status.state==='login')return t('muse.statusLogin');
    if(status.state==='quota')return t('muse.statusQuota');
    if(status.state==='busy')return t('muse.statusBusy');
    return t('muse.statusError');
  };
  const readyCount=pool?.accounts.filter(account=>statuses[account.id]?.ready).length||0;
  const loggedInCount=pool?.accounts.filter(account=>{
    const state=statuses[account.id]?.state;
    return statuses[account.id]?.ready||state==='quota'||state==='busy';
  }).length||0;
  const uncheckedCount=pool?.accounts.filter(account=>!statuses[account.id]).length||0;
  return <div className="col-span-2 space-y-3 rounded-lg border border-zinc-800 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="text-xs font-medium text-zinc-200">{t('muse.poolTitle')}</h4>
        <p className="mt-1 text-2xs text-zinc-500">{pool?t('muse.poolCount',{signedIn:loggedInCount,ready:readyCount,unchecked:uncheckedCount,total:pool.accounts.length}):t('muse.poolLoading')}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" title={pool?.accounts.length===12?t('muse.accountLimit'):undefined} disabled={busy||queueBusy||!pool||pool.accounts.length>=12} onClick={()=>void run(async()=>{
          const next=await addMuseWebAccount();setPool(next);
          await openMuseWeb(false,next.selectedId);
          return t('muse.accountAdded');
        })}>{t('muse.addAccount')}</Button>
        <Button size="sm" variant="secondary" disabled={busy||queueBusy||!pool} onClick={checkAll}>{busy?t('muse.statusChecking'):t('muse.checkAll')}</Button>
      </div>
    </div>
    {pool?.accounts.map(account=>{
      const status=statuses[account.id];
      const trainable=(playbooks||[]).filter(book=>!book.museMissing&&(book.musePath||book.content.trim()||book.summary.trim()));
      const trained=trainable.filter(book=>hasMuseAccountPlaybook(book,account.id)).length;
      const identityMode=identityModes?.[account.id]||'independent';
      const identitySync=identitySyncs?.[account.id];
      const actionClass="!h-7 !min-h-7 !w-7 !px-0 shrink-0";
      return <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/30 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-2 text-xs text-zinc-200">
            <span>{account.name}</span>
            {account.id===pool.selectedId&&<span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">{t('muse.currentAccount')}</span>}
            {account.primary&&<span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">{t('muse.primaryAccount')}</span>}
          </div>
          <span title={status?.message} className={`text-2xs ${status?.ready?'text-emerald-400':status?.state==='error'||status?.state==='quota'?'text-amber-400':'text-zinc-500'}`}>{statusText(status)}</span>
          {playbookMode!=='shared'&&!!trainable.length&&<span className="text-2xs text-zinc-500" title={t('muse.playbooksTrained',{trained,total:trainable.length})}>{t('muse.playbooksTrained',{trained,total:trainable.length})}</span>}
          {!account.primary&&<div className="flex items-center gap-1.5">
            <label className="text-2xs text-zinc-500" htmlFor={`muse-identity-${account.id}`} title={`${t('muse.identityIndependentHint')} ${t('muse.identityHint')}`}>{t('muse.identityMode')}</label>
            <select id={`muse-identity-${account.id}`} className="ui-control h-7 !min-h-7 max-w-48 px-2 text-2xs" value={identityMode} disabled={busy||queueBusy} onChange={event=>void setIdentityMode(account,event.target.value as 'follow-primary'|'independent')}>
              <option value="independent">{t('muse.identityIndependent')}</option>
              <option value="follow-primary">{t('muse.identityFollowPrimary')}</option>
            </select>
            {identityMode==='follow-primary'&&<span title={identitySync?.primaryId===pool.primaryId?t('muse.identitySyncedAt',{date:new Date(identitySync.syncedAt).toLocaleString()}):t('muse.identityNeedsSync')} className="text-2xs text-zinc-500">{identitySync?.primaryId===pool.primaryId?<Check className="h-3.5 w-3.5 text-emerald-400" aria-label={t('muse.identitySyncedShort')} />:t('muse.identityNeedsSync')}</span>}
          </div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.open')} title={t('muse.open')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{await openMuseWeb(false,account.id);return t('muse.loginHint');})}><LogIn className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.check')} title={t('muse.check')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{
            const status=await checkAccount(account.id);
            if(!status.ready)throw Error(status.message||t('muse.statusLogin'));
            return t('muse.statusReady');
          })}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          {account.id!==pool.selectedId&&<Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.selectAccount')} title={t('muse.selectAccount')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{
            const next=await selectMuseWebAccount(account.id);setPool(next);return t('muse.accountSelected',{name:account.name});
          })}><Check className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
          {!account.primary&&<Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.identitySync')} title={t('muse.identitySync')} disabled={busy||queueBusy} onClick={()=>void syncIdentity(account)}><Copy className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
          {!account.primary&&<Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.setPrimary')} title={t('muse.setPrimary')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{
            const previousPrimary=pool?.primaryId;
            const next=await setMuseWebPrimaryAccount(account.id);
            if(previousPrimary!==account.id){
              const settings=useAppStore.getState().settings;
              useAppStore.getState().updateSettings({
                aiPlaybooks:(settings.aiPlaybooks||[]).map(book=>book.musePath?{...book,content:'',summary:'',museShareRevision:undefined,museAccountCopies:{}}:book),
                aiPlaybookMuseRoot:'',
                aiPlaybookMuseFolder:'',
                aiPlaybookMuseWorkspaceLinked:false,
                aiPlaybookAutoSync:false,
              });
            }
            setPool(next);return t('muse.primarySet',{name:account.name});
          })}><Star className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
        </div>
      </div>;
    })}
    {!pool&&<p className="text-xs text-zinc-500">{t('muse.poolLoading')}</p>}
    <p className="text-2xs text-zinc-500">{t('muse.poolHint')}</p>
    <p className="text-2xs text-zinc-500" title={t('muse.rollover')}>{t('muse.hint')}</p>
    <MuseQueueStatus/>
    {message&&<p role={error?'alert':'status'} className={`text-xs ${error?'text-amber-500':'text-brand'}`}>{message}</p>}
    {!pool&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(async()=>{const current=await museWebAccounts();setPool(current);return t('muse.poolLoaded');})}>{t('muse.check')}</Button>}
  </div>;
}
