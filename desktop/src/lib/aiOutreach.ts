import { useAppStore, flushPersist } from "@/store/appStore";
import { isDataRestoreActive, getDataRestoreGeneration } from "@/store/restoreGuard";
import { generateSuggestions, hasRealAiKey } from "./aiSuggest";
import { hashAiReplyContext } from "./aiReplyContext";
import { outreachCandidate, inspectOutreachCandidate, outreachContextKey, currentOutreachContext, isOutreachOptOut, outreachFolderChatIds, unresolvedOutreachRecipients, type OutreachReason } from "./aiOutreachContext";
import { getAutoReplyOutputBlockReason } from "./aiSafety";
import { resolveSendTarget } from "./utils";
import type { AiOutreachRun } from "./aiOutreachRules";
import { normalizeOutreachRule, outreachGoal, isImmediateOutreach, outreachRunClock, nextOutreachWindow, isPendingOutreachRun, outreachRunExpired, OUTREACH_IMMEDIATE_WINDOW_MS } from "./aiOutreachRules";
import type { Message } from "@/types/crm";
import { retainMessageChats } from "@/store/messageMemory";
import { hydrateOutreachHistory } from "./aiOutreachHistory";
import { lastContactedAccounts, recipientKey } from "./scheduledPlans";
import { translateCurrent } from "@/i18n";
import { isAppLockActive } from "./appLockRuntime";

