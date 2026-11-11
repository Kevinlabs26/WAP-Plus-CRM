import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, flushPersist } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Button, Switch } from "@/components/ui/primitives";
import { queueOutreachDraft, retryAiOutreach, tickAiOutreach, getOutreachSchedulerStatus } from "@/lib/aiOutreach";
import { FolderAiPromptDialog } from "@/components/layout/FolderAiPromptDialog";
import { outreachClock, normalizeOutreachRule } from "@/lib/aiOutreachRules";
import { AiOutreachControls } from "./AiOutreachControls";
import { recipientKey } from "@/lib/scheduledPlans";
import { AiOutreachPreview } from "./AiOutreachPreview";

export function AiOutreachTasks() {
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings);
  const activeNav=useAppStore(state=>state.activeNav);
  const {chatFolders:folders}=settings;
  const deliveries=useAppStore(useShallow(state=>state.settings.aiOutreachRuns.filter(run=>run.status==="queued").map(run=>state.messagesByChatId[run.chatId]?.find(message=>message.id===run.messageId))));
  const deliveryById=new Map(deliveries.flatMap(message=>message?[[message.id,message] as const]:[]));
  const runs=settings.aiOutreachRuns.map(run=>{
    if(run.status!=="queued"||!run.messageId)return run;
    const message=deliveryById.get(run.messageId);
    if(message&&["sent","server","delivered","read","played"].includes(message.deliveryStatus||""))return {...run,status:"sent" as const};
    if(message?.deliveryStatus==="failed"&&!message.nextAttemptAt)return {...run,status:"failed" as const,error:message.lastError||run.error};
    return run;
  });
  const chats=useAppStore(state=>state.chats);
  const [busy,setBusy]=useState("");
  const [folderId,setFolderId]=useState("");
  const [editing,setEditing]=useState("");
  const [filter,setFilter]=useState("all");
  const [todayOnly,setTodayOnly]=useState(true);
  const [limit,setLimit]=useState(30);
  const [now,setNow]=useState(Date.now);
  const [bulkOpen,setBulkOpen]=useState(false);
  const [enablePreview,setEnablePreview]=useState(false);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [bulkRule,setBulkRule]=useState(()=>normalizeOutreachRule({enabled:true,mode:"auto",trigger:"both",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),5_000);return()=>window.clearInterval(timer);},[]);
  const byId=new Map(folders.map(folder=>[folder.id,folder]));
  const accountNames=new Map(settings.waAccounts.map(account=>[account.id,account.label]));
  const days=useMemo(()=>{
    const zones=new Map<string,string>();
    return new Map(folders.map(folder=>{const zone=folder.aiOutreach?.timeZone||"UTC";if(!zones.has(zone))zones.set(zone,outreachClock(zone,now).day);return [folder.id,zones.get(zone)!];}));
  },[folders,now]);
  const pending=(status:string)=>["generating","draft","queued"].includes(status);
  const scoped=runs.filter(run=>!folderId||run.folderId===folderId);
  const utcDay=outreachClock("UTC",now).day;
  const today=scoped.filter(run=>run.day===(days.get(run.folderId)||utcDay));
  const counts={pending:today.filter(run=>pending(run.status)).length,sent:today.filter(run=>run.status==="sent").length,failed:today.filter(run=>run.status==="failed").length};
  const visible=(todayOnly?today:scoped).filter(run=>filter==="all"||(filter==="pending"?pending(run.status):run.status===filter)).slice().reverse();
  const toggleFolder=async(id:string)=>{
    const state=useAppStore.getState();
    state.updateSettings({chatFolders:state.settings.chatFolders.map(folder=>folder.id===id&&folder.aiOutreach?{...folder,aiOutreach:{...folder.aiOutreach,paused:!folder.aiOutreach.paused}}:folder)});
    try{await flushPersist(useAppStore.getState);}catch(error){useAppStore.getState().pushToast(String(error),"error");}
  };
  const applyBulk=async()=>{
    if(!selectedIds.length)return;
    const state=useAppStore.getState(),selected=new Set(selectedIds);
    state.updateSettings({chatFolders:state.settings.chatFolders.map(folder=>selected.has(folder.id)?{...folder,aiOutreach:normalizeOutreachRule({...bulkRule,paused:false})}:folder)});
    try{await flushPersist(useAppStore.getState);setBulkOpen(false);setSelectedIds([]);}catch(error){useAppStore.getState().pushToast(String(error),"error");}
  };
  const runNow=async()=>{
    if(busy||!folderId)return;
    setBusy("run-now");
    try {
      const state=useAppStore.getState();
      if(state.settings.aiAutoReplyPaused||state.settings.aiOutreachPaused)return;
      state.updateSettings({chatFolders:state.settings.chatFolders.map(folder=>folder.id===folderId&&folder.aiOutreach?.enabled&&!folder.aiOutreach.paused
        ? {...folder,aiOutreach:{...folder.aiOutreach,runNowAt:Date.now()}}:folder)});
      await flushPersist(useAppStore.getState);
      await tickAiOutreach();
      useAppStore.getState().pushToast(t("aiOutreach.runNowStarted"),"info");
    } catch(error){useAppStore.getState().pushToast(String(error),"error");}
    finally{setBusy("");}
  };
  const execute=async(id:string,send:boolean|"retry")=>{
    if(busy)return;setBusy(id);
    try {
      if(send) {if(!await (send==="retry"?retryAiOutreach(id):queueOutreachDraft(id,true)))useAppStore.getState().pushToast(t("aiOutreach.stale"),"info");}
      else {
        const state=useAppStore.getState(),run=state.settings.aiOutreachRuns.find(item=>item.id===id);
        if(!run||!["generating","draft","queued"].includes(run.status))return;
        state.updateSettings({aiOutreachRuns:state.settings.aiOutreachRuns.map(item=>item.id===id?{...item,status:"cancelled",error:t("aiOutreach.stopped")}:item)});
        if(run.messageId)state.updateMessageDelivery(run.messageId,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:t("aiOutreach.stopped")});
        await flushPersist(useAppStore.getState);
      }
    } catch(error){useAppStore.getState().pushToast(String(error),"error");}
    finally{setBusy("");}
  };
  const scheduler=getOutreachSchedulerStatus();
  return <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-5xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{t("nav.aiOutreach")}</h2>
      <label className="flex items-center gap-2 text-sm">{t("aiOutreach.master")}<Switch checked={!settings.aiOutreachPaused} onChange={event=>{
        if(event.target.checked){setBulkOpen(false);setEnablePreview(true);}else{setEnablePreview(false);useAppStore.getState().updateSettings({aiOutreachPaused:true});}
      }}/></label>
    </header>
    <p role="status" className="text-xs text-zinc-500">{t("aiOutreach.scheduler")} · {t(`aiOutreach.scheduler.${scheduler.phase}`)}{scheduler.at?` · ${new Date(scheduler.at).toLocaleTimeString()}`:""}{scheduler.error&&<span role="alert" className="text-amber-500"> · {scheduler.error}</span>}</p>
    {!folderId&&<p className="text-xs text-zinc-500">{t("aiOutreach.selectFolderNow")}</p>}
    {settings.aiAutoReplyPaused&&<p role="status" className="text-xs text-amber-500">{t("aiChat.paused")} <Button size="xs" onClick={()=>useAppStore.getState().updateSettings({aiAutoReplyPaused:false})}>{t("aiTasks.resumeAll")}</Button></p>}
    {settings.aiOutreachPaused&&<p role="status" className="text-xs text-amber-500">{t("aiOutreach.masterPaused")}</p>}
    <div className="flex flex-wrap gap-2">
      <select aria-label={t("aiTasks.folder")} className="ui-control min-w-48 max-w-full px-3 py-2 text-sm" value={folderId} onChange={event=>{setFolderId(event.target.value);setLimit(30);}}>
        <option value="">{t("aiTasks.allFolders")}</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.parentId&&`${byId.get(folder.parentId)?.name||""} / `}{folder.name}{folder.scope?.type==="account"&&` · ${accountNames.get(folder.scope.accountId)||folder.scope.accountId}`}</option>)}
      </select>
      <Button size="sm" disabled={!folderId} onClick={()=>setEditing(folderId)}>{t("aiTasks.configure")}</Button>
      <Button size="sm" disabled={!!busy||!folderId||settings.aiAutoReplyPaused||settings.aiOutreachPaused||!byId.get(folderId)?.aiOutreach?.enabled||!!byId.get(folderId)?.aiOutreach?.paused} onClick={()=>void runNow()}>{t("aiOutreach.runNow")}</Button>
      <Button size="sm" aria-expanded={bulkOpen} onClick={()=>setBulkOpen(!bulkOpen)}>{t("aiOutreach.bulk")}</Button>
      <Button size="sm" aria-pressed={todayOnly} onClick={()=>{setTodayOnly(!todayOnly);setLimit(30);}}>{t(todayOnly?"aiTasks.today":"aiTasks.history")}</Button>
    </div>
    {bulkOpen&&<section className="rounded-xl border border-brand/30 p-3">
      <div className="flex items-center justify-between gap-2 text-sm"><strong>{t("aiOutreach.bulk")} · {selectedIds.length}</strong><Button size="xs" onClick={()=>setSelectedIds(selectedIds.length===folders.length?[]:folders.map(folder=>folder.id))}>{t(selectedIds.length===folders.length?"aiOutreach.clearSelection":"aiOutreach.selectAll")}</Button></div>
      <div className="mt-2 grid max-h-48 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">{folders.map(folder=><label key={folder.id} className="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs"><input type="checkbox" checked={selectedIds.includes(folder.id)} onChange={event=>setSelectedIds(event.target.checked?[...selectedIds,folder.id]:selectedIds.filter(id=>id!==folder.id))}/><span className="truncate">{folder.name}</span></label>)}</div>
      <AiOutreachControls value={bulkRule} onChange={setBulkRule}/>
      {bulkRule.enabled&&selectedIds.length>0&&<AiOutreachPreview settings={{...settings,chatFolders:folders.map(folder=>selectedIds.includes(folder.id)?{...folder,aiOutreach:{...bulkRule,paused:false}}:folder)}} folderIds={selectedIds} assumeRunning={settings.aiOutreachPaused}/>}
      <p className="mt-2 text-xs text-zinc-500">{t("aiOutreach.bulkHint")}</p>
      <Button size="sm" className="mt-3" variant="primary" disabled={!selectedIds.length} onClick={()=>void applyBulk()}>{t("aiOutreach.applyBulk")}</Button>
    </section>}
    {!bulkOpen&&<AiOutreachPreview settings={settings} folderIds={!enablePreview&&folderId?[folderId]:folders.filter(folder=>folder.aiOutreach?.enabled).map(folder=>folder.id)} auto={activeNav==="ai-outreach"} assumeRunning={enablePreview} onConfirm={enablePreview?()=>{useAppStore.getState().updateSettings({aiOutreachPaused:false});setEnablePreview(false);}:undefined}/>}
    {enablePreview&&<Button size="xs" onClick={()=>setEnablePreview(false)}>{t("dialog.cancel")}</Button>}
    <div className="grid grid-cols-3 gap-3">{(["pending","sent","failed"] as const).map(key=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>{setFilter(filter===key?"all":key);setLimit(30);}} className={`rounded-xl border p-3 text-left ${filter===key?"border-brand bg-brand/10":"border-zinc-800"}`}>
      <span className="text-xs text-zinc-500">{t(`aiTasks.${key}`)}</span><strong className="mt-1 block text-xl tabular-nums">{counts[key]}</strong>
    </button>)}</div>
    <section className="space-y-2" aria-label={t("aiTasks.folder")}>
      {folders.filter(folder=>(!folderId||folder.id===folderId)&&folder.aiOutreach).map(folder=><div key={folder.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 px-3 py-2 text-xs">
        <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold hover:text-brand" onClick={()=>setEditing(folder.id)}>{folder.name}</button>
        <span className="text-zinc-500">{folder.aiOutreach!.time} · {folder.aiOutreach!.timeZone} · {t(folder.aiOutreach!.mode==="auto"?"aiOutreach.auto":"aiOutreach.draft")}</span>
        <span role="status" className="text-zinc-500">{t(!folder.aiOutreach!.enabled?"aiTasks.disabled":folder.aiOutreach!.paused||settings.aiAutoReplyPaused||settings.aiOutreachPaused?"aiTasks.folderPaused":"aiTasks.running")}</span>
        {folder.aiOutreach!.enabled&&<Button size="xs" disabled={settings.aiAutoReplyPaused} onClick={()=>void toggleFolder(folder.id)}>{t(folder.aiOutreach!.paused?"aiTasks.resume":"aiTasks.pause")}</Button>}
      </div>)}
    </section>
    {runs.length>=10_000&&<p role="alert" className="mt-2 text-xs text-amber-500">{t("aiOutreach.capacity")}</p>}
    <p className="text-xs text-zinc-500">{t("aiOutreach.taskHint")}</p>
    {!visible.length&&<p className="rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-500">{t("aiOutreach.empty")}</p>}
    {visible.slice(0,limit).map(run=>{
      const folder=byId.get(run.folderId),personExcluded=!!(run.recipient&&settings.aiOutreachExcludedRecipients?.includes(recipientKey("",run.recipient))),paused=settings.aiAutoReplyPaused||settings.aiOutreachPaused||folder?.aiOutreach?.paused||personExcluded;
      return <article key={run.id} className="rounded-xl border border-zinc-800 p-3 text-xs">
      <div className="flex justify-between gap-2"><button type="button" className="truncate font-semibold hover:text-brand" onClick={()=>{const state=useAppStore.getState();state.setSelectedChat(run.chatId,run.accountId);state.goToChats("all");}}>{chats.find(chat=>chat.id===run.chatId)?.contactName||run.recipient||run.chatId}</button><span role="status">{t(personExcluded&&pending(run.status)?"aiOutreach.personExcluded":paused&&pending(run.status)?"aiTasks.folderPaused":`aiOutreach.status.${run.status}`)}</span></div>
      <div className="mt-1 text-zinc-500">{folder?.name} · {settings.waAccounts.find(account=>account.id===run.accountId)?.label||run.accountId} · {run.day}</div>
      {run.text&&<details className="mt-2"><summary className="cursor-pointer text-zinc-500">{t("aiTasks.message")}</summary><p className="mt-2 whitespace-pre-wrap">{run.text}</p></details>}
      {run.error&&<p role="alert" className="mt-2 text-amber-500">{run.error}</p>}
      <div className="mt-2 flex gap-2">{run.status==="draft"&&<Button size="xs" variant="primary" disabled={!!busy||!!paused} onClick={()=>void execute(run.id,true)}>{t("aiOutreach.confirm")}</Button>}
        {!run.messageId&&["failed","cancelled"].includes(run.status)&&<Button size="xs" disabled={!!busy||!!paused} onClick={()=>void execute(run.id,"retry")}>{t("aiOutreach.retry")}</Button>}
        {pending(run.status)&&<Button size="xs" disabled={!!busy} onClick={()=>void execute(run.id,false)}>{t("aiOutreach.stop")}</Button>}</div>
    </article>;})}
    {visible.length>limit&&<Button size="sm" onClick={()=>setLimit(limit+30)}>{t("aiTasks.more")}</Button>}
    {editing&&<FolderAiPromptDialog key={editing} folderId={editing} onClose={()=>setEditing("")}/>}
  </div></main>;
}
