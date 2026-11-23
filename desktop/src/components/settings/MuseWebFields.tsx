import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, LogIn, RefreshCw, Star } from 'lucide-react';
import { flushPersist, useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/primitives';
import { hasMuseAccountPlaybook } from '@/lib/aiPlaybooks';
import { addMuseWebAccount, museWebAccounts, museWebStatus, openMuseWeb, selectMuseWebAccount, setMuseWebPrimaryAccount, type MuseWebAccountPool, type MuseWebStatus } from '@/lib/museWeb';
import { museQueueSnapshot, subscribeMuseQueue } from '@/lib/museQueue';
import { useI18n } from '@/i18n';
import { MuseQueueStatus } from './MuseQueueStatus';
import { useDetailsMenu } from '@/components/ui/useDetailsMenu';
import { backgroundPlaybookSyncStatus, subscribeBackgroundPlaybookSync, toggleBackgroundPlaybookSync } from '@/components/bridge/PlaybookSyncWatcher';
import { cancelActiveMuseRequest, getActiveMuseRequests, subscribeActiveMuseRequests } from '@/lib/museWeb';

type AccountState = Pick<MuseWebStatus, 'ready' | 'state' | 'message'> & {checkedAt?:number};

export function MuseWebFields(){
  const {t}=useI18n();
  const [pool,setPool]=useState<MuseWebAccountPool>();
  const playbooks=useAppStore(state=>state.settings.aiPlaybooks);
  const playbookMode=useAppStore(state=>state.settings.aiPlaybookMuseMode);
  const outreachMuseAccountId=useAppStore(state=>state.settings.aiOutreachMuseAccountId);
  const autoReplyAccountIds=useAppStore(state=>state.settings.museAutoReplyAccountIds);
  const crmAgentMuseAccountId=useAppStore(state=>state.settings.crmAgentMuseAccountId);
  const accountChecks=useAppStore(state=>state.settings.museAccountChecks);
  const privacyByAccountId=useAppStore(state=>state.settings.musePrivacyByAccountId);
  const [statuses,setStatuses]=useState<Record<string,AccountState>>({});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
  const autoReplyMenuRef=useDetailsMenu();
  const queue=useSyncExternalStore(subscribeMuseQueue,museQueueSnapshot);
  const playbookSync=useSyncExternalStore(subscribeBackgroundPlaybookSync,backgroundPlaybookSyncStatus);
  const activeRequests=useSyncExternalStore(subscribeActiveMuseRequests,getActiveMuseRequests);
  const queueBusy=!!(queue.textRunning||queue.textWaiting||queue.mediaRunning||queue.mediaWaiting);
  useEffect(()=>{let active=true;void museWebAccounts().then(value=>{if(active)setPool(value);}).catch(e=>{if(active){setError(true);setMessage(e instanceof Error?e.message:String(e));}});return()=>{active=false;};},[]);
  const run=async(work:()=>Promise<string>)=>{
    if(busy)return;setBusy(true);setError(false);
    try{setMessage(await work());}catch(e){setError(true);setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const checkAccount=async(id:string)=>{
    setStatuses(current=>({...current,[id]:{state:'checking',ready:false,message:''}}));
    const finish=(status:AccountState)=>{
      const checked={...status,checkedAt:Date.now()};
      setStatuses(current=>({...current,[id]:checked}));
      const current=useAppStore.getState().settings.museAccountChecks;
      const activeIds=new Set(pool?.accounts.map(account=>account.id)||[]);
      const activeChecks=Object.fromEntries(Object.entries(current).filter(([accountId])=>activeIds.has(accountId)));
      useAppStore.getState().updateSettings({museAccountChecks:{...activeChecks,[id]:checked}});
      return checked;
    };
    try{
      const status=await museWebStatus(false,id);
      return finish(status);
    }catch(e){
      const status={state:'error',ready:false,message:e instanceof Error?e.message:String(e)};
      return finish(status);
    }
  };
  const checkAll=()=>void run(async()=>{
    if(!pool)return t('muse.poolLoading');
    const statuses=await Promise.all(pool.accounts.map(account=>checkAccount(account.id)));
    await flushPersist(()=>useAppStore.getState());
    const ready=statuses.filter(status=>status.ready).length;
    return t('muse.poolChecked',{ready,total:pool.accounts.length});
  });
  const toggleAutoReplyAccount=(accountId:string)=>{
    const current=useAppStore.getState().settings.museAutoReplyAccountIds;
    const selected=new Set(current??pool?.accounts.map(account=>account.id)??[]);
    if(selected.has(accountId))selected.delete(accountId);else selected.add(accountId);
    useAppStore.getState().updateSettings({museAutoReplyAccountIds:[...selected]});
  };
  const setTrainingConfirmation=(accountId:string,value?:number)=>{
    const current=useAppStore.getState().settings.musePrivacyByAccountId;
    const next={...current},entry={...current[accountId]};
    if(value)entry.trainingDisabledConfirmedAt=value;else delete entry.trainingDisabledConfirmedAt;
    if(entry.trainingDisabledConfirmedAt||entry.memoryReviewedAt)next[accountId]=entry;else delete next[accountId];
    useAppStore.getState().updateSettings({musePrivacyByAccountId:next});
  };
  const confirmTrainingDisabled=async(account:MuseWebAccountPool['accounts'][number])=>{
    if(busy)return;setBusy(true);
    try{
      const state=useAppStore.getState();
      const confirmed=await state.requestConfirm({
        title:t('muse.trainingConfirmTitle',{name:account.name}),
        description:t('muse.trainingConfirmBody'),
        confirmLabel:t('muse.trainingConfirm'),cancelLabel:t('common.cancel'),tone:'danger',
      });
      if(!confirmed)return;
      const latestPool=await museWebAccounts();
      if(!latestPool.accounts.some(item=>item.id===account.id))throw Error(t('muse.privacyPoolChanged'));
      setTrainingConfirmation(account.id,Date.now());
      setMessage(t('muse.trainingConfirmedNotice',{name:account.name}));setError(false);
    }catch(error){setMessage(error instanceof Error?error.message:String(error));setError(true);}finally{setBusy(false);}
  };
  const statusText=(status?:AccountState)=>{
    if(!status)return t('muse.statusUnknown');
    if(status.ready)return t('muse.statusReady');
    if(status.state==='checking'||status.state==='loading')return t('muse.statusChecking');
    if(status.state==='unconfirmed')return t('muse.statusUnconfirmed');
    if(status.state==='login')return t('muse.statusLogin');
    if(status.state==='quota')return t('muse.statusQuota');
    if(status.state==='busy')return t('muse.statusBusy');
    return t('muse.statusError');
  };
  const statusForAccount=(id:string)=>statuses[id]||accountChecks?.[id];
  const readyCount=pool?.accounts.filter(account=>statusForAccount(account.id)?.ready).length||0;
  const selectedReplyAccounts=pool?.accounts.filter(account=>autoReplyAccountIds===null||autoReplyAccountIds.includes(account.id))||[];
  const autoReplySummary=!pool?'':selectedReplyAccounts.length===pool.accounts.length?t('muse.autoReplyAccountsAll',{count:pool.accounts.length}):selectedReplyAccounts.length<=2?selectedReplyAccounts.map(account=>account.name).join(', '):t('muse.autoReplyAccountsCount',{count:selectedReplyAccounts.length});
  const loggedInCount=pool?.accounts.filter(account=>{
    const status=statusForAccount(account.id);
    return status?.ready||status?.state==='quota'||status?.state==='busy';
  }).length||0;
  const uncheckedCount=pool?.accounts.filter(account=>!statusForAccount(account.id)).length||0;
  return <div className="col-span-2 space-y-3 rounded-lg border border-zinc-800 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="text-xs font-medium text-zinc-200">{t('muse.poolTitle')}</h4>
        <p className="mt-1 text-2xs text-zinc-500">{pool?t('muse.poolCount',{signedIn:loggedInCount,ready:readyCount,unchecked:uncheckedCount,total:pool.accounts.length}):t('muse.poolLoading')}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={busy||queueBusy||!pool} onClick={()=>void run(async()=>{
          const next=await addMuseWebAccount();setPool(next);
          const addedId=next.accounts.at(-1)?.id;
          if(!addedId)throw Error('Muse 新账号创建结果无效');
          await openMuseWeb(false,addedId);
          return t('muse.accountAdded');
        })}>{t('muse.addAccount')}</Button>
        <Button size="sm" variant="secondary" disabled={busy||queueBusy||!pool} onClick={checkAll}>{busy?t('muse.statusChecking'):t('muse.checkAll')}</Button>
      </div>
    </div>
    <MuseQueueStatus/>
    {activeRequests.map(request => <div key={request.id} className="flex items-center gap-2 text-xs">
      <span title={request.id}>{pool?.accounts.find(account => account.id === request.accountId)?.name || request.accountId}
        {' · '}{t(`muse.activeRequest.${request.kind}` as Parameters<typeof t>[0])}
        {' · '}{new Date(request.startedAt).toLocaleTimeString()}</span>
      <Button size="xs" variant="secondary" onClick={() => void run(async () => {
        await cancelActiveMuseRequest(request.id);
        return t('muse.activeRequest.cancelRequested');
      })}>{t('muse.activeRequest.cancel')}</Button>
    </div>)}
    <div className="flex items-center gap-2 text-xs">
      <span role="status">{t(`muse.playbookBackground.${playbookSync}` as const)}</span>
      <Button size="xs" variant="secondary" onClick={toggleBackgroundPlaybookSync}>
        {t(playbookSync === 'paused' ? 'muse.playbookBackground.resume' : 'muse.playbookBackground.pause')}
      </Button>
    </div>
    {pool?.accounts.map(account=>{
      const status=statusForAccount(account.id);
      const trainable=(playbooks||[]).filter(book=>!book.museMissing&&(book.musePath||book.content.trim()||book.summary.trim()));
      const trained=trainable.filter(book=>hasMuseAccountPlaybook(book,account.id)).length;
      const privacy=privacyByAccountId?.[account.id];
      const trainingConfirmedAt=privacy?.trainingDisabledConfirmedAt||0;
      const actionClass="!h-7 !min-h-7 !w-7 !px-0 shrink-0";
      return <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/30 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-2 text-xs text-zinc-200">
            <span>{account.name}</span>
            {account.id===pool.selectedId&&<span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">{t('muse.currentAccount')}</span>}
            {account.primary&&<span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">{t('muse.primaryAccount')}</span>}
          </div>
          <span title={status?.message} className={`text-2xs ${status?.ready?'text-emerald-400':status?.state==='error'||status?.state==='quota'?'text-amber-400':'text-zinc-500'}`}>{status?.checkedAt?t('muse.statusLastChecked',{status:statusText(status),date:new Date(status.checkedAt).toLocaleString()}):statusText(status)}</span>
          {playbookMode!=='shared'&&!account.primary&&!!trainable.length&&<details className="text-2xs text-zinc-400">
            <summary className="cursor-pointer">{t('muse.playbooksTrained',{trained,total:trainable.length})}</summary>
            <ul className="mt-1 space-y-1">
              {trainable.map(book => <li key={book.id}>
                {book.name} · {t('muse.playbooksTrained',{trained:hasMuseAccountPlaybook(book,account.id)?1:0,total:1})}
              </li>)}
            </ul>
          </details>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.open')} title={t('muse.open')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{await openMuseWeb(false,account.id);return t('muse.loginHint');})}><LogIn className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.check')} title={t('muse.check')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{
            const status=await checkAccount(account.id);
            await flushPersist(()=>useAppStore.getState());
            if(status.state==='unconfirmed')return t('muse.statusUnconfirmedHint');
            if(!status.ready)throw Error(status.message||t('muse.statusLogin'));
            return t('muse.statusReady');
          })}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          {account.id!==pool.selectedId&&<Button size="xs" variant="secondary" className={actionClass} aria-label={t('muse.selectAccount')} title={t('muse.selectAccount')} disabled={busy||queueBusy} onClick={()=>void run(async()=>{
            const next=await selectMuseWebAccount(account.id);setPool(next);return t('muse.accountSelected',{name:account.name});
          })}><Check className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
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
        <div className="basis-full flex items-center justify-between gap-2 rounded border border-zinc-800/80 px-2 py-1.5">
          <span className={`text-2xs ${trainingConfirmedAt?'text-emerald-400':'text-amber-400'}`}>{trainingConfirmedAt?t('muse.trainingConfirmed'):t('muse.trainingUnverified')}</span>
          <Button size="xs" variant="secondary" disabled={busy||queueBusy} onClick={()=>trainingConfirmedAt?setTrainingConfirmation(account.id):void confirmTrainingDisabled(account)}>{trainingConfirmedAt?t('muse.trainingRevoke'):t('muse.trainingConfirm')}</Button>
        </div>
      </div>;
    })}
    {pool&&pool.accounts.length>0&&<div className="space-y-1.5">
      <span className="block text-xs font-medium text-zinc-300" id="muse-auto-reply-accounts-label">{t('muse.autoReplyAccounts')}</span>
      <details ref={autoReplyMenuRef} className="relative text-xs">
        <summary aria-labelledby="muse-auto-reply-accounts-label" className="ui-control flex h-8 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs">
          <span className="truncate">{autoReplySummary||t('muse.autoReplyAccountsNone')}</span><ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        </summary>
        <div role="group" aria-label={t('muse.autoReplyAccounts')} className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
          {pool.accounts.map(account=><label key={account.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"><input type="checkbox" checked={autoReplyAccountIds===null||autoReplyAccountIds.includes(account.id)} disabled={busy} onChange={()=>toggleAutoReplyAccount(account.id)}/><span>{account.name}{account.primary?` · ${t('muse.primaryAccount')}`:''}{!privacyByAccountId?.[account.id]?.trainingDisabledConfirmedAt?` · ${t('muse.privacyBlockedShort')}`:''}</span></label>)}
        </div>
      </details>
      <p className="text-2xs text-zinc-500">{t('muse.autoReplyAccountsHint')}</p>
    </div>}
    {pool&&pool.accounts.length>0&&<div className="space-y-1.5">
      <label className="block text-xs font-medium text-zinc-300" htmlFor="muse-crm-agent-account">{t('muse.crmAgentAccount')}</label>
      <select id="muse-crm-agent-account" className="ui-control h-8 w-full px-2 text-xs" value={crmAgentMuseAccountId} disabled={busy} onChange={event=>useAppStore.getState().updateSettings({crmAgentMuseAccountId:event.target.value})}>
        <option value="">{t('muse.crmAgentAccountCurrent')}</option>
        {pool.accounts.map(account=><option key={account.id} value={account.id}>{account.name}{account.primary?` · ${t('muse.primaryAccount')}`:''}</option>)}
      </select>
      <p className="text-2xs text-zinc-500">{t('muse.crmAgentAccountHint')}</p>
    </div>}
    {pool&&pool.accounts.length>0&&<div className="space-y-1.5">
      <label className="block text-xs font-medium text-zinc-300" htmlFor="muse-outreach-account">{t('muse.outreachAccount')}</label>
      <select id="muse-outreach-account" className="ui-control h-8 w-full px-2 text-xs" value={outreachMuseAccountId} disabled={busy} onChange={event=>useAppStore.getState().updateSettings({aiOutreachMuseAccountId:event.target.value})}>
        <option value="">{t('muse.outreachAccountRotate')}</option>
        {pool.accounts.map(account=><option key={account.id} value={account.id}>{account.name}{account.primary?` · ${t('muse.primaryAccount')}`:''}</option>)}
      </select>
      <p className="text-2xs text-zinc-500">{t('muse.outreachAccountHint')}</p>
    </div>}
    {!pool&&<p className="text-xs text-zinc-500">{t('muse.poolLoading')}</p>}
    <p className="text-2xs text-zinc-500">{t('muse.poolHint')}</p>
    <p className="text-2xs text-zinc-500" title={t('muse.rollover')}>{t('muse.hint')}</p>
    {message&&<p role={error?'alert':'status'} className={`text-xs ${error?'text-amber-500':'text-brand'}`}>{message}</p>}
    {!pool&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>void run(async()=>{const current=await museWebAccounts();setPool(current);return t('muse.poolLoaded');})}>{t('muse.check')}</Button>}
  </div>;
}