type RoundCheck={at?:number;day:string;blocked:ReadonlyMap<string,OutreachReason>};
type SchedulerStatus={at:number;phase:"idle"|"checking"|"history"|"generating"|"waiting"|"error";error:string;folderId?:string;checks:ReadonlyMap<string,RoundCheck>};
let scheduler:SchedulerStatus={at:0,phase:"idle",error:"",checks:new Map()};
const schedulerListeners=new Set<()=>void>();
export const getOutreachSchedulerStatus=()=>scheduler;
export function subscribeOutreachScheduler(listener:()=>void){
  schedulerListeners.add(listener);
  return ()=>{schedulerListeners.delete(listener);};
}
function publishScheduler(update:Partial<SchedulerStatus>){
  scheduler={...scheduler,...update};
  schedulerListeners.forEach(listener=>listener());
}
function outreachFolderPaused(folderId:string){
  const {settings}=useAppStore.getState();
  return settings.aiAutoReplyPaused||settings.aiOutreachPaused||settings.chatFolders.find(folder=>folder.id===folderId)?.aiOutreach?.paused===true;
}
let running=false;
let checkAgain=false;
let lastTick=0;
function finishOutreachCheck(){
  running=false;
  if(scheduler.phase!=="error")publishScheduler({at:Date.now(),phase:"waiting",folderId:undefined,error:""});
  if(checkAgain){
    checkAgain=false;
    void tickAiOutreach(Date.now(),true).catch(error=>console.error("[ai-outreach] scheduler failed",error));
  }
}
let controller: AbortController|undefined;
const approvals=new Set<string>();
export function stopAiOutreach(){controller?.abort();retainMessageChats("ai-outreach",[]);}
const sentStatuses=["sent","server","delivered","read","played"];
const OUTREACH_ARCHIVE_AGE_MS = 7 * 24 * 3600_000;
export const outreachFolderDismissal=(id:string)=>`outreach-folder:${id}`;
export async function cancelOutreachRounds(folderIds:readonly string[]){
  const state=useAppStore.getState();
  const selected=new Set(folderIds),now=Date.now();
  if(!selected.size)return;
  const messages=new Map(state.messages.map(message=>[message.id,message]));
  const stopMessages:Message[]=[];
  let abort=false;
  const runs=state.settings.aiOutreachRuns.map(run=>{
    if(!selected.has(run.folderId)||!["waiting","generating","draft","queued"].includes(run.status))return run;
    const message=run.messageId?messages.get(run.messageId):undefined;
    if(message&&sentStatuses.includes(message.deliveryStatus||""))return {...run,status:"sent" as const,at:message.sentAt};
    if(message&&!message.deliveryUncertain&&["queued","failed"].includes(message.deliveryStatus||""))stopMessages.push(message);
    if(run.status==="generating"&&scheduler.folderId===run.folderId)abort=true;
    return {...run,status:"cancelled" as const,error:translateCurrent("aiOutreach.stopped")};
  });
  state.updateSettings({
    chatFolders:state.settings.chatFolders.map(folder=>{
      const rule=folder.aiOutreach;
      if(!selected.has(folder.id)||!rule?.enabled)return folder;
      if(rule.startMode==="immediate")return {...folder,aiOutreach:{...rule,enabled:false,paused:false}};
      const window=nextOutreachWindow(rule,now,true);
      const next=window===null?rule.scheduleStartAt&&rule.scheduleStartAt>now?rule.scheduleStartAt:null:Math.max(window,rule.scheduleStartAt||0);
      return {...folder,aiOutreach:next===null?{...rule,paused:true}:{...rule,scheduleStartAt:next}};
    }),
    aiOutreachRuns:runs,
    aiTaskDismissedIds:[...new Set([...state.settings.aiTaskDismissedIds,...folderIds.map(outreachFolderDismissal)])],
  });
  for(const message of stopMessages)state.updateMessageDelivery(message.id,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:translateCurrent("aiOutreach.stopped")});
  if(abort)controller?.abort();
  await flushPersist(useAppStore.getState);
}
export async function stopOutreachTask(id:string,hide=false){
  const state=useAppStore.getState(),run=state.settings.aiOutreachRuns.find(item=>item.id===id);
  if(!run)return;
  const message=run.messageId?state.messages.find(item=>item.id===run.messageId):undefined;
  const delivered=message&&["sent","server","delivered","read","played"].includes(message.deliveryStatus||"");
  const pending=!delivered&&["waiting","generating","draft","queued"].includes(run.status);
  state.updateSettings({aiOutreachRuns:state.settings.aiOutreachRuns.map(item=>item.id!==id?item:delivered?{...item,status:"sent"}:pending?{...item,status:"cancelled",error:translateCurrent("aiOutreach.stopped")}:item),
    ...(hide?{aiTaskDismissedIds:[...new Set([...(state.settings.aiTaskDismissedIds||[]),`outreach:${id}`])]}:{})});
  if(pending&&message&&!message.deliveryUncertain&&["queued","failed"].includes(message.deliveryStatus||""))state.updateMessageDelivery(message.id,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:translateCurrent("aiOutreach.stopped")});
  if(run.status==="generating")controller?.abort();
  await flushPersist(useAppStore.getState);
}
async function saveRun(run:AiOutreachRun) {
  const state=useAppStore.getState(),runs=state.settings.aiOutreachRuns||[];
  state.updateSettings({aiOutreachRuns:runs.some(item=>item.id===run.id)?runs.map(item=>item.id===run.id?run:item):[...runs,run]});
  retainMessageChats("ai-outreach",useAppStore.getState().settings.aiOutreachRuns.filter(item=>["generating","draft","queued"].includes(item.status)).map(item=>item.chatId));
  await flushPersist(useAppStore.getState);
}
export function noteOutreachOptOut(messages:Message[]) {
  const state=useAppStore.getState(),folders=state.settings.chatFolders;
  const ids=messages.filter(item=>!item.isGroup&&folders.some(folder=>folder.aiOutreach?.enabled&&outreachFolderChatIds(state,folder.id).includes(item.chatId))&&isOutreachOptOut(item.transcript||item.body)).map(item=>item.chatId);
  if (!ids.length) return;
  state.updateSettings({aiAutoReplyManualChatIds:[...new Set([...(state.settings.aiAutoReplyManualChatIds||[]),...ids])]});
}
export async function queueOutreachDraft(id:string,approved=true) {
  const epoch=getDataRestoreGeneration();
  const initial=useAppStore.getState();
  if(isDataRestoreActive()||!initial.hydrated||!initial.uiReady)return false;
  if(approvals.has(id))return false;
  approvals.add(id);
  try {
    let state=useAppStore.getState();
    const run=state.settings.aiOutreachRuns.find(item=>item.id===id);
    if (!run||run.status!=="draft"||!run.text) return false;
    const rule=state.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach;
    if (outreachRunExpired(run,rule)) {
      await saveRun({...run,status:"expired",error:translateCurrent("outreachReason.expired")});
      return false;
    }
    if(state.settings.aiAutoReplyPaused||state.settings.aiOutreachPaused||rule?.paused||run.recipient&&state.settings.aiOutreachExcludedRecipients?.includes(recipientKey("",run.recipient)))return false;
    if (!approved && (!run.autoEvidence || !run.decisionDetails?.evidence || !run.decisionDetails.reason ||
        state.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach?.mode!=="auto")) return false;
    const key=outreachContextKey(state,run.folderId,run.chatId,run.id);
    const hash=key?await hashAiReplyContext(key):undefined;
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    if(useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="draft"||outreachFolderPaused(run.folderId))return false;
    state=useAppStore.getState();
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    if (outreachRunExpired(run,state.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach)) {
      await saveRun({...run,status:"expired",error:translateCurrent("outreachReason.expired")});
      return false;
    }
    if (!key||hash!==run.contextHash) {await saveRun({...run,status:"cancelled",error:"上下文或规则已变化，请重新生成"});return false;}
    if (outreachContextKey(state,run.folderId,run.chatId,run.id)!==key||state.settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="draft") return false;
    const candidate=outreachCandidate(state,run.folderId,run.chatId,Date.now(),run.id);
    if (!candidate) return false;
    const recipient=resolveSendTarget({phone:candidate.contact.phone,channelAddress:candidate.contact.channelAddress,entityId:candidate.contact.id});
    if (!recipient) {await saveRun({...run,status:"failed",error:"联系人号码不可用"});return false;}
    const draft=state.draftReply;
    const messageId=state.enqueueOutgoingMessage({chatId:run.chatId,contactId:candidate.contact.id,body:run.text,accountId:run.accountId,
      channelId:"baileys",deviceId:run.accountId,phoneE164:recipient,systemKind:"ai_proactive",aiReplyContextHash:run.contextHash,
      deliveryStatus:"pending"});
    if (useAppStore.getState().draftReply!==draft) useAppStore.getState().setDraftReply(draft);
    if (!messageId) return false;
    try {
      await saveRun({...run,status:"queued",messageId,approved});
      const fresh=useAppStore.getState();
      if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
      const status=fresh.settings.aiOutreachRuns.find(item=>item.id===id)?.status;
      if(fresh.messages.find(item=>item.id===messageId)?.deliveryStatus!=="pending")return false;
      if(status==="queued"&&outreachRunExpired(run,fresh.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach)) {
        const error=translateCurrent("outreachReason.expired");
        fresh.updateMessageDelivery(messageId,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:error});
        await saveRun({...run,status:"expired",messageId,approved,error});
        return false;
      }
      if(status!=="queued"){
        if(status==="cancelled")fresh.updateMessageDelivery(messageId,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:translateCurrent("aiOutreach.stopped")});
        return false;
      }
      useAppStore.getState().updateMessageDelivery(messageId,{deliveryStatus:"queued",nextAttemptAt:new Date(Date.now()).toISOString()});
      await flushPersist(useAppStore.getState);
    }
    catch(error){if(getDataRestoreGeneration()===epoch&&!isDataRestoreActive())useAppStore.getState().updateMessageDelivery(messageId,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:"主动联系任务保存失败"});throw error;}
    return true;
  } finally {approvals.delete(id);}
}
export async function tickAiOutreach(now=Date.now(),force=false) {
  const epoch=getDataRestoreGeneration();
  const initial=useAppStore.getState();
  if (isAppLockActive()||isDataRestoreActive()||!initial.hydrated||!initial.uiReady||!force&&now-lastTick<30_000) return;
  if(running){if(force)checkAgain=true;return;}
  lastTick=now;running=true;
  publishScheduler({at:now,phase:"checking",folderId:undefined,error:""});
  try {
    const rules=new Map(initial.settings.chatFolders.map(folder=>[folder.id,folder.aiOutreach]));
    const messages=new Map(initial.messages.map(message=>[message.id,message]));
    const expiredMessages:Message[]=[];
    const expiryError=translateCurrent("outreachReason.expired");
    const previousRuns=initial.settings.aiOutreachRuns||[];
    const reconciled=previousRuns.map((run):AiOutreachRun=>{
      if(run.archived)return run;
      const message=run.messageId?messages.get(run.messageId):undefined;
      if(["queued","cancelled","expired","failed"].includes(run.status)&&message&&sentStatuses.includes(message.deliveryStatus||"")) {
        return {...run,status:"sent",at:message.sentAt,error:undefined};
      }
      if(isPendingOutreachRun(run)) {
        const rule=rules.get(run.folderId);
        if(outreachRunExpired(run,rule,now)||run.status==="draft"&&!rule) {
          if(message?.deliveryStatus==="pending")return run;
          if(message&&!message.deliveryUncertain&&(message.deliveryStatus==="queued"||message.nextAttemptAt))expiredMessages.push(message);
          return {...run,status:"expired",error:message?.deliveryUncertain?message.lastError||expiryError:expiryError};
        }
        if(run.status==="generating")return {...run,status:"failed",error:"生成被中断，未自动重试以避免重复花费"};
        if(run.status==="queued"&&(!message||message.deliveryStatus==="failed"&&!message.nextAttemptAt)) {
          return {...run,status:"failed",error:message?.lastError||"出站记录不可用"};
        }
        return run;
      }
      return !message?.deliveryUncertain&&message?.deliveryStatus!=="pending"&&Date.parse(run.at)<now-OUTREACH_ARCHIVE_AGE_MS
        ? {...run,archived:true} : run;
    });
    if(reconciled.some((run,index)=>run!==previousRuns[index])) {
      initial.updateSettings({aiOutreachRuns:reconciled});
      for(const message of expiredMessages)initial.updateMessageDelivery(message.id,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:expiryError});
      retainMessageChats("ai-outreach",reconciled.filter(run=>["generating","draft","queued"].includes(run.status)).map(run=>run.chatId));
      await flushPersist(useAppStore.getState);
    }
    const state=useAppStore.getState();
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return;
    const blocked=state.settings.aiAutoReplyPaused||state.settings.aiOutreachPaused||state.settings.sendChannel!=="baileys"||!hasRealAiKey(state.settings)&&!state.settings.aiOutreachMuseAccountId;
    const folders=state.settings.chatFolders.filter(folder=>folder.aiOutreach?.enabled&&(isImmediateOutreach(folder.aiOutreach,now)||!blocked&&!folder.aiOutreach.paused));
    const checks=new Map([...scheduler.checks].filter(([id,report])=>state.settings.chatFolders.some(folder=>folder.id===id&&folder.aiOutreach?.runNowAt===report.at)));
    const lastRunByFolder=new Map<string,number>();
    for(const run of state.settings.aiOutreachRuns||[])lastRunByFolder.set(run.folderId,Math.max(lastRunByFolder.get(run.folderId)||0,Date.parse(run.at)||0));
    folders.sort((a,b)=>(lastRunByFolder.get(a.id)||0)-(lastRunByFolder.get(b.id)||0));
    const chats=new Map(state.chats.map(chat=>[chat.id,chat])),contacts=new Map(state.contacts.map(contact=>[contact.id,contact]));
    const lastAccounts=folders.some(folder=>folder.scope?.type==="all")?lastContactedAccounts(state.chats,state.contacts,state.messages):undefined;
    const unresolvedRecipients=unresolvedOutreachRecipients(state);
    let planningState=state;
    const planned:AiOutreachRun[]=[];
    for (const folder of folders) {
      if (!folder.aiOutreach?.enabled) continue;
      const rule=normalizeOutreachRule(folder.aiOutreach),clock=outreachRunClock(rule,now);
      if((rule.startMode==="immediate"&&!isImmediateOutreach(rule,now))||(rule.startMode==="scheduled"&&rule.scheduleStartAt!==undefined&&now<rule.scheduleStartAt))continue;
      const roundAt=isImmediateOutreach(rule,now)?rule.runNowAt:undefined;
      if(roundAt===undefined&&(blocked||folder.aiOutreach.paused||clock.time<rule.time))continue;
      const members=new Set(outreachFolderChatIds(planningState,folder.id));
      const currentRoundRuns=new Map(planningState.settings.aiOutreachRuns.filter(run=>run.folderId===folder.id&&run.roundAt===roundAt&&run.day===clock.day).map(run=>[run.chatId,run]));
      const reasons=new Map<string,OutreachReason>();
      for (const chatId of members) {
        const existing=currentRoundRuns.get(chatId);
        if(existing&&existing.status!=="waiting")continue;
        const chat=chats.get(chatId),contact=chat&&contacts.get(chat.contactId);
        const check=inspectOutreachCandidate(planningState,folder.id,chatId,now,existing?.id,undefined,chat&&contact?{chat,contact,members,rule,clock,lastAccounts,unresolvedRecipients}:undefined);
        if(!check.candidate){
          reasons.set(chatId,check.reason);
          continue;
        }
        if(existing)continue;
        const {candidate}=check;
        const run:AiOutreachRun={id:crypto.randomUUID(),folderId:folder.id,chatId,accountId:candidate.accountId,recipient:candidate.recipient,day:candidate.day,basisAt:candidate.basisAt,at:new Date(now).toISOString(),status:"waiting",roundAt,expiresAt:roundAt===undefined?undefined:roundAt+OUTREACH_IMMEDIATE_WINDOW_MS};
        planned.push(run);
        planningState={...planningState,settings:{...planningState.settings,aiOutreachRuns:[...planningState.settings.aiOutreachRuns,run]}};
      }
      checks.set(folder.id,{at:roundAt,day:clock.day,blocked:reasons});
    }
    if(planned.length){
      useAppStore.getState().updateSettings({aiOutreachRuns:planningState.settings.aiOutreachRuns});
      await flushPersist(useAppStore.getState);
    }
    publishScheduler({checks});
    if(blocked)return;
    for(const run of useAppStore.getState().settings.aiOutreachRuns){
      if(run.status!=="draft")continue;
      const fresh=useAppStore.getState();
      const rule=fresh.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach;
      if(rule?.mode==="auto"&&outreachCandidate(fresh,run.folderId,run.chatId,Date.now(),run.id))await queueOutreachDraft(run.id,false);
    }
    let generated=0;
    for(const run of useAppStore.getState().settings.aiOutreachRuns.filter(item=>item.status==="waiting")){
      if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return;
      if(useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===run.id)?.status!=="waiting")continue;
      const check=inspectOutreachCandidate(useAppStore.getState(),run.folderId,run.chatId,Date.now(),run.id);
      if(!check.candidate){
        if(check.reason==="expired")await saveRun({...run,status:"expired",error:expiryError});
        else if(["changed_context","not_member","disabled","invalid_contact","invalid_recipient","optout","person_excluded","manual_optout","already_contacted","unanswered"].includes(check.reason))await saveRun({...run,status:"cancelled",error:translateCurrent(`outreachReason.${check.reason}`)});
        continue;
      }
      await generateOutreach(run.folderId,run.chatId,run.id);
      generated += 1;
      if (generated >= 2) break; // Keep Muse serial, but do not leave the whole batch waiting for another tick.
    }
  } catch(error) {
    publishScheduler({at:Date.now(),phase:"error",error:String(error).slice(0,500)});
    throw error;
  } finally {
    finishOutreachCheck();
  }
}

