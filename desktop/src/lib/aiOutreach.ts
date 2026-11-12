import { useAppStore, flushPersist } from "@/store/appStore";
import { isDataRestoreActive, getDataRestoreGeneration } from "@/store/restoreGuard";
import { generateSuggestions, hasRealAiKey } from "./aiSuggest";
import { hashAiReplyContext } from "./aiReplyContext";
import { outreachCandidate, inspectOutreachCandidate, outreachContextKey, currentOutreachContext, isOutreachOptOut } from "./aiOutreachContext";
import { getAutoReplyOutputBlockReason } from "./aiSafety";
import { resolveSendTarget } from "./utils";
import type { AiOutreachRun } from "./aiOutreachRules";
import { normalizeOutreachRule, outreachGoal, isImmediateOutreach, outreachRunClock, outreachWindowOffset } from "./aiOutreachRules";
import type { Message } from "@/types/crm";
import { retainMessageChats } from "@/store/messageMemory";
import { hydrateOutreachHistory } from "./aiOutreachHistory";
import { lastContactedAccounts, recipientKey } from "./scheduledPlans";
import { translateCurrent } from "@/i18n";
import { isAppLockActive } from "./appLockRuntime";

let scheduler:{at:number;phase:"idle"|"checking"|"history"|"generating"|"waiting"|"error";error:string}={at:0,phase:"idle",error:""};
export const getOutreachSchedulerStatus=()=>scheduler;
let running=false;
let lastTick=0;
let controller: AbortController|undefined;
const approvals=new Set<string>();
export function stopAiOutreach(){controller?.abort();retainMessageChats("ai-outreach",[]);}
export async function stopOutreachTask(id:string,hide=false){
  const state=useAppStore.getState(),run=state.settings.aiOutreachRuns.find(item=>item.id===id);
  if(!run)return;
  const message=run.messageId?state.messages.find(item=>item.id===run.messageId):undefined;
  const delivered=message&&["sent","server","delivered","read","played"].includes(message.deliveryStatus||"");
  const pending=!delivered&&["waiting","generating","draft","queued"].includes(run.status);
  state.updateSettings({aiOutreachRuns:state.settings.aiOutreachRuns.map(item=>item.id!==id?item:delivered?{...item,status:"sent"}:pending?{...item,status:"cancelled",error:translateCurrent("aiOutreach.stopped")}:item),
    ...(hide?{aiTaskDismissedIds:[...new Set([...(state.settings.aiTaskDismissedIds||[]),`outreach:${id}`])]}:{})});
  if(pending&&message&&!message.deliveryUncertain&&["pending","queued","failed"].includes(message.deliveryStatus||""))state.updateMessageDelivery(message.id,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:translateCurrent("aiOutreach.stopped")});
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
  const folders=useAppStore.getState().settings.chatFolders;
  const ids=messages.filter(item=>!item.isGroup&&folders.some(folder=>folder.aiOutreach?.enabled&&folder.chatIds.includes(item.chatId))&&isOutreachOptOut(item.transcript||item.body)).map(item=>item.chatId);
  if (!ids.length) return;
  const state=useAppStore.getState();
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
    if(state.settings.aiAutoReplyPaused||state.settings.aiOutreachPaused||run&&(state.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach?.paused||run.recipient&&state.settings.aiOutreachExcludedRecipients?.includes(recipientKey("",run.recipient))))return false;
    if (!run||run.status!=="draft"||!run.text||!approved&&state.settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach?.mode!=="auto") return false;
    const key=outreachContextKey(state,run.folderId,run.chatId,run.id);
    const hash=key?await hashAiReplyContext(key):undefined;
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    if (!key||hash!==run.contextHash) {await saveRun({...run,status:"cancelled",error:"上下文或规则已变化，请重新生成"});return false;}
    state=useAppStore.getState();
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
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
      if(fresh.settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="queued"||fresh.messages.find(item=>item.id===messageId)?.deliveryStatus!=="pending")return false;
      useAppStore.getState().updateMessageDelivery(messageId,{deliveryStatus:"queued",nextAttemptAt:new Date(Date.now()).toISOString()});
      await flushPersist(useAppStore.getState);
    }
    catch(error){if(getDataRestoreGeneration()===epoch&&!isDataRestoreActive())useAppStore.getState().updateMessageDelivery(messageId,{deliveryStatus:"failed",retryCount:5,nextAttemptAt:undefined,lastError:"主动联系任务保存失败"});throw error;}
    return true;
  } finally {approvals.delete(id);}
}
export async function tickAiOutreach(now=Date.now()) {
  const epoch=getDataRestoreGeneration();
  const initial=useAppStore.getState();
  if (running||isAppLockActive()||isDataRestoreActive()||!initial.hydrated||!initial.uiReady||now-lastTick<30_000) return;
  lastTick=now;running=true;scheduler={at:now,phase:"checking",error:""};
  try {
    for (const run of initial.settings.aiOutreachRuns||[]) {
      if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return;
      if(run.status==="draft"){
        const folder=initial.settings.chatFolders.find(folder=>folder.id===run.folderId),rule=folder?.aiOutreach&&normalizeOutreachRule(folder.aiOutreach);
        const clock=rule&&outreachRunClock(rule,now);
        if(!rule||clock!.day!==run.day||!isImmediateOutreach(rule,now)&&outreachWindowOffset(rule,now)>=120)await saveRun({...run,status:"cancelled",error:"草稿已过期，未自动发送"});
      }
      if (run.status==="generating") await saveRun({...run,status:"failed",error:"生成被中断，未自动重试以避免重复花费"});
      if (run.status==="queued") {
        const message=initial.messages.find(item=>item.id===run.messageId);
        if (message&&["sent","server","delivered","read","played"].includes(message.deliveryStatus||"")) await saveRun({...run,status:"sent",at:message.sentAt});
        else if (!message||message.deliveryStatus==="failed"&&!message.nextAttemptAt) await saveRun({...run,status:"failed",error:message?.lastError||"出站记录不可用"});
      }
    }
    const state=useAppStore.getState();
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return;
    // shortcut: Stop at 10k audit entries rather than evict deduplication history; archive before larger deployments.
    if (state.settings.aiAutoReplyPaused||state.settings.aiOutreachPaused||state.settings.sendChannel!=="baileys"||!hasRealAiKey(state.settings)) return;
    const folders=state.settings.chatFolders.filter(folder=>folder.aiOutreach?.enabled&&!folder.aiOutreach.paused);
    const lastRunByFolder=new Map<string,number>();
    for(const run of state.settings.aiOutreachRuns||[])lastRunByFolder.set(run.folderId,Math.max(lastRunByFolder.get(run.folderId)||0,Date.parse(run.at)||0));
    folders.sort((a,b)=>(lastRunByFolder.get(a.id)||0)-(lastRunByFolder.get(b.id)||0));
    const chats=new Map(state.chats.map(chat=>[chat.id,chat])),contacts=new Map(state.contacts.map(contact=>[contact.id,contact]));
    const lastAccounts=folders.some(folder=>folder.scope?.type==="all")?lastContactedAccounts(state.chats,state.contacts,state.messages):undefined;
    let planningState=state;
    const planned:AiOutreachRun[]=[];
    for (const folder of folders) {
      if (!folder.aiOutreach?.enabled) continue;
      const rule=normalizeOutreachRule(folder.aiOutreach),clock=outreachRunClock(rule,now);
      if(!isImmediateOutreach(rule,now)&&outreachWindowOffset(rule,now)>=120||(state.settings.aiOutreachRuns||[]).filter(run=>run.folderId===folder.id&&run.day===clock.day).length>=rule.dailyLimit)continue;
      const members=new Set(folder.chatIds);
      for (const chatId of folder.chatIds) {
        if(planningState.settings.aiOutreachRuns.length>=10_000)break;
        const chat=chats.get(chatId),contact=chat&&contacts.get(chat.contactId);
        if(!chat||!contact||rule.trigger==="new"&&(chat.hasMessageHistory||chat.lastMessage||chat.lastMessageDirection||contact.lastMessageAt)||
          rule.trigger==="daily"&&now-Date.parse(chat.updatedAt)<rule.minIdleHours*3600_000)continue;
        const candidate=outreachCandidate(planningState,folder.id,chatId,now,undefined,undefined,{chat,contact,members,clock,lastAccounts});
        if (!candidate) continue;
        const run:AiOutreachRun={id:crypto.randomUUID(),folderId:folder.id,chatId,accountId:candidate.accountId,recipient:candidate.recipient,day:candidate.day,basisAt:candidate.basisAt,at:new Date(now).toISOString(),status:"waiting"};
        planned.push(run);
        planningState={...planningState,settings:{...planningState.settings,aiOutreachRuns:[...planningState.settings.aiOutreachRuns,run]}};
      }
    }
    if(planned.length){
      useAppStore.getState().updateSettings({aiOutreachRuns:planningState.settings.aiOutreachRuns});
      await flushPersist(useAppStore.getState);
    }
    let generated=0;
    for(const run of useAppStore.getState().settings.aiOutreachRuns.filter(item=>item.status==="waiting")){
      if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return;
      const check=inspectOutreachCandidate(useAppStore.getState(),run.folderId,run.chatId,now,run.id);
      if(!check.candidate){
        if(["changed_context","not_member","disabled","invalid_contact","invalid_recipient","optout","person_excluded","manual_optout","already_contacted","not_new","unanswered","missed_window"].includes(check.reason))await saveRun({...run,status:"cancelled",error:translateCurrent(`outreachReason.${check.reason}`)});
        continue;
      }
      await generateOutreach(run.folderId,run.chatId,run.id,now);
      generated += 1;
      if (generated >= 2) break; // Keep Muse serial, but do not leave the whole batch waiting for another tick.
    }
  } catch(error) {
    scheduler={at:Date.now(),phase:"error",error:String(error).slice(0,500)};
    throw error;
  } finally {
    running=false;
    if(scheduler.phase!=="error")scheduler={at:Date.now(),phase:"waiting",error:""};
  }
}

