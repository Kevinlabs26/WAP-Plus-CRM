import type { OutreachState, OutreachReason } from "./aiOutreachContext";
import { inspectOutreachCandidate } from "./aiOutreachContext";
import { normalizeOutreachRule, nextOutreachWindow, outreachClock, outreachRunClock, outreachWindowOffset, type AiOutreachRun } from "./aiOutreachRules";
import { lastContactedAccounts, recipientKey } from "./scheduledPlans";
import { resolveSendTarget } from "./utils";
import { isWithinAutoReplyHours, resolveAutoReplyPolicy } from "./aiSafety";

export type OutreachPreviewRow={folderId:string;folderName:string;chatId:string;name:string;accountId:string;recipient:string;timeZone:string;mode:"auto"|"draft";dailyLimit:number;scheduledAt:number|null;reason:OutreachReason;eligible:boolean;historyPending:boolean};
export type OutreachPreview={checkedAt:number;rows:OutreachPreviewRow[];eligible:number;readyNow:number;blocked:number;quotaWaiting:number;nextAt:number|null};

/** Read-only snapshot. Yields between batches and never loads history, generates text or enqueues messages. */
export async function buildOutreachPreview(state:OutreachState,folderIds:readonly string[],now=Date.now(),options:{assumeRunning?:boolean;signal?:AbortSignal;onProgress?:(checked:number)=>void}={}):Promise<OutreachPreview>{
  options.signal?.throwIfAborted();
  const settings=options.assumeRunning?{...state.settings,aiOutreachPaused:false}:state.settings;
  const snapshot={...state,settings},wanted=new Set(folderIds);
  const chats=new Map(state.chats.map(chat=>[chat.id,chat])),contacts=new Map(state.contacts.map(contact=>[contact.id,contact]));
  const latest=lastContactedAccounts(state.chats,state.contacts,state.messages);
  const byRecipient=new Map<string,AiOutreachRun[]>(),byChat=new Map<string,AiOutreachRun[]>(),daily=new Map<string,number>(),lastRun=new Map<string,number>();
  for(const run of settings.aiOutreachRuns){
    const key=run.recipient?recipientKey("",run.recipient):"";
    if(key){const list=byRecipient.get(key)||[];list.push(run);byRecipient.set(key,list);}
    const chatRuns=byChat.get(run.chatId)||[];chatRuns.push(run);byChat.set(run.chatId,chatRuns);
    const dayKey=`${run.folderId}:${run.day}`;daily.set(dayKey,(daily.get(dayKey)||0)+1);
    lastRun.set(run.folderId,Math.max(lastRun.get(run.folderId)||0,Date.parse(run.at)||0));
  }
  const rows:OutreachPreviewRow[]=[],reserved=new Map<string,number>(),recipients=new Set<string>(),windowCache=new Map<string,number|null>();
  const next=(rule:ReturnType<typeof normalizeOutreachRule>,at:number,skip=false)=>{const key=`${rule.timeZone}:${rule.time}:${Math.floor(at/60_000)}:${skip}`;if(!windowCache.has(key))windowCache.set(key,nextOutreachWindow(rule,at,skip));return windowCache.get(key)!;};
  const folders=settings.chatFolders.filter(folder=>wanted.has(folder.id)).slice().sort((a,b)=>(lastRun.get(a.id)||0)-(lastRun.get(b.id)||0));
  let readyNow=0;
  for(const folder of folders){
    const rule=normalizeOutreachRule(folder.aiOutreach),members=new Set(folder.chatIds);
    for(const chatId of members){
      options.signal?.throwIfAborted();
      if(rows.length&&rows.length%25===0){options.onProgress?.(rows.length);await new Promise<void>(resolve=>setTimeout(resolve,0));options.signal?.throwIfAborted();}
      const chat=chats.get(chatId),contact=chat&&contacts.get(chat.contactId);
      const recipient=contact?resolveSendTarget({phone:contact.phone,channelAddress:contact.channelAddress,entityId:contact.id}):"";
      const accountId=chat?.accountId||contact?.accountId||settings.liveBaileysAccountId||settings.activeAccountId;
      const person=recipient?recipientKey("",recipient):"",recipientRuns=[...new Set([...(byRecipient.get(person)||[]),...(byChat.get(chatId)||[])])];
      const check=(at:number)=>inspectOutreachCandidate(snapshot,folder.id,chatId,at,undefined,undefined,chat&&contact?{chat,contact,members,rule,clock:outreachClock(rule.timeZone,at),lastAccounts:latest,recipientRuns,dayRunCount:daily.get(`${folder.id}:${outreachRunClock(rule,at).day}`)||0}:undefined);
      const current=check(now);
      let scheduledAt=next(rule,now),projected=current;
      if(scheduledAt!==null&&["ready","not_time","missed_window","outside_hours","same_day","idle","daily_limit","takeover"].includes(current.reason)){
        const policy=resolveAutoReplyPolicy(settings.aiAutoReplyPolicy,settings.aiAutoReplyPolicyByAccountId,accountId);
        // Account reply hours are also a runtime gate; estimate their first overlap with the folder window.
        const fitHours=(start:number)=>{
          let at=start;while(at<start+120*60_000&&!isWithinAutoReplyHours(policy,new Date(at)))at+=60_000;
          return outreachWindowOffset(rule,at)<120&&isWithinAutoReplyHours(policy,new Date(at))?at:start;
        };
        scheduledAt=fitHours(scheduledAt);
        projected=check(scheduledAt);
        for(let attempt=0;attempt<4&&chat&&(projected.reason==="same_day"||projected.reason==="idle"||projected.reason==="daily_limit"||projected.reason==="takeover");attempt++){
          const after=projected.reason==="idle"?Math.max(now,Date.parse(chat.updatedAt)+rule.minIdleHours*3600_000):projected.reason==="takeover"?Math.max(now,...(state.messagesByChatId[chatId]||[]).filter(message=>message.direction==="out"&&!message.systemKind).map(message=>Date.parse(message.sentAt)+policy.takeoverMinutes*60_000)):now;
          scheduledAt=next(rule,after,projected.reason==="same_day"||projected.reason==="daily_limit");
          if(scheduledAt===null)break;
          scheduledAt=fitHours(scheduledAt);projected=check(scheduledAt);
        }
      }
      let reason=projected.reason==="ready"?current.reason:projected.reason,eligible=projected.reason==="ready";
      if(eligible&&person&&recipients.has(person)){eligible=false;reason="duplicate";}
      const slot=scheduledAt!==null?`${folder.id}:${outreachRunClock(rule,scheduledAt).day}`:"";
      if(eligible&&(reserved.get(slot)||0)>=(rule.dailyLimit-(daily.get(slot)||0))){eligible=false;reason="daily_limit";}
      if(eligible){if(person)recipients.add(person);reserved.set(slot,(reserved.get(slot)||0)+1);if(current.reason==="ready")readyNow++;}
      rows.push({folderId:folder.id,folderName:folder.name,chatId,name:contact?.name||chat?.contactName||recipient||chatId,accountId:accountId||"",recipient,timeZone:rule.timeZone,mode:rule.mode,dailyLimit:rule.dailyLimit,scheduledAt,reason,eligible,historyPending:!!chat?.hasMessageHistory&&!(state.messagesByChatId[chatId]?.length)});
    }
  }
  const eligible=rows.filter(row=>row.eligible),nextAt=eligible.reduce<number|null>((best,row)=>row.scheduledAt!==null&&(best===null||row.scheduledAt<best)?row.scheduledAt:best,null);
  return {checkedAt:now,rows,eligible:eligible.length,readyNow,blocked:rows.length-eligible.length,quotaWaiting:rows.filter(row=>row.reason==="daily_limit").length,nextAt};
}
