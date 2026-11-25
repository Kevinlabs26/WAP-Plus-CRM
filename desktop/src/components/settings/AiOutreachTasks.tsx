import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, flushPersist, type ChatFolder } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Button, Switch } from "@/components/ui/primitives";
import { cancelOutreachRounds, outreachFolderDismissal, queueOutreachDraft, retryAiOutreach, tickAiOutreach, getOutreachSchedulerStatus, subscribeOutreachScheduler, stopOutreachTask } from "@/lib/aiOutreach";
import { FolderAiPromptDialog } from "@/components/layout/FolderAiPromptDialog";
import { isImmediateOutreach, isPendingOutreachRun as pending, nextScheduledOutreachAt, outreachRunClock, normalizeOutreachRule, type AiOutreachRun } from "@/lib/aiOutreachRules";
import { AiOutreachControls } from "./AiOutreachControls";
import { recipientKey } from "@/lib/scheduledPlans";
import { AiOutreachPreview } from "./AiOutreachPreview";
import { Avatar } from "@/components/ui/Avatar";
import { AiAutoReplyTasks } from "./AiAutoReplyTasks";

const sentStatuses=["sent","server","delivered","read","played"];

function People({count,render}:{count:number;render:(limit:number)=>ReactNode}){
  const {t}=useI18n();
  const [limit,setLimit]=useState(30);
  return <><ul className="divide-y divide-zinc-800">{render(limit)}</ul>
    {count>limit&&<Button size="xs" onClick={()=>setLimit(limit+30)}>{t("aiTasks.more")}</Button>}</>;
}