async function generateOutreach(folderId:string,chatId:string,id:string,now=Date.now()) {
  const epoch=getDataRestoreGeneration();
  const routingState=useAppStore.getState();
  if(routingState.settings.aiTaskDismissedIds?.includes(`outreach:${id}`))return false;
  const initialStatus=routingState.settings.aiOutreachRuns.find(run=>run.id===id)?.status;
  const routed=outreachCandidate(routingState,folderId,chatId,now,id);
  if(!routed)return false;
  if(routed.rule.firstContactQuotas&&routed.chat.accountId!==routed.accountId){
    const target=routingState.chats.find(c=>{
      const contact=routingState.contacts.find(person=>person.id===c.contactId);
      return (c.accountId||contact?.accountId)===routed.accountId&&contact&&recipientKey('',resolveSendTarget({phone:contact.phone,channelAddress:contact.channelAddress,entityId:contact.id}))===recipientKey('',routed.recipient);
    })?.id||routingState.ensureChatForContact(routed.contact.id,routed.accountId);
    if(!target)return false;
    const fresh=useAppStore.getState();
    if(!fresh.settings.chatFolders.some(f=>f.id===folderId&&f.chatIds.includes(chatId)))return false;
    if(!routingState.chats.some(c=>c.id===target))fresh.patchChat(target,{hasMessageHistory:false});
    fresh.updateSettings({chatFolders:fresh.settings.chatFolders.map(f=>f.id===folderId?{...f,chatIds:[...new Set(f.chatIds.map(id=>id===chatId?target:id))]}:f)});
    chatId=target;
    const waiting=useAppStore.getState().settings.aiOutreachRuns.find(run=>run.id===id&&run.status==="waiting");
    if(waiting)await saveRun({...waiting,chatId,basisAt:useAppStore.getState().chats.find(chat=>chat.id===chatId)!.updatedAt});
    await flushPersist(useAppStore.getState);
    now=Date.now();
  }
  scheduler={at:Date.now(),phase:"history",error:""};
  await hydrateOutreachHistory(chatId);
  if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
  const state=useAppStore.getState(),candidate=outreachCandidate(state,folderId,chatId,now,id);
  if(state.settings.aiTaskDismissedIds?.includes(`outreach:${id}`))return false;
  if(initialStatus!==state.settings.aiOutreachRuns.find(run=>run.id===id)?.status)return false;
  const key=candidate&&outreachContextKey(state,folderId,chatId,id,now);
  if(!candidate||!key){
    const waiting=state.settings.aiOutreachRuns.find(run=>run.id===id&&run.status==="waiting");
    if(waiting)await saveRun({...waiting,status:"cancelled",error:"聊天记录加载后条件已变化，未生成或发送"});
    return false;
  }
  let run:AiOutreachRun={id,folderId,chatId,accountId:candidate.accountId,recipient:candidate.recipient,day:candidate.day,basisAt:candidate.basisAt,at:new Date(now).toISOString(),status:"generating"};
  await saveRun(run);
  if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch||useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||outreachContextKey(useAppStore.getState(),folderId,chatId,id)!==key)return false;
  scheduler={at:Date.now(),phase:"generating",error:""};
  controller=new AbortController();
  try {
    const result=await generateSuggestions(candidate.contact,candidate.thread,useAppStore.getState().settings,
      {auto:true,accountId:candidate.accountId,chatId,outreach:outreachGoal(candidate.rule),signal:controller.signal});
    const text=result.suggestions[0]?.text.trim();
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    if(controller.signal.aborted||useAppStore.getState().settings.aiTaskDismissedIds?.includes(`outreach:${id}`)||useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||outreachContextKey(useAppStore.getState(),folderId,chatId,id)!==key){
      await saveRun({...run,status:"cancelled",error:"生成期间上下文或规则发生变化"});return false;
    }
    const block=text&&getAutoReplyOutputBlockReason(text,{allowPricing:candidate.policy.allowPricing});
    if(result.fallback||result.source==="mock"||!text||block){await saveRun({...run,status:"failed",error:result.error||block||"AI 没有返回有效内容"});return false;}
    const hash=await hashAiReplyContext(key);
    if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch)return false;
    if(useAppStore.getState().settings.aiOutreachRuns.find(item=>item.id===id)?.status!=="generating"||outreachContextKey(useAppStore.getState(),folderId,chatId,id)!==key)return false;
    run={...run,status:"draft",text,contextHash:hash};
    await saveRun(run);
    if(candidate.rule.mode==="auto")await queueOutreachDraft(id,false);
    return true;
  } catch(error){if(!isDataRestoreActive()&&getDataRestoreGeneration()===epoch)await saveRun({...run,status:"failed",error:String(error)});return false;}
  finally{controller=undefined;}
}
export async function retryAiOutreach(id:string){
  const state=useAppStore.getState(),run=state.settings.aiOutreachRuns.find(item=>item.id===id);
  if(state.settings.aiTaskDismissedIds?.includes(`outreach:${id}`))return false;
  if(running||isDataRestoreActive()||!state.hydrated||!state.uiReady||!run||!["failed","cancelled","draft"].includes(run.status))return false;
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
    }finally{running=false;}
  }
  running=true;try{return await generateOutreach(run.folderId,run.chatId,id);}finally{running=false;}
}
