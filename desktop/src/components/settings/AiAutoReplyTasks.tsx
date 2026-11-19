import { useMemo, useState } from "react";
import { useAppStore, flushPersist } from "@/store/appStore";
import { useAutoReplyRuntime, type AutoReplyRuntime } from "@/lib/autoReplyRuntime";
import { getPendingAiAutoFollowUps, retryAutoReplyTask, stopAutoReplyTask, stopChatAutoReply } from "@/lib/aiAutoReply";
import type { AiReplyTaskRecord } from "@/lib/aiTaskRecords";
import type { Message } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import { Button, Switch } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { resolveAutoReplyScope } from "@/lib/autoReplyScope";
import { AiDecisionDetailsView } from "./AiDecisionDetailsView";

type Row={id:string;chatId:string;accountId?:string;task?:AutoReplyRuntime;record?:AiReplyTaskRecord;message?:Message;followUp?:{step:number;dueAt:number;inboundId:string}};
type ContactGroup={id:string;contactId?:string;rows:Row[];chatIds:string[];latest:Row};
const pending=(row:Row)=>!!row.followUp||!!row.task&&row.task.phase!=="human"||!!row.message&&(["pending","queued"].includes(row.message.deliveryStatus||"")||!!row.message.nextAttemptAt);
const human=(row:Row)=>row.task?.phase==="human"||!row.task&&!row.message&&row.record?.phase==="human";
const failed=(row:Row)=>row.message?.deliveryStatus==="failed"||!row.task&&!row.message&&!!row.record&&!['ended','human'].includes(row.record.phase);