async function generateOutreach(folderId:string,chatId:string,id:string) {
  const epoch=getDataRestoreGeneration();
  const routingState=useAppStore.getState();
  if(routingState.settings.aiTaskDismissedIds?.includes(`outreach:${id}`))return false;
  const initialStatus=routingState.settings.aiOutreachRuns.find(run=>run.id===id)?.status;
  const routed=outreachCandidate(routingState,folderId,chatId,Date.now(),id);
  if(!routed)return false;
  publishScheduler({at:Date.now(),phase:"history",folderId,error:""});
  await hydrateOutreachHistory(chatId);
  if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
  const now=Date.now();
  const state=useAppStore.getState(),candidate=outreachCandidate(state,folderId,chatId,now,id);
  if(state.settings.aiTaskDismissedIds?.includes(`outreach:${id}`))return false;
  if(initialStatus!==state.settings.aiOutreachRuns.find(run=>run.id===id)?.status)return false;
  if(outreachFolderPaused(folderId))return false;
  const key=candidate&&outreachContextKey(state,folderId,chatId,id,now);
  if(!candidate||!key){
    const waiting=state.settings.aiOutreachRuns.find(run=>run.id===id&&run.status==="waiting");
    if(waiting){
      const {reason}=inspectOutreachCandidate(state,folderId,chatId,now,id);
      await saveRun({...waiting,status:reason==="expired"?"expired":"cancelled",error:translateCurrent(`outreachReason.${reason==="ready"?"changed_context":reason}`)});
    }
    return false;
  }
  const existing=state.settings.aiOutreachRuns.find(run=>run.id===id);
  let run:AiOutreachRun={id,folderId,chatId,accountId:candidate.accountId,recipient:candidate.recipient,day:candidate.day,basisAt:candidate.basisAt,at:new Date(now).toISOString(),status:"generating",roundAt:existing?.roundAt,expiresAt:existing?.expiresAt};
  const expireIfNeeded=async()=>{
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return true;
    const {settings}=useAppStore.getState();
    if(settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||
        !outreachRunExpired(run,settings.chatFolders.find(folder=>folder.id===folderId)?.aiOutreach))return false;
    await saveRun({...run,status:"expired",error:translateCurrent("outreachReason.expired")});
    return true;
  };
  const parkIfPaused=async()=>{
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return true;
    if(!outreachFolderPaused(folderId)||useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating")return false;
    await saveRun({...run,status:"waiting"});
    return true;
  };
  await saveRun(run);
  if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
  if(await expireIfNeeded()||await parkIfPaused())return false;
  if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch||useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||outreachContextKey(useAppStore.getState(),folderId,chatId,id)!==key)return false;
  publishScheduler({at:Date.now(),phase:"generating",folderId,error:""});
  controller=new AbortController();
  try {
    const currentSettings=useAppStore.getState().settings;
    const useDecision=currentSettings.aiProvider==="muse"||!!currentSettings.aiOutreachMuseAccountId;
    const result=await generateSuggestions(candidate.contact,candidate.thread,currentSettings,
      {auto:true,accountId:candidate.accountId,chatId,outreach:outreachGoal(candidate.rule),outreachDecision:useDecision,allowSidebarData:candidate.rule.allowSidebarData===true,signal:controller.signal,
        beforeSubmit:()=>{
          const fresh=useAppStore.getState();
          if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch||fresh.settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||outreachContextKey(fresh,folderId,chatId,id)!==key) {
            throw Error("主动联系的执行窗口或上下文已变化");
          }
        }});
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch||useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating")return false;
    run={...run,decisionDetails:result.decisionDetails};
    if (result.submissionUncertain) {
      await saveRun({...run,status:"failed",error:result.error});
      return false;
    }
    if (await expireIfNeeded()) return false;
    if (await parkIfPaused()) return false;
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    const fresh=useAppStore.getState();
    if(controller.signal.aborted||fresh.settings.aiTaskDismissedIds?.includes(`outreach:${id}`)||fresh.settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating")return false;
    if(outreachContextKey(fresh,folderId,chatId,id)!==key){
      await saveRun({...run,status:"cancelled",error:"生成期间上下文或规则发生变化"});
      return false;
    }
    if(result.outreachDecision?.action==="skip"){
      await saveRun({...run,status:"skipped",skipReason:result.outreachDecision.reason});
      return true;
    }
    const text=result.suggestions[0]?.text?.trim();
    const block=text&&getAutoReplyOutputBlockReason(text);
    if(result.fallback||result.source==="mock"||!text||block||useDecision&&!result.outreachDecision){await saveRun({...run,status:"failed",error:result.error||block||"AI 没有返回有效内容"});return false;}
    const hash=await hashAiReplyContext(key);
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    if(await expireIfNeeded()||await parkIfPaused())return false;
    if(useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||outreachContextKey(useAppStore.getState(),folderId,chatId,id)!==key)return false;
    const autoEvidence = result.outreachDecision?.action === "send" && !!result.decisionDetails?.evidence;
    const decisionDetails = {...result.decisionDetails,
      reason:result.decisionDetails?.reason || "缺少可核对的联系依据，需要人工确认"};
    run={...run,status:"draft",text,contextHash:hash,autoEvidence,decisionDetails};
    await saveRun(run);
    if(candidate.rule.mode==="auto" && autoEvidence)await queueOutreachDraft(id,false);
    return true;
  } catch(error){
    if(!isDataRestoreActive()&&getDataRestoreGeneration()===epoch){
      if(await parkIfPaused())return false;
      const latest=useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id);
      if(latest?.status==="generating")await saveRun({...run,...latest,status:"failed",error:String(error)});
    }
    return false;
  }
  finally{controller=undefined;}
}
export async function retryAiOutreach(id:string){
  const state=useAppStore.getState(),run=state.settings.aiOutreachRuns.find(item=>item.id===id);
  if(state.settings.aiTaskDismissedIds?.includes(`outreach:${id}`))return false;
  if(running||isDataRestoreActive()||!state.hydrated||!state.uiReady||!run||run.archived||outreachRunExpired(run,state.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach)||!["failed","cancelled","draft"].includes(run.status))return false;
  if(run.messageId){
    const message=state.messages.find(item=>item.id===run.messageId);
    if(!message||message.deliveryStatus!=="failed"||message.deliveryUncertain)return false;
    const queued={...run,status:"queued" as const},epoch=getDataRestoreGeneration();
    const projected={...state,settings:{...state.settings,aiOutreachRuns:state.settings.aiOutreachRuns.map(item=>item.id===id?queued:item)}};
    const key=currentOutreachContext(projected,message);
    if(!key)return false;
    running=true;
    try{
      if(await hashAiReplyContext(key)!==run.contextHash||isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
      const fresh=useAppStore.getState();
      if(fresh.settings.aiOutreachRuns.find(item=>item.id===id)?.status!==run.status)return false;
      await saveRun(queued);
      if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch||currentOutreachContext(useAppStore.getState(),message)!==key)return false;
      useAppStore.getState().updateMessageDelivery(message.id,{deliveryStatus:"queued",retryCount:0,nextAttemptAt:new Date().toISOString(),lastError:undefined});
      await flushPersist(useAppStore.getState);
      return true;
    }finally{finishOutreachCheck();}
  }
  running=true;try{return await generateOutreach(run.folderId,run.chatId,id);}finally{finishOutreachCheck();}
}