function OutreachTasks() {
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings);
  const {chatFolders:folders}=settings;
  const deliveries=useAppStore(useShallow(state=>state.settings.aiOutreachRuns.filter(run=>run.messageId).map(run=>state.messagesByChatId[run.chatId]?.find(message=>message.id===run.messageId))));
  const deliveryById=new Map(deliveries.flatMap(message=>message?[[message.id,message] as const]:[]));
  const dismissed=new Set(settings.aiTaskDismissedIds);
  const runsByFolder=new Map<string,AiOutreachRun[]>();
  for(const raw of settings.aiOutreachRuns){
    if(dismissed.has(`outreach:${raw.id}`))continue;
    const message=raw.messageId?deliveryById.get(raw.messageId):undefined;
    const run=message&&sentStatuses.includes(message.deliveryStatus||"")
      ?{...raw,status:"sent" as const,at:message.sentAt,error:undefined}
      :raw.status==="queued"&&message?.deliveryStatus==="failed"&&!message.nextAttemptAt
        ?{...raw,status:"failed" as const,error:message.lastError||raw.error}:raw;
    const group=runsByFolder.get(run.folderId);
    if(group)group.push(run);else runsByFolder.set(run.folderId,[run]);
  }
  const chats=useAppStore(state=>state.chats);
  const contacts=useAppStore(state=>state.contacts);
  const chatsById=useMemo(()=>new Map(chats.map(chat=>[chat.id,chat])),[chats]);
  const contactsById=useMemo(()=>new Map(contacts.map(contact=>[contact.id,contact])),[contacts]);
  const scheduler=useSyncExternalStore(subscribeOutreachScheduler,getOutreachSchedulerStatus);
  const [busy,setBusy]=useState("");
  const [folderId,setFolderId]=useState("");
  const [editing,setEditing]=useState("");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [now,setNow]=useState(Date.now);
  const [bulkOpen,setBulkOpen]=useState(false);
  const [enablePreview,setEnablePreview]=useState(false);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [bulkRule,setBulkRule]=useState(()=>normalizeOutreachRule({enabled:true,mode:"auto",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),5_000);return()=>window.clearInterval(timer);},[]);
  const byId=new Map(folders.map(folder=>[folder.id,folder]));
  const accountNames=new Map(settings.waAccounts.map(account=>[account.id,account.label]));
  const globalPause=settings.aiAutoReplyPaused||settings.aiOutreachPaused;
  const kick=()=>void tickAiOutreach(Date.now(),true).catch(error=>useAppStore.getState().pushToast(String(error),"error"));
  const act=async(key:string,action:()=>Promise<void>)=>{
    if(busy)return;
    setBusy(key);
    try{await action();}catch(error){useAppStore.getState().pushToast(String(error),"error");}
    finally{setBusy("");}
  };
  const startBlock=(folder?:ChatFolder)=>!folder?t("aiOutreach.selectFolderNow")
    :settings.aiAutoReplyPaused?t("outreachReason.all_paused")
    :settings.aiOutreachPaused?t("outreachReason.master_paused")
    :!folder.aiOutreach?.enabled&&folder.aiOutreach?.runNowAt===undefined?t("outreachReason.disabled")
    :folder.aiOutreach?.paused?t("outreachReason.folder_paused")
    :(runsByFolder.get(folder.id)||[]).some(pending)?t("aiOutreach.round.pending"):null;
  const runNow=(folder:ChatFolder)=>act(`start:${folder.id}`,async()=>{
    if(startBlock(folder))return;
    setExpanded(value=>({...value,[folder.id]:true}));
    const state=useAppStore.getState(),at=Date.now();
    state.updateSettings({chatFolders:state.settings.chatFolders.map(item=>item.id===folder.id&&item.aiOutreach
      ?{...item,aiOutreach:{...item.aiOutreach,enabled:true,startMode:"immediate",runNowAt:at,scheduleStartAt:undefined}}:item),
      aiTaskDismissedIds:state.settings.aiTaskDismissedIds.filter(id=>id!==outreachFolderDismissal(folder.id))});
    await flushPersist(useAppStore.getState);
    kick();
  });
  const toggleFolder=(folder:ChatFolder)=>act(`toggle:${folder.id}`,async()=>{
    const state=useAppStore.getState(),rule=state.settings.chatFolders.find(item=>item.id===folder.id)?.aiOutreach;
    if(!rule?.enabled)return;
    state.updateSettings({chatFolders:state.settings.chatFolders.map(item=>item.id===folder.id?{...item,aiOutreach:{...rule,paused:!rule.paused}}:item)});
    await flushPersist(useAppStore.getState);
    if(rule.paused)kick();
  });
  const removeRound=(folder:ChatFolder)=>act(`remove:${folder.id}`,async()=>{
    if(!await useAppStore.getState().requestConfirm({title:t("aiOutreach.folder.remove"),description:t("aiOutreach.folder.removeHint",{folder:folder.name}),confirmLabel:t("aiOutreach.folder.remove"),tone:"danger"}))return;
    await cancelOutreachRounds([folder.id]);
    if(folderId===folder.id)setFolderId("");
  });
  const applyBulk=()=>act("bulk",async()=>{
    if(!selectedIds.length)return;
    const state=useAppStore.getState(),selected=new Set(selectedIds);
    const rule=bulkRule.startMode==="immediate"?{...bulkRule,paused:false,runNowAt:Date.now(),scheduleStartAt:undefined}:{...bulkRule,paused:false,runNowAt:undefined,scheduleStartAt:nextScheduledOutreachAt(bulkRule)??undefined};
    const archiveKeys=new Set(selectedIds.map(outreachFolderDismissal));
    state.updateSettings({chatFolders:state.settings.chatFolders.map(folder=>selected.has(folder.id)?{...folder,aiOutreach:normalizeOutreachRule({...rule,firstContactQuotas:folder.aiOutreach?.firstContactQuotas,firstContactAssignments:folder.aiOutreach?.firstContactAssignments,scheduledFirstContactAssignments:folder.aiOutreach?.scheduledFirstContactAssignments})}:folder),
      aiTaskDismissedIds:state.settings.aiTaskDismissedIds.filter(id=>!archiveKeys.has(id))});
    await flushPersist(useAppStore.getState);
    setBulkOpen(false);setSelectedIds([]);
    if(rule.startMode==="immediate")kick();
  });

  const selected=byId.get(folderId);
  const taskFolders=folders.filter(folder=>{
    const rule=folder.aiOutreach;
    if(dismissed.has(outreachFolderDismissal(folder.id))){
      if(!rule?.enabled)return false;
      if(rule.startMode==="scheduled"&&(rule.paused||!!rule.scheduleStartAt&&now<rule.scheduleStartAt))return false;
    }
    return !!rule?.enabled||rule?.runNowAt!==undefined||runsByFolder.has(folder.id);
  });
  const taskFolderIds=new Set(taskFolders.map(folder=>folder.id));
  const shown=selected?[selected]:taskFolders;
  const removeAll=()=>act("remove-all",async()=>{
    if(!taskFolders.length||!await useAppStore.getState().requestConfirm({title:t("aiOutreach.folder.removeAll"),description:t("aiOutreach.folder.removeAllHint",{count:taskFolders.length}),confirmLabel:t("aiOutreach.folder.removeAll"),tone:"danger"}))return;
    await cancelOutreachRounds([...taskFolderIds]);
    setFolderId("");
  });
  const previewIds=selected?[selected.id]:folders.filter(folder=>folder.aiOutreach?.enabled).map(folder=>folder.id);
  const selectedBlock=startBlock(selected);
  const person=(chatId:string,run?:AiOutreachRun,reason?:string,paused=false)=>{
    const chat=chatsById.get(chatId),contact=chat&&contactsById.get(chat.contactId);
    const phone=contact?.phone||run?.recipient;
    const name=contact?.name||chat?.contactName||phone||chatId;
    const account=run?.accountId||chat?.accountId||contact?.accountId;
    const excluded=!!(run?.recipient&&settings.aiOutreachExcludedRecipients?.includes(recipientKey("",run.recipient)));
    const status=reason?t("aiOutreach.folder.blocked"):!run?"":excluded&&pending(run)?t("aiOutreach.personExcluded")
      :paused&&pending(run)?t("aiTasks.folderPaused"):run.status==="waiting"?t("aiOutreach.folder.preparing")
      :run.status==="failed"?t(run.messageId?"aiOutreach.round.sendFailed":"aiOutreach.round.generationFailed"):t(`aiOutreach.status.${run.status}`);
    const detail=reason||run?.skipReason||run?.error||
      (run&&["failed","skipped","cancelled","expired"].includes(run.status)?t("aiOutreach.round.noReason"):"");
    return <li key={run?.id||chatId} className="py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left hover:text-brand" disabled={!chat} onClick={()=>{const state=useAppStore.getState();state.setSelectedChat(chatId,account);state.goToChats("all");}}>
          <Avatar name={name} seed={phone||chatId} src={contact?.avatarUrl||contact?.avatarFullUrl}/>
          <span className="min-w-0"><strong className="block truncate">{name}</strong>{phone&&phone!==name&&<span className="block truncate text-zinc-500">{phone}</span>}</span>
        </button>
        <span className={run?.status==="sent"?"shrink-0 text-brand":"shrink-0 text-zinc-500"}>{status}</span>
      </div>
      {detail&&<p className="mt-1 break-words text-zinc-500">{detail}</p>}
      {run&&(run.text||run.decisionDetails||pending(run)||run.status==="failed"||run.recipient&&!excluded)&&<details className="mt-1">
        <summary className="cursor-pointer text-zinc-500">{t("outreachPreview.details")}</summary>
        {run.text&&<p className="my-2 whitespace-pre-wrap break-words">{run.text}</p>}
        {run.decisionDetails && <div className="my-2"><AiDecisionDetailsView details={run.decisionDetails}/></div>}
        <div className="flex flex-wrap gap-2">
          {run.status==="draft"&&<Button size="xs" variant="primary" disabled={!!busy||paused||excluded} onClick={()=>void act(run.id,async()=>{if(!await queueOutreachDraft(run.id,true))useAppStore.getState().pushToast(t("aiOutreach.stale"),"info");})}>{t("aiOutreach.confirm")}</Button>}
          {(run.status==="failed"||run.status==="draft"&&!run.messageId)&&!run.archived&&<Button size="xs" disabled={!!busy||paused||excluded||!!(run.messageId&&deliveryById.get(run.messageId)?.deliveryUncertain)} onClick={()=>void act(run.id,async()=>{if(!await retryAiOutreach(run.id))useAppStore.getState().pushToast(t("aiOutreach.stale"),"info");})}>{t(run.status==="draft"?"aiOutreach.recheckDraft":run.messageId?"aiTasks.retrySend":"aiOutreach.retry")}</Button>}
          {pending(run)&&<Button size="xs" disabled={!!busy} onClick={()=>void act(run.id,()=>stopOutreachTask(run.id))}>{t("aiOutreach.stop")}</Button>}
          {run.recipient&&!excluded&&<Button size="xs" disabled={!!busy} onClick={()=>void act(run.id,async()=>{
            const state=useAppStore.getState(),key=recipientKey("",run.recipient!);
            state.updateSettings({aiOutreachExcludedRecipients:[...new Set([...state.settings.aiOutreachExcludedRecipients,key])]});
            await stopOutreachTask(run.id);
          })}>{t("aiTasks.disableOutreachPerson")}</Button>}
        </div>
      </details>}
    </li>;
  };

  return <section className="space-y-3">
    {scheduler.error&&<p role="alert" className="text-sm text-amber-500">{scheduler.error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t("aiTasks.folder")} className="ui-control min-w-48 max-w-full px-3 py-2 text-sm" value={folderId} onChange={event=>setFolderId(event.target.value)}>
        <option value="">{t("aiTasks.allFolders")}</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.parentId&&`${byId.get(folder.parentId)?.name||""} / `}{folder.name}{folder.scope?.type==="account"&&` · ${accountNames.get(folder.scope.accountId)||folder.scope.accountId}`}</option>)}
      </select>
      <Button size="sm" disabled={!selected} onClick={()=>setEditing(folderId)}>{t("aiTasks.configure")}</Button>
      <Button size="sm" variant="primary" title={selectedBlock||undefined} disabled={!!busy||!!selectedBlock} onClick={()=>selected&&void runNow(selected)}>{t(selected&&busy===`start:${selected.id}`?"aiOutreach.round.starting":"aiOutreach.runNow")}</Button>
      <Button size="sm" aria-expanded={bulkOpen} onClick={()=>{setBulkOpen(!bulkOpen);setEnablePreview(false);}}>{t("aiOutreach.bulk")}</Button>
      <Button size="sm" disabled={!!busy||!taskFolders.length} onClick={()=>void removeAll()}>{t("aiOutreach.folder.removeAll")}</Button>
      <label className="ml-auto flex items-center gap-2 text-xs">{t("aiOutreach.master")}<Switch checked={!settings.aiOutreachPaused} onChange={event=>{
        if(event.target.checked){setBulkOpen(false);setEnablePreview(true);}
        else{setEnablePreview(false);useAppStore.getState().updateSettings({aiOutreachPaused:true});}
      }}/></label>
    </div>
    {selected&&selectedBlock&&<p className="text-xs text-zinc-500">{selectedBlock}</p>}
    {globalPause&&<p role="status" className="text-xs text-amber-500">{t(settings.aiAutoReplyPaused?"outreachReason.all_paused":"outreachReason.master_paused")}</p>}
    {bulkOpen&&<section className="rounded-lg border border-brand/30 p-3">
      <div className="flex items-center justify-between gap-2 text-sm"><strong>{t("aiOutreach.bulk")} · {selectedIds.length}</strong><Button size="xs" onClick={()=>setSelectedIds(selectedIds.length===folders.length?[]:folders.map(folder=>folder.id))}>{t(selectedIds.length===folders.length?"aiOutreach.clearSelection":"aiOutreach.selectAll")}</Button></div>
      <div className="mt-2 grid max-h-48 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">{folders.map(folder=><label key={folder.id} className="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs"><input type="checkbox" checked={selectedIds.includes(folder.id)} onChange={event=>setSelectedIds(event.target.checked?[...selectedIds,folder.id]:selectedIds.filter(id=>id!==folder.id))}/><span className="truncate">{folder.name}</span></label>)}</div>
      <AiOutreachControls value={bulkRule} onChange={setBulkRule}/>
      {bulkRule.enabled&&selectedIds.length>0&&<AiOutreachPreview settings={{...settings,chatFolders:folders.map(folder=>selectedIds.includes(folder.id)?{...folder,aiOutreach:{...bulkRule,paused:false,firstContactQuotas:folder.aiOutreach?.firstContactQuotas,firstContactAssignments:folder.aiOutreach?.firstContactAssignments,scheduledFirstContactAssignments:folder.aiOutreach?.scheduledFirstContactAssignments}}:folder)}} folderIds={selectedIds} assumeRunning={settings.aiOutreachPaused}/>}
      <p className="mt-2 text-xs text-zinc-500">{t("aiOutreach.bulkHint")}</p>
      <Button size="sm" className="mt-3" variant="primary" disabled={!!busy||!selectedIds.length||bulkRule.startMode==="immediate"&&globalPause} onClick={()=>void applyBulk()}>{t(bulkRule.startMode==="immediate"?"aiOutreach.applyBulkNow":"aiOutreach.applyBulk")}</Button>
    </section>}
    {enablePreview&&<section className="rounded-lg border border-zinc-800 p-3">
      <AiOutreachPreview settings={settings} folderIds={folders.filter(folder=>folder.aiOutreach?.enabled).map(folder=>folder.id)} assumeRunning onConfirm={()=>{useAppStore.getState().updateSettings({aiOutreachPaused:false});setEnablePreview(false);kick();}}/>
      <Button size="xs" onClick={()=>setEnablePreview(false)}>{t("dialog.cancel")}</Button>
    </section>}
    {!shown.length&&<p className="rounded-lg border border-zinc-800 p-6 text-center text-sm text-zinc-500">{t("aiTasks.noActivePlans")}</p>}
    {shown.map(folder=>{
      const rule=folder.aiOutreach;
      const clock=rule&&outreachRunClock(rule,now);
      const roundAt=rule?.startMode==="immediate"?rule.runNowAt:undefined;
      const history=runsByFolder.get(folder.id)||[];
      const current=history.filter(run=>!run.archived&&run.day===clock?.day&&(run.roundAt===roundAt||roundAt!==undefined&&run.roundAt===undefined&&Date.parse(run.at)>=roundAt));
      const currentIds=new Set(current.map(run=>run.id));
      const older=history.filter(run=>!currentIds.has(run.id)).reverse();
      const check=scheduler.checks.get(folder.id);
      const checked=check?.at===roundAt&&check?.day===clock?.day;
      const paused=!!rule?.paused||globalPause;
      const currentByChat=new Map(current.map(run=>[run.chatId,run]));
      const blocked=checked&&rule?.enabled?[...(check?.blocked||[])].filter(([id])=>{
        const run=currentByChat.get(id);
        return !run||run.status==="waiting"&&!paused;
      }):[];
      const blockedIds=new Set(blocked.map(([id])=>id));
      const queued=current.filter(run=>pending(run)&&!blockedIds.has(run.chatId));
      const sent=current.filter(run=>run.status==="sent").reverse();
      const unsent=current.filter(run=>!pending(run)&&run.status!=="sent").reverse();
      const expired=roundAt!==undefined&&now>=roundAt&&!isImmediateOutreach({runNowAt:roundAt},now);
      const scheduled=roundAt===undefined&&(!checked||!!rule?.scheduleStartAt&&now<rule.scheduleStartAt);
      const running=!!rule?.enabled&&!paused&&!expired&&!scheduled;
      const status=busy===`start:${folder.id}`?"aiOutreach.round.starting"
        :!rule?.enabled?roundAt!==undefined?"aiOutreach.folder.removed":"outreachReason.disabled"
        :expired?"aiOutreach.round.expired":paused?"aiTasks.folderPaused"
        :scheduled?"aiOutreach.folder.scheduled":queued.length?"aiOutreach.folder.running"
        :!checked?"aiOutreach.round.checking":!sent.length&&!unsent.length?"aiOutreach.folder.noReady":"aiOutreach.round.checked";
      const open=expanded[folder.id]??(running||folder.id===folderId);
      return <article key={folder.id} className="rounded-lg border border-zinc-800 p-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" aria-expanded={open} className="flex min-w-0 flex-wrap items-center gap-x-2 text-left text-sm" onClick={()=>setExpanded(value=>({...value,[folder.id]:!open}))}>
            <span aria-hidden>{open?"▾":"▸"}</span><strong>{folder.name}</strong>
            <span role="status" className={running?"text-brand":"text-zinc-500"}>{t(status)}{scheduled&&rule?.enabled&&!paused&&` · ${rule.time}`}</span>
          </button>
          <div className="flex flex-wrap gap-2">
            {rule?.enabled&&!expired&&<Button size="xs" disabled={!!busy||!!rule.paused&&globalPause} onClick={()=>void toggleFolder(folder)}>{t(rule.paused?"aiOutreach.folder.resume":"aiTasks.pause")}</Button>}
            {roundAt!==undefined&&(expired||!rule?.enabled)&&<Button size="xs" variant="primary" title={startBlock(folder)||undefined} disabled={!!busy||!!startBlock(folder)} onClick={()=>void runNow(folder)}>{t("aiOutreach.folder.restart")}</Button>}
            {taskFolderIds.has(folder.id)&&<Button size="xs" disabled={!!busy} onClick={()=>void removeRound(folder)}>{t("aiOutreach.folder.remove")}</Button>}
          </div>
        </header>
        {open&&<div className="mt-3 space-y-3">
          <section><h3 className="text-xs font-semibold">{t("aiOutreach.folder.pending")} · {queued.length}</h3>
            {!!queued.length&&<People count={queued.length} render={limit=>queued.slice(0,limit).map(run=>person(run.chatId,run,undefined,paused))}/>}
          </section>
          <details open={sent.length>0}><summary className="cursor-pointer text-xs font-semibold">{t("aiOutreach.round.sent")} · {sent.length}</summary>
            {!!sent.length&&<People count={sent.length} render={limit=>sent.slice(0,limit).map(run=>person(run.chatId,run))}/>}
          </details>
          <details><summary className="cursor-pointer text-xs font-semibold">{t("aiOutreach.folder.unsent")} · {unsent.length+blocked.length}</summary>
            {!!(unsent.length+blocked.length)&&<People count={unsent.length+blocked.length} render={limit=>[
              ...unsent.slice(0,limit).map(run=>person(run.chatId,run)),
              ...blocked.slice(0,Math.max(0,limit-unsent.length)).map(([chatId,reason])=>person(chatId,currentByChat.get(chatId),t(`outreachReason.${reason}`),paused)),
            ]}/>}
          </details>
          {!!older.length&&<details><summary className="cursor-pointer text-xs text-zinc-500">{t("aiTasks.history")} · {older.length}</summary>
            <People count={older.length} render={limit=>older.slice(0,limit).map(run=>person(run.chatId,run,undefined,paused))}/>
          </details>}
        </div>}
      </article>;
    })}
    {!bulkOpen&&!enablePreview&&<details className="text-xs text-zinc-500"><summary className="cursor-pointer">{t("outreachPreview.title")}</summary>
      <AiOutreachPreview settings={settings} folderIds={previewIds} auto={false}/>
    </details>}
    {editing&&<FolderAiPromptDialog key={editing} folderId={editing} onClose={()=>setEditing("")}/>}
  </section>;
}

