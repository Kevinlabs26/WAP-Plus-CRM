import { useMemo, useState } from "react";
import { useAppStore, flushPersist } from "@/store/appStore";
import { useAutoReplyRuntime, type AutoReplyRuntime } from "@/lib/autoReplyRuntime";
import { retryAutoReplyTask, stopAutoReplyTask, stopChatAutoReply } from "@/lib/aiAutoReply";
import type { AiReplyTaskRecord } from "@/lib/aiTaskRecords";
import type { Message } from "@/types/crm";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { resolveAutoReplyScope } from "@/lib/autoReplyScope";

type Row={id:string;chatId:string;accountId?:string;task?:AutoReplyRuntime;record?:AiReplyTaskRecord;message?:Message};
const pending=(row:Row)=>!!row.task&&row.task.phase!=="human"||!!row.message&&(["pending","queued"].includes(row.message.deliveryStatus||"")||!!row.message.nextAttemptAt);
const human=(row:Row)=>row.task?.phase==="human"||!row.task&&!row.message&&row.record?.phase==="human";
const failed=(row:Row)=>row.message?.deliveryStatus==="failed"||!row.task&&!row.message&&!!row.record&&!["ended","human"].includes(row.record.phase);

export function AiAutoReplyTasks(){
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings),messages=useAppStore(state=>state.messages);
  const chats=useAppStore(state=>state.chats),contacts=useAppStore(state=>state.contacts),runtime=useAutoReplyRuntime(state=>state.byChat);
  const [limit,setLimit]=useState(30),[busy,setBusy]=useState(""),[showHistory,setShowHistory]=useState(false);
  const [search,setSearch]=useState(""),[account,setAccount]=useState(""),[filter,setFilter]=useState("all"),[date,setDate]=useState("");
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
    allRows.set(id,{...allRows.get(id),id,chatId:message.chatId,accountId:message.accountId,message});
  }
  const rows=[...allRows.values()].filter(row=>{
    const chat=chatsById.get(row.chatId),contact=chat&&contactsById.get(chat.contactId);
    if(hidden.has(row.id)||row.message&&hidden.has(`reply:${row.message.id}`)||!chat||chat.isGroup||chat.localOnly||!contact||contact.isGroup||contact.channelAddress?.endsWith("@g.us"))return false;
    if(account&&row.accountId!==account)return false;
    if(search&&!`${contact.name} ${contact.phone} ${chat.contactName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))return false;
    if(showHistory&&date&&new Date(row.record?.at||row.message?.sentAt||Date.now()).toLocaleDateString("en-CA")!==date)return false;
    if(filter==="pending"&&!pending(row)||filter==="failed"&&!failed(row)||filter==="human"&&!human(row))return false;
    return showHistory||resolveAutoReplyScope({...settings,aiAutoReplyPaused:false},row.chatId).mode==="auto"&&(pending(row)||failed(row)||human(row));
  }).sort((a,b)=>Number(pending(b))-Number(pending(a))||(b.record?.at||b.message?.sentAt||"").localeCompare(a.record?.at||a.message?.sentAt||""));
  const act=async(row:Row,action:"stop"|"delete"|"disable"|"retry"|"regenerate")=>{
    if(busy)return;setBusy(row.id);
    try{
      const state=useAppStore.getState(),inboundId=row.task?.inboundId||row.record?.inboundId||row.message?.aiReplyInboundId;
      if(action==="disable"){
        state.updateSettings({aiAutoReplyModeByChatId:{...state.settings.aiAutoReplyModeByChatId,[row.chatId]:"manual"}});stopChatAutoReply(row.chatId);
      }else if(action==="stop"||action==="delete")stopAutoReplyTask(row.chatId,inboundId,row.message?.id);
      else if(!await retryAutoReplyTask(row.chatId,inboundId,row.message?.id,action==="regenerate"))state.pushToast(t("aiOutreach.stale"),"info");
      if(action==="delete"){
        const fresh=useAppStore.getState();fresh.updateSettings({aiTaskDismissedIds:[...new Set([...(fresh.settings.aiTaskDismissedIds||[]),row.id])]});
      }
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
      <Button size="xs" aria-pressed={showHistory} onClick={()=>{setShowHistory(!showHistory);setLimit(30);}}>{t(showHistory?"aiOutreach.queue":"aiTasks.history")}</Button>
      {showHistory&&<Button size="xs" disabled={!!busy} onClick={()=>void clearFinished()}>{t("aiTasks.clearFinished")}</Button>}
    </header>
    <div className="flex flex-wrap gap-2">
      <input className="ui-control min-w-40 flex-1 px-3 py-2 text-xs" placeholder={t("aiTasks.search")} aria-label={t("aiTasks.search")} value={search} onChange={event=>{setSearch(event.target.value);setLimit(30);}}/>
      <select className="ui-control px-2 text-xs" aria-label={t("aiTasks.allAccounts")} value={account} onChange={event=>{setAccount(event.target.value);setLimit(30);}}><option value="">{t("aiTasks.allAccounts")}</option>{settings.waAccounts.map(account=><option key={account.id} value={account.id}>{account.label||account.id}</option>)}</select>
      <select className="ui-control px-2 text-xs" aria-label={t("aiTasks.status")} value={filter} onChange={event=>{setFilter(event.target.value);setLimit(30);}}>{["all","pending","failed","human"].map(value=><option key={value} value={value}>{t(value==="all"?"aiTasks.all":value==="pending"?"aiOutreach.queue":value==="human"?"aiChat.human":"aiOutreach.status.failed")}</option>)}</select>
      {showHistory&&<input type="date" className="ui-control px-2 text-xs" aria-label={t("aiTasks.date")} value={date} onChange={event=>{setDate(event.target.value);setLimit(30);}}/>}
    </div>
    {!rows.length&&<p className="py-3 text-sm text-zinc-500">{t("aiOutreach.empty")}</p>}
    {rows.slice(0,limit).map(row=>{
      const chat=chatsById.get(row.chatId),contact=chat&&contactsById.get(chat.contactId),name=contact?.name||chat?.contactName||contact?.phone||row.chatId;
      const interrupted=!row.task&&!!row.record&&!row.message&&!["ended","human"].includes(row.record.phase);
      const status=t(settings.aiAutoReplyPaused&&pending(row)?"aiTasks.allPaused":row.message?.deliveryUncertain?"aiChat.uncertain":row.task?`aiChat.${row.task.phase}`:row.message?(failed(row)?"aiOutreach.status.failed":pending(row)?"aiOutreach.status.queued":"aiOutreach.status.sent"):interrupted?"aiTasks.interrupted":row.record?.phase==="human"?"aiChat.human":"aiTasks.ended");
      return <article key={row.id} className="rounded-xl border border-zinc-800 p-3 text-xs">
        <div className="flex justify-between gap-3"><button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={()=>{const state=useAppStore.getState();state.setSelectedChat(row.chatId,row.accountId);state.goToChats("all");}}>
          <Avatar name={name} seed={contact?.phone||row.chatId} src={contact?.avatarUrl||contact?.avatarFullUrl}/><span className="min-w-0"><strong className="block truncate">{name}</strong><span className="block truncate text-zinc-500">{contact?.phone} · {settings.waAccounts.find(account=>account.id===row.accountId)?.label||row.accountId}</span></span>
        </button><span role="status" className="shrink-0">{status}</span></div>
        {(row.task?.reason||row.message?.lastError||row.record?.reason)&&<p className="mt-2 text-amber-500">{row.task?.reason||row.message?.lastError||row.record?.reason}</p>}
        {row.task?.retryAt&&!settings.aiAutoReplyPaused&&<p className="mt-1 text-zinc-500">{new Date(row.task.retryAt).toLocaleTimeString()}</p>}
        {row.message?.body&&<details className="mt-2"><summary className="cursor-pointer text-zinc-500">{t("aiTasks.message")}</summary><p className="mt-2 whitespace-pre-wrap">{row.message.body}</p></details>}
        <div className="mt-2 flex flex-wrap gap-2">
          {pending(row)&&<Button size="xs" disabled={!!busy} onClick={()=>void act(row,"stop")}>{t("aiTasks.stopOnce")}</Button>}
          {row.message?.deliveryStatus==="failed"&&!row.message.deliveryUncertain&&<Button size="xs" disabled={!!busy||settings.aiAutoReplyPaused} onClick={()=>void act(row,"retry")}>{t("aiTasks.retrySend")}</Button>}
          {(failed(row)||human(row))&&!row.message?.deliveryUncertain&&<Button size="xs" disabled={!!busy||settings.aiAutoReplyPaused} onClick={()=>void act(row,"regenerate")}>{t(human(row)?"outreachPreview.refresh":"aiOutreach.retry")}</Button>}
          <Button size="xs" disabled={!!busy} onClick={()=>void act(row,"disable")}>{t("aiTasks.disablePerson")}</Button>
          <Button size="xs" disabled={!!busy} title={t("aiTasks.replyRecordsHint")} onClick={()=>void act(row,"delete")}>{t("common.delete")}</Button>
        </div>
      </article>;
    })}
    {rows.length>limit&&<Button size="xs" onClick={()=>setLimit(limit+30)}>{t("aiTasks.more")}</Button>}
  </section>;
}
