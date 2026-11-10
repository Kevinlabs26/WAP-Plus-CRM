import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import type { SettingsShape } from "@/store/settingsDefaults";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/primitives";
import { hasRealAiKey } from "@/lib/aiSuggest";
import { buildOutreachPreview, type OutreachPreview } from "@/lib/aiOutreachPreview";
import type { OutreachReason } from "@/lib/aiOutreachContext";

export function AiOutreachPreview({settings,folderIds,assumeRunning=false,auto=true,onConfirm}:{settings:SettingsShape;folderIds:readonly string[];assumeRunning?:boolean;auto?:boolean;onConfirm?:()=>void}){
  const {t}=useI18n();
  const ids=folderIds.join("\n");
  const key=useMemo(()=>JSON.stringify([ids,assumeRunning,settings.chatFolders,settings.aiSystemPrompt,settings.aiSystemPromptByAccountId,settings.aiPromptTemplates,settings.aiAutoReplyPolicy,settings.aiAutoReplyPolicyByAccountId,settings.aiAutoReplyManualChatIds,settings.aiAutoReplyPaused,settings.aiOutreachPaused,settings.aiOutreachExcludedRecipients,settings.sendPausedAccountIds,settings.waAccounts,settings.activeAccountId,settings.liveBaileysAccountId,settings.sendChannel,settings.aiProvider,settings.aiModel,settings.vertexProjectId,settings.vertexLocation,settings.vertexCredentialId,hasRealAiKey(settings)]),[settings,ids,assumeRunning]);
  const [result,setResult]=useState<{key:string;data:OutreachPreview}|null>(null);
  const [busy,setBusy]=useState(false),[checked,setChecked]=useState(0),[error,setError]=useState("");
  const [limit,setLimit]=useState(20),[reason,setReason]=useState("");
  const request=useRef<AbortController|null>(null);
  const refresh=async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setChecked(0);setError("");setLimit(20);setReason("");
    try{
      const data=await buildOutreachPreview({...useAppStore.getState(),settings},folderIds,Date.now(),{assumeRunning,signal:controller.signal,onProgress:setChecked});
      if(!controller.signal.aborted)setResult({key,data});
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}
    finally{if(!controller.signal.aborted)setBusy(false);}
  };
  useEffect(()=>{
    if(!auto)return;
    const timer=window.setTimeout(()=>void refresh(),250);
    return()=>{window.clearTimeout(timer);request.current?.abort();};
  },[key,auto]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const data=result?.key===key?result.data:null;
  const reasons=new Map<OutreachReason,number>();
  for(const row of data?.rows||[])if(!row.eligible)reasons.set(row.reason,(reasons.get(row.reason)||0)+1);
  const rows=(data?.rows||[]).filter(row=>!reason||row.reason===reason);
  const format=(at:number,zone:string)=>new Intl.DateTimeFormat(settings.uiLanguage||"zh-CN",{timeZone:zone,dateStyle:"short",timeStyle:"short"}).format(at);
  const displayZone=data?.rows.find(row=>row.eligible&&row.scheduledAt===data.nextAt)?.timeZone||settings.aiTimeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <section className="mt-3 rounded-xl border border-zinc-800 p-3 text-xs">
    <div className="flex items-center justify-between gap-2"><strong>{t(assumeRunning?"outreachPreview.beforeEnable":"outreachPreview.title")}</strong><Button size="xs" disabled={busy} onClick={()=>void refresh()}>{t(data?"outreachPreview.refresh":"outreachPreview.check")}</Button></div>
    {busy&&<p role="status" className="mt-2 text-zinc-500">{t("outreachPreview.checking",{count:checked})}</p>}
    {error&&<p role="alert" className="mt-2 text-amber-500">{error}</p>}
    {data&&<>
      <p className="mt-2 text-brand">{t("outreachPreview.counts",{eligible:data.eligible,ready:data.readyNow,blocked:data.blocked})}</p>
      <p className="mt-1 text-zinc-500">{t("outreachPreview.snapshot",{time:format(data.checkedAt,displayZone)})}</p>
      {data.nextAt!==null&&<p className="mt-1">{t("outreachPreview.next",{time:`${format(data.nextAt,displayZone)} · ${displayZone}`})}</p>}
      {!data.rows.length&&<p className="mt-2 text-zinc-500">{t("outreachPreview.noMembers")}</p>}
      {!!reasons.size&&<div className="mt-2 flex flex-wrap gap-1">{[...reasons].map(([code,count])=><button key={code} type="button" aria-pressed={reason===code} className={`rounded-full px-2 py-1 ${reason===code?"bg-brand/15 text-brand":"bg-zinc-800 text-zinc-500"}`} onClick={()=>setReason(reason===code?"":code)}>{t(`outreachReason.${code}`)} · {count}</button>)}</div>}
      {!!data.rows.length&&<details className="mt-2"><summary className="cursor-pointer text-zinc-500">{t("outreachPreview.people",{count:rows.length})}</summary>
        <div className="mt-2 max-h-72 divide-y divide-zinc-800/80 overflow-y-auto">{rows.slice(0,limit).map((row,index)=><div key={`${row.folderId}:${row.chatId}:${index}`} className="py-2">
          <div className="flex justify-between gap-2"><span className="truncate font-medium">{row.name}</span><span className={row.eligible?"text-brand":"text-zinc-500"}>{t(`outreachReason.${row.reason}`)}</span></div>
          <p className="mt-1 text-zinc-500">{row.folderName} · {settings.waAccounts.find(account=>account.id===row.accountId)?.label||row.accountId||"—"} · {t(row.mode==="auto"?"aiOutreach.auto":"aiOutreach.draft")}</p>
          <p className="mt-1 text-zinc-500">{row.scheduledAt!==null?`${format(row.scheduledAt,row.timeZone)} · ${row.timeZone}`:"—"} · {t("outreachPreview.limit",{count:row.dailyLimit})}</p>
          {row.historyPending&&<p className="mt-1 text-amber-500">{t("outreachPreview.history")}</p>}
        </div>)}</div>
        {rows.length>limit&&<Button size="xs" className="mt-2" onClick={()=>setLimit(limit+20)}>{t("aiTasks.more")}</Button>}
      </details>}
      <p className="mt-2 text-zinc-500">{t("outreachPreview.hint")}</p>
    </>}
    {onConfirm&&<Button className="mt-3" variant="primary" size="sm" disabled={busy||!data||!!error} onClick={onConfirm}>{t("outreachPreview.enable")}</Button>}
  </section>;
}