export function AiOutreachTasks(){
  const {t}=useI18n();
  const paused=useAppStore(state=>state.settings.aiAutoReplyPaused);
  const [tab,setTab]=useState<"replies"|"outreach">("replies");
  return <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-lg font-semibold">{t("nav.aiOutreach")}</h1>
      <label className="ml-auto flex items-center gap-2 text-sm"><span className={paused?"text-zinc-500":"text-brand"}>{t(paused?"aiTasks.allPaused":"aiTasks.allEnabled")}</span><Switch checked={!paused} onChange={event=>useAppStore.getState().updateSettings({aiAutoReplyPaused:!event.target.checked})}/></label>
    </header>
      <div role="tablist" aria-label={t("nav.aiOutreach")} className="inline-flex gap-1 rounded-full bg-zinc-800 p-1">{(["replies","outreach"] as const).map(value=><button key={value} id={`ai-task-tab-${value}`} type="button" role="tab" aria-selected={tab===value} aria-controls="ai-task-panel" tabIndex={tab===value?0:-1} onClick={()=>setTab(value)} onKeyDown={event=>{
        if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
        event.preventDefault();const next=event.key==="Home"?"replies":event.key==="End"?"outreach":tab==="replies"?"outreach":"replies";
        setTab(next);document.getElementById(`ai-task-tab-${next}`)?.focus();
      }} className={`rounded-full px-3 py-1 text-sm ${tab===value?"bg-brand/15 text-brand":"text-zinc-500"}`}>{t(`aiTasks.${value}`)}</button>)}</div>
    <div id="ai-task-panel" role="tabpanel" aria-labelledby={`ai-task-tab-${tab}`}><div hidden={tab!=="replies"}><AiAutoReplyTasks/></div><div hidden={tab!=="outreach"}><OutreachTasks/></div></div>
  </div></main>;
}
import { AiDecisionDetailsView } from "./AiDecisionDetailsView";
