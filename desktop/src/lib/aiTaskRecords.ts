import type { AutoReplyRuntime } from "./autoReplyRuntime";
import type { Message } from "@/types/crm";

export type AiReplyTaskRecord=Omit<AutoReplyRuntime,"phase">&{id:string;chatId:string;phase:AutoReplyRuntime["phase"]|"ended";at:string;messageId?:string};
export function normalizeAiReplyTaskRecords(raw:unknown):AiReplyTaskRecord[]{
  const records=new Map<string,AiReplyTaskRecord>();
  for(const row of (Array.isArray(raw)?raw:[]).slice(-10000)){
    if(!row||!["waiting","transcribing","generating","retry","human","ended"].includes(row.phase)||
      !["chatId","inboundId","at"].every(key=>typeof row[key]==="string"&&row[key].length>0&&row[key].length<=200)||!Number.isFinite(Date.parse(row.at)))continue;
    const id=`runtime:${row.chatId}:${row.inboundId}`;
    records.set(id,{id,chatId:row.chatId,inboundId:row.inboundId,phase:row.phase,at:row.at,
      accountId:typeof row.accountId==="string"?row.accountId.slice(0,200):undefined,
      reason:typeof row.reason==="string"?row.reason.slice(0,500):undefined,
      retryAt:typeof row.retryAt==="number"&&Number.isFinite(row.retryAt)?row.retryAt:undefined,
      messageId:typeof row.messageId==="string"?row.messageId.slice(0,200):undefined});
  }
  return [...records.values()];
}
export function updateAiReplyTaskRecords(records:AiReplyTaskRecord[],current:Record<string,AutoReplyRuntime>,previous:Record<string,AutoReplyRuntime>,messages:readonly Message[]):AiReplyTaskRecord[]{
  if(current===previous)return records;
  const byId=new Map(records.map(record=>[record.id,record]));
  for(const chatId of new Set([...Object.keys(current),...Object.keys(previous)])){
    if(current[chatId]===previous[chatId])continue;
    const task=current[chatId]||previous[chatId];
    if(!task)continue;
    // Replacing a task ends its older entry without resuming it after restart.
    if(previous[chatId]&&current[chatId]?.inboundId!==previous[chatId].inboundId){
      const old=previous[chatId],id=`runtime:${chatId}:${old.inboundId}`;
      const reply=messages.find(message=>message.chatId===chatId&&message.systemKind==="ai_auto_reply"&&message.aiReplyInboundId===old.inboundId);
      byId.set(id,{...old,id,chatId,phase:"ended",reason:undefined,retryAt:undefined,at:new Date().toISOString(),messageId:reply?.id});
    }
    if(current[chatId]){const id=`runtime:${chatId}:${task.inboundId}`;byId.set(id,{...task,id,chatId,at:new Date().toISOString()});}
  }
  return [...byId.values()].sort((a,b)=>a.at.localeCompare(b.at)).slice(-10000);
}