export function AiAutoReplyTasks(){
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings),messages=useAppStore(state=>state.messages);
  const chats=useAppStore(state=>state.chats),contacts=useAppStore(state=>state.contacts),runtime=useAutoReplyRuntime(state=>state.byChat);
  const [limit,setLimit]=useState(30),[busy,setBusy]=useState(""),[showHistory,setShowHistory]=useState(false);
  const [search,setSearch]=useState(""),[account,setAccount]=useState(""),[filter,setFilter]=useState("all"),[date,setDate]=useState("");
  const [expandedGroups,setExpandedGroups]=useState<Set<string>>(()=>new Set());
  const autoRepliesPaused=settings.aiAutoReplyPaused||settings.aiAutoReplyDisabled;
  const hidden=new Set(settings.aiTaskDismissedIds||[]);
  const chatsById=useMemo(()=>new Map(chats.map(chat=>[chat.id,chat])),[chats]);
  const contactsById=useMemo(()=>new Map(contacts.map(contact=>[contact.id,contact])),[contacts]);
  const messagesById=useMemo(()=>new Map(messages.map(message=>[message.id,message])),[messages]);
  const allRows=new Map<string,Row>(),representedMessages=new Set<string>();
  for(const record of settings.aiReplyTaskRecords||[]){
    allRows.set(record.id,{id:record.id,chatId:record.chatId,accountId:record.accountId,record,message:record.messageId?messagesById.get(record.messageId):undefined});
    if(record.messageId)representedMessages.add(record.messageId);
  }
  for(const [chatId,task] of Object.entries(runtime)){
    const id=`runtime:${chatId}:${task.inboundId}`;allRows.set(id,{...allRows.get(id),id,chatId,accountId:task.accountId,task});
  }
  for(const message of messages)if(message.systemKind==="ai_auto_reply"&&!representedMessages.has(message.id)){
    const id=message.aiReplyInboundId?`runtime:${message.chatId}:${message.aiReplyInboundId}`:`reply:${message.id}`;
    const current=allRows.get(id);
    allRows.set(id,{...current,id,chatId:message.chatId,accountId:message.accountId||current?.accountId,message:message.aiAutoFollowUpStep?current?.message||message:message});
  }
  if(!showHistory)for(const task of getPendingAiAutoFollowUps()){
    const id=`followup:${task.chatId}:${task.inboundId}`;
    allRows.set(id,{id,chatId:task.chatId,accountId:task.accountId,message:task.message,followUp:{step:task.step,dueAt:task.dueAt,inboundId:task.inboundId}});
  }
  const rows=[...allRows.values()].filter(row=>{
    const chat=chatsById.get(row.chatId),contact=chat&&contactsById.get(chat.contactId);
    if(hidden.has(row.id)||row.message&&hidden.has(`reply:${row.message.id}`)||!chat||chat.isGroup||chat.localOnly||!contact||contact.isGroup||contact.channelAddress?.endsWith("@g.us"))return false;
    if(account&&row.accountId!==account)return false;
    if(search&&!`${contact.name} ${contact.phone} ${chat.contactName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))return false;
    if(showHistory&&date&&new Date(row.record?.at||row.message?.sentAt||Date.now()).toLocaleDateString("en-CA")!==date)return false;
    if(filter==="pending"&&!pending(row)||filter==="failed"&&!failed(row)||filter==="human"&&!human(row))return false;
    return showHistory||resolveAutoReplyScope({...settings,aiAutoReplyPaused:false,aiAutoReplyDisabled:false},row.chatId).mode==="auto"&&(pending(row)||failed(row)||human(row));
  }).sort((a,b)=>Number(pending(b))-Number(pending(a))||(b.record?.at||b.message?.sentAt||"").localeCompare(a.record?.at||a.message?.sentAt||""));
  const rowTime=(row:Row)=>Date.parse(row.record?.at||row.message?.sentAt||"")||0;
  const grouped=new Map<string,{contactId?:string;rows:Row[]}>();
  for(const row of rows){
    const contactId=chatsById.get(row.chatId)?.contactId,id=contactId?`contact:${contactId}`:`chat:${row.chatId}`;
    let group=grouped.get(id);
    if(!group){group={contactId,rows:[]};grouped.set(id,group);}
    group.rows.push(row);
  }
  const groups:ContactGroup[]=[...grouped].map(([id,group])=>{
    const groupedRows=[...group.rows].sort((a,b)=>rowTime(b)-rowTime(a));
    const chatIds=group.contactId
      ? chats.filter(chat=>chat.contactId===group.contactId&&!chat.isGroup&&!chat.localOnly).map(chat=>chat.id)
      : [...new Set(groupedRows.map(row=>row.chatId))];
    return {id,contactId:group.contactId,rows:groupedRows,chatIds,latest:groupedRows[0]};
  }).sort((a,b)=>rowTime(b.latest)-rowTime(a.latest));
  const resultText=(row:Row)=>{
    if(pending(row)&&settings.aiAutoReplyPaused)return t("aiTasks.allPaused");
    if(pending(row)&&settings.aiAutoReplyDisabled)return t("aiTasks.autoRepliesAllPaused");
    if(row.followUp)return t("settingsAutoReply.followUpPending");
    if(row.message?.deliveryUncertain)return t("aiChat.uncertain");
    if(row.message?.deliveryStatus==="failed")return t("aiTasks.result.notSent",{reason:row.message.lastError||t("aiOutreach.status.failed")});
    if(row.message&&(!row.message.deliveryStatus||["sent","server","delivered","read","played"].includes(row.message.deliveryStatus)))return t("aiOutreach.status.sent");
    const reason=row.task?.reason||row.message?.lastError||row.record?.reason;
    if(human(row))return reason?t("aiTasks.result.transferredReason",{reason}):t("aiTasks.result.transferred");
    if(row.message&&pending(row))return reason?t("aiTasks.result.phaseReason",{status:t("aiOutreach.status.queued"),reason}):t("aiOutreach.status.queued");
    if(row.task)return reason?t("aiTasks.result.phaseReason",{status:t(`aiChat.${row.task.phase}`),reason}):t(`aiChat.${row.task.phase}`);
    if(reason)return t("aiTasks.result.notSent",{reason});
    if(row.record?.phase==="ended")return t("aiTasks.result.noSendRecord");
    if(row.record)return t("aiTasks.result.interrupted");
    return t("aiTasks.result.noSendRecord");
  };
  const act=async(row:Row,action:"stop"|"delete"|"retry"|"regenerate")=>{
    if(busy)return;setBusy(row.id);
    try{
      const state=useAppStore.getState(),inboundId=row.task?.inboundId||row.record?.inboundId||row.message?.aiReplyInboundId;
      if(action==="stop"||action==="delete")stopAutoReplyTask(row.chatId,inboundId,row.message?.id);
      else if(!await retryAutoReplyTask(row.chatId,inboundId,row.message?.id,action==="regenerate"))state.pushToast(t("aiOutreach.stale"),"info");
      if(action==="delete"){
        const fresh=useAppStore.getState();fresh.updateSettings({aiTaskDismissedIds:[...new Set([...(fresh.settings.aiTaskDismissedIds||[]),row.id])]});
      }
      await flushPersist(useAppStore.getState);
    }catch(error){useAppStore.getState().pushToast(String(error),"error");}finally{setBusy("");}
  };
  const disableContact=async(group:ContactGroup)=>{
    if(busy||!group.chatIds.length)return;setBusy(`contact:${group.id}`);
    try{
      const state=useAppStore.getState(),modes={...state.settings.aiAutoReplyModeByChatId};
      for(const chatId of group.chatIds)modes[chatId]="manual";
      state.updateSettings({aiAutoReplyModeByChatId:modes});
      for(const chatId of group.chatIds)stopChatAutoReply(chatId);
      await flushPersist(useAppStore.getState);
    }catch(error){useAppStore.getState().pushToast(String(error),"error");}finally{setBusy("");}
  };
  const clearFinished=async()=>{
    const ids=rows.filter(row=>!pending(row)&&!row.task).map(row=>row.id);
    const state=useAppStore.getState();state.updateSettings({aiTaskDismissedIds:[...new Set([...(state.settings.aiTaskDismissedIds||[]),...ids])]});
    try{await flushPersist(useAppStore.getState);}catch(error){state.pushToast(String(error),"error");}
  };
  return <section className="space-y-3">
    <header className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-lg font-semibold">{t("aiTasks.replies")} · {rows.length}</h2>
      <label className="flex items-center gap-2 text-xs"><span className={settings.aiAutoReplyDisabled?"text-zinc-500":"text-brand"}>{t(settings.aiAutoReplyDisabled?"aiTasks.autoRepliesDisabled":"aiTasks.autoRepliesEnabled")}</span><Switch checked={!settings.aiAutoReplyDisabled} onChange={async event=>{
        const enabled=event.target.checked,state=useAppStore.getState();
        if(enabled&&!await state.requestConfirm({title:t("aiTasks.autoRepliesResumeTitle"),description:t("aiTasks.autoRepliesResumeDescription"),confirmLabel:t("aiTasks.autoRepliesEnabled"),cancelLabel:t("common.cancel"),tone:"danger"}))return;
        useAppStore.getState().updateSettings({aiAutoReplyDisabled:!enabled});
      }}/></label>
      <Button size="xs" aria-pressed={showHistory} onClick={()=>{setShowHistory(!showHistory);setLimit(30);}}>{t(showHistory?"aiOutreach.queue":"aiTasks.history")}</Button>
      {showHistory&&<Button size="xs" disabled={!!busy} onClick={()=>void clearFinished()}>{t("aiTasks.clearFinished")}</Button>}
    </header>
    <div className="flex flex-wrap gap-2">
      <input className="ui-control min-w-40 flex-1 px-3 py-2 text-xs" placeholder={t("aiTasks.search")} aria-label={t("aiTasks.search")} value={search} onChange={event=>{setSearch(event.target.value);setLimit(30);}}/>
      <select className="ui-control px-2 text-xs" aria-label={t("aiTasks.allAccounts")} value={account} onChange={event=>{setAccount(event.target.value);setLimit(30);}}><option value="">{t("aiTasks.allAccounts")}</option>{settings.waAccounts.map(account=><option key={account.id} value={account.id}>{account.label||account.id}</option>)}</select>
      <select className="ui-control px-2 text-xs" aria-label={t("aiTasks.status")} value={filter} onChange={event=>{setFilter(event.target.value);setLimit(30);}}>{["all","pending","failed","human"].map(value=><option key={value} value={value}>{t(value==="all"?"aiTasks.all":value==="pending"?"aiOutreach.queue":value==="human"?"aiChat.human":"aiOutreach.status.failed")}</option>)}</select>
      {showHistory&&<input type="date" className="ui-control px-2 text-xs" aria-label={t("aiTasks.date")} value={date} onChange={event=>{setDate(event.target.value);setLimit(30);}}/>}
    </div>
    {!groups.length&&<p className="py-3 text-sm text-zinc-500">{t("aiOutreach.empty")}</p>}
    {groups.slice(0,limit).map((group,index)=>{
      const latest=group.latest,chat=chatsById.get(latest.chatId),contact=chat&&contactsById.get(chat.contactId);
      const name=contact?.name||chat?.contactName||contact?.phone||latest.chatId;
      const expanded=expandedGroups.has(group.id),groupBodyId=`ai-auto-reply-group-${index}`;
      const toggleGroup=()=>setExpandedGroups(current=>{const next=new Set(current);if(next.has(group.id))next.delete(group.id);else next.add(group.id);return next;});
      return <section key={group.id} className="overflow-hidden rounded-lg border border-zinc-800">
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <button type="button" aria-expanded={expanded} aria-controls={groupBodyId} className="shrink-0 text-zinc-500" onClick={toggleGroup}>{expanded?"▾":"▸"}</button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={()=>{const state=useAppStore.getState();state.setSelectedChat(latest.chatId,latest.accountId);state.goToChats("all");}}>
            <Avatar name={name} seed={contact?.phone||latest.chatId} src={contact?.avatarUrl||contact?.avatarFullUrl} size="sm"/><span className="min-w-0"><strong className="block truncate">{name}</strong><span className="block truncate text-zinc-500">{contact?.phone||latest.chatId} · {t("aiTasks.groupRecordCount",{count:group.rows.length})}</span></span>
          </button>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            <span role="status" title={resultText(latest)} className={`max-w-full truncate rounded-full px-2 py-0.5 ${failed(latest)?"bg-rose-500/10 text-rose-400":pending(latest)?"bg-amber-500/10 text-amber-400":human(latest)?"bg-sky-500/10 text-sky-400":"bg-zinc-800 text-zinc-400"}`}>{resultText(latest)}</span>
            {(latest.record?.at||latest.message?.sentAt)&&<time dateTime={latest.record?.at||latest.message?.sentAt} className="text-zinc-500">{new Date(latest.record?.at||latest.message?.sentAt||"").toLocaleString()}</time>}
          </div>
          <Button size="xs" disabled={!!busy||!group.chatIds.length} onClick={()=>void disableContact(group)}>{t("aiTasks.disablePerson")}</Button>
        </div>
        {expanded&&<div id={groupBodyId} className="divide-y divide-zinc-800/70 border-t border-zinc-800/70">
          {group.rows.map(row=>{
            const activityAt=row.record?.at||row.message?.sentAt;
            const replyDurationMs=row.message?.aiReplyReceivedAt!==undefined?row.message?.aiReplyDurationMs:undefined;
            const sendComplete=!row.message?.deliveryStatus||["sent","server","delivered","read","played"].includes(row.message.deliveryStatus);
            const replySeconds=row.message&&!row.message.aiAutoFollowUpStep&&sendComplete&&typeof replyDurationMs==="number"&&Number.isFinite(replyDurationMs)&&replyDurationMs>=0?(replyDurationMs/1000).toFixed(1):undefined;
            const durationUnavailable=row.message&&!row.message.aiAutoFollowUpStep&&sendComplete&&!replySeconds;
            const museName=row.message?.aiReplyMuseAccountName||row.message?.aiReplyMuseAccountId;
            return <article key={row.id} className="grid gap-x-3 gap-y-1.5 p-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="flex flex-wrap items-center gap-2">
                <span role="status" title={resultText(row)} className={`max-w-full truncate rounded-full px-2 py-0.5 ${failed(row)?"bg-rose-500/10 text-rose-400":pending(row)?"bg-amber-500/10 text-amber-400":human(row)?"bg-sky-500/10 text-sky-400":"bg-zinc-800 text-zinc-400"}`}>{resultText(row)}</span>
                {activityAt&&<time dateTime={activityAt} className="text-zinc-500">{new Date(activityAt).toLocaleString()}</time>}
              </div>
              {(replySeconds||durationUnavailable||museName)&&<p className="text-zinc-500 sm:col-span-2">
                {replySeconds&&t("aiTasks.replyDuration",{seconds:replySeconds})}
                {replySeconds&&museName&&" · "}
                {durationUnavailable&&t("aiTasks.replyDurationUnavailable")}
                {durationUnavailable&&museName&&" · "}
                {museName&&<span title={row.message?.aiReplyMuseAccountId}>{t("aiTasks.replyMuse",{name:museName})}</span>}
              </p>}
              <div className="empty:hidden sm:col-span-2">
                <AiDecisionDetailsView details={row.message?.aiDecisionDetails||row.task?.decisionDetails||row.record?.decisionDetails} showMuse={!museName} />
              </div>
              {row.followUp&&<p className="text-zinc-500 sm:col-span-2">{t("settingsAutoReply.followUpDue",{step:row.followUp.step,time:new Date(row.followUp.dueAt).toLocaleString()})}</p>}
              {row.task?.retryAt&&!autoRepliesPaused&&<p className="text-zinc-500 sm:col-span-2">{new Date(row.task.retryAt).toLocaleTimeString()}</p>}
              {row.message?.body&&<p className="whitespace-pre-wrap text-zinc-300 sm:col-span-2">{row.message.body}</p>}
              <div className="flex flex-wrap gap-2 border-t border-zinc-800/70 pt-2 sm:col-span-2">
                {pending(row)&&<Button size="xs" disabled={!!busy} onClick={()=>void act(row,"stop")}>{t("aiTasks.stopOnce")}</Button>}
                {row.message?.deliveryStatus==="failed"&&!row.message.deliveryUncertain&&<Button size="xs" disabled={!!busy||autoRepliesPaused} onClick={()=>void act(row,"retry")}>{t("aiTasks.retrySend")}</Button>}
                {(failed(row)||human(row))&&!row.message?.deliveryUncertain&&<Button size="xs" disabled={!!busy||autoRepliesPaused} onClick={()=>void act(row,"regenerate")}>{t(human(row)?"outreachPreview.refresh":"aiOutreach.retry")}</Button>}
                <Button size="xs" disabled={!!busy} title={t("aiTasks.replyRecordsHint")} onClick={()=>void act(row,"delete")}>{t("common.delete")}</Button>
              </div>
            </article>;
          })}
        </div>}
      </section>;
    })}
    {groups.length>limit&&<Button size="xs" onClick={()=>setLimit(limit+30)}>{t("aiTasks.more")}</Button>}
  </section>;
}
