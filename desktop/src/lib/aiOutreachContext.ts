import { isImmediateOutreach, outreachRunClock } from './aiOutreachRules';
import type { AppState } from "../store/types";
import type { Message, ChatPreview, Contact } from "../types/crm";
import { normalizeOutreachRule, outreachClock, outreachGoal } from "./aiOutreachRules.ts";
import { resolveAiReplyProfile } from "./aiPromptScope.ts";
import { getSuggestionContextKey, hasRealAiKey } from "./aiSuggest.ts";
import { isWaAccountConnected } from "./accountConnection.ts";
import { getAutoReplyOutputBlockReason, isWithinAutoReplyHours, resolveAutoReplyPolicy } from "./aiSafety.ts";
import { resolveSendTarget } from "./utils";
import { getAiOutputConstraintError } from "./aiReplyConstraints";
import { lastContactedAccounts, recipientKey } from "./scheduledPlans";

export type OutreachState = Pick<AppState,"settings"|"chats"|"contacts"|"messages"|"messagesByChatId"|"baileysUi">;
export type OutreachReason = "ready"|"disabled"|"folder_paused"|"not_member"|"all_paused"|"master_paused"|"unsupported_channel"|"missing_ai"|"invalid_contact"|"invalid_recipient"|"person_excluded"|"latest_account"|"invalid_account"|"account_paused"|"offline"|"manual_optout"|"outside_hours"|"not_time"|"delivery_pending"|"takeover"|"optout"|"stale_history"|"changed_context"|"already_contacted"|"unanswered"|"missing_prompt"|"capacity"|"duplicate";
type Candidate = {chat:ChatPreview;contact:Contact;accountId:string;recipient:string;rule:ReturnType<typeof normalizeOutreachRule>;day:string;basisAt:string;thread:Message[];policy:ReturnType<typeof resolveAutoReplyPolicy>};
export type OutreachCheck = {candidate:Candidate;reason:"ready"}|{candidate:null;reason:Exclude<OutreachReason,"ready">};
export function isOutreachPaused(settings: OutreachState["settings"], messageId: string) {
  const run=settings.aiOutreachRuns.find(item=>item.messageId===messageId);
  return !!(settings.aiAutoReplyPaused||settings.aiOutreachPaused||run&&(settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach?.paused||run.recipient&&settings.aiOutreachExcludedRecipients?.includes(recipientKey("",run.recipient))));
}
export const isOutreachOptOut = (text: string) => /(不要再联系|别再联系|停止联系|不要发消息|别发消息|\b(?:stop messaging|stop contacting|stop texting|(?:do not|don't) (?:contact|message|text)|unsubscribe)\b|ne (?:me |m['’])?(?:contactez|contacte|envoie|envoyez|ecris|ecrivez).*plus|arrete[rz]? de m['’]?(?:ecrire|envoyer)|no me (?:contactes|escribas))/i.test(text.normalize("NFKD").replace(/\p{M}/gu,""));

export function outreachFolderChatIds(state: OutreachState, folderId: string): string[] {
  const folder=state.settings.chatFolders.find(item=>item.id===folderId);
  if(!folder)return [];
  const ids=new Set(folder.chatIds);
  if(folder.systemType==="leadInbox"){
    const dismissed=new Set(state.settings.leadInbox.dismissedChatIds);
    for(const id of state.settings.leadInbox.collectedChatIds)if(!dismissed.has(id))ids.add(id);
    return [...ids].filter(id=>!dismissed.has(id));
  }
  return [...ids];
}

export function inspectOutreachCandidate(state: OutreachState, folderId: string, chatId: string, now=Date.now(), runId?:string, ownMessage?:Message, lookup?:{chat:ChatPreview;contact:Contact;members:ReadonlySet<string>;clock:ReturnType<typeof outreachClock>;lastAccounts?:ReadonlyMap<string,string>;rule?:ReturnType<typeof normalizeOutreachRule>;recipientRuns?:readonly import("./aiOutreachRules").AiOutreachRun[]},allowOffline=false):OutreachCheck {
  const settings=state.settings,folder=settings.chatFolders.find(item=>item.id===folderId);
  if(!folder?.aiOutreach?.enabled)return {candidate:null,reason:"disabled"};
  if(folder.aiOutreach.paused)return {candidate:null,reason:"folder_paused"};
  if(!(lookup?lookup.members.has(chatId):outreachFolderChatIds(state,folderId).includes(chatId)))return {candidate:null,reason:"not_member"};
  if(settings.aiAutoReplyPaused)return {candidate:null,reason:"all_paused"};
  if(settings.aiOutreachPaused)return {candidate:null,reason:"master_paused"};
  if(settings.sendChannel!=="baileys")return {candidate:null,reason:"unsupported_channel"};
  if(!hasRealAiKey(settings)&&!settings.aiOutreachMuseAccountId)return {candidate:null,reason:"missing_ai"};
  const rule=lookup?.rule||normalizeOutreachRule(folder.aiOutreach);
  const chat=lookup?.chat||state.chats.find(item=>item.id===chatId),contact=lookup?.contact||state.contacts.find(item=>item.id===chat?.contactId);
  if (!chat||!contact||chat.id!==chatId||contact.id!==chat.contactId||chat.isGroup||contact.isGroup||chat.localOnly) return {candidate:null,reason:"invalid_contact"};
  const recipient=resolveSendTarget({phone:contact.phone,channelAddress:contact.channelAddress,entityId:contact.id});
  if(!recipient)return {candidate:null,reason:"invalid_recipient"};
  if(settings.aiOutreachExcludedRecipients?.includes(recipientKey("",recipient)))return {candidate:null,reason:"person_excluded"};
  const accountId=chat.accountId||contact.accountId||settings.liveBaileysAccountId||settings.activeAccountId;
  if(folder.scope?.type==="all") {
    const preferred=(lookup?.lastAccounts||lastContactedAccounts(state.chats,state.contacts,state.messages)).get(recipientKey("",recipient));
    if(preferred&&preferred!==accountId)return {candidate:null,reason:"latest_account"};
  }
  if (!accountId || !settings.waAccounts.some(account=>account.id===accountId) || contact.accountId && contact.accountId!==accountId || folder.scope?.type==="account" && folder.scope.accountId!==accountId)return {candidate:null,reason:"invalid_account"};
  if(settings.sendPausedAccountIds?.includes(accountId))return {candidate:null,reason:"account_paused"};
  if(!allowOffline&&!isWaAccountConnected(settings.waAccounts,accountId,settings.liveBaileysAccountId,state.baileysUi.connection))return {candidate:null,reason:"offline"};
  if(settings.aiAutoReplyManualChatIds?.includes(chatId))return {candidate:null,reason:"manual_optout"};
  const policy=resolveAutoReplyPolicy(settings.aiAutoReplyPolicy,settings.aiAutoReplyPolicyByAccountId,accountId);
  if (!isWithinAutoReplyHours(policy,new Date(now))) return {candidate:null,reason:"outside_hours"};
  const clock=outreachRunClock(rule,now);
  if(!isImmediateOutreach(rule,now)&&outreachClock(rule.timeZone,now).time<rule.time)return {candidate:null,reason:"not_time"};
  const runs=settings.aiOutreachRuns||[], run=runId?runs.find(item=>item.id===runId):undefined;
  if(runs.length>=10_000&&!run)return {candidate:null,reason:"capacity"};
  const thread=(state.messagesByChatId ? state.messagesByChatId[chatId]||[] : state.messages.filter(item=>item.chatId===chatId)).filter(item=>item.id!==ownMessage?.id);
  if (thread.some(item=>item.direction==="out" && (["queued","pending"].includes(item.deliveryStatus||"")||item.deliveryUncertain))) return {candidate:null,reason:"delivery_pending"};
  if (thread.some(item=>item.direction==="out"&&!item.systemKind&&now-Date.parse(item.sentAt)<policy.takeoverMinutes*60_000)) return {candidate:null,reason:"takeover"};
  const lastInbound=[...thread].reverse().find(item=>item.direction==="in");
  if (lastInbound&&isOutreachOptOut(lastInbound.transcript||lastInbound.body)) return {candidate:null,reason:"optout"};
  const ownPreview=!!ownMessage && chat.updatedAt===ownMessage.sentAt && chat.lastMessage===ownMessage.body;
  const basisAt=ownPreview ? run?.basisAt||"" : chat.updatedAt;
  const basis=Date.parse(basisAt);
  if (!Number.isFinite(basis)||basis>now||thread.some(item=>Date.parse(item.sentAt)>basis)) return {candidate:null,reason:"stale_history"};
  if (run && (run.accountId!==accountId||run.day!==clock.day||run.basisAt!==basisAt||run.recipient&&run.recipient!==recipient)) return {candidate:null,reason:"changed_context"};
  if ((lookup?.recipientRuns||runs).some(item=>item.id!==runId && (item.chatId===chatId&&item.accountId===accountId||item.recipient&&recipientKey("",item.recipient)===recipientKey("",recipient)) &&
      (item.day===clock.day || ["waiting","draft","generating","queued"].includes(item.status)))) return {candidate:null,reason:"already_contacted"};
  if(chat.lastMessageDirection==="in"&&(!chat.replyHandledAt||chat.replyHandledAt<basisAt)||chat.replyPendingSince&&(!chat.replyHandledAt||chat.replyHandledAt<chat.replyPendingSince))return {candidate:null,reason:"unanswered"};
  const profile=resolveAiReplyProfile(settings,accountId,chatId);
  if (profile.error||!profile.prompt) return {candidate:null,reason:"missing_prompt"};
  return {candidate:{chat,contact,accountId,recipient,rule,day:clock.day,basisAt,thread,policy},reason:"ready"};
}

export function outreachCandidate(...args:Parameters<typeof inspectOutreachCandidate>){return inspectOutreachCandidate(...args).candidate;}

export function outreachContextKey(state: OutreachState, folderId:string,chatId:string,runId:string,now=Date.now(),ownMessage?:Message) {
  const candidate=outreachCandidate(state,folderId,chatId,now,runId,ownMessage,undefined,!!ownMessage);
  if (!candidate) return null;
  return JSON.stringify([folderId,chatId,candidate.accountId,candidate.recipient,candidate.day,candidate.basisAt,candidate.rule,
    state.settings.aiOutreachMuseAccountId,
    getSuggestionContextKey(candidate.contact,candidate.thread,state.settings,candidate.accountId,{auto:true,chatId,outreach:outreachGoal(candidate.rule),outreachDecision:state.settings.aiProvider==="muse"||!!state.settings.aiOutreachMuseAccountId,allowSidebarData:candidate.rule.allowSidebarData===true})]);
}

export function currentOutreachContext(state: OutreachState,message: Message) {
  const run=state.settings.aiOutreachRuns?.find(item=>item.messageId===message.id);
  if(run&&state.settings.aiTaskDismissedIds?.includes(`outreach:${run.id}`))return null;
  if (!run||run.status!=="queued"||message.systemKind!=="ai_proactive"||message.accountId!==run.accountId||message.chatId!==run.chatId||message.channelId!=="baileys"||message.body!==run.text||message.aiReplyContextHash!==run.contextHash) return null;
  const folder=state.settings.chatFolders.find(item=>item.id===run.folderId);
  if (folder?.aiOutreach?.mode!=="auto"&&!run.approved) return null;
  const candidate=outreachCandidate(state,run.folderId,run.chatId,Date.now(),run.id,message,undefined,true);
  if (!candidate||message.contactId!==candidate.contact.id||message.phoneE164!==candidate.recipient||getAutoReplyOutputBlockReason(message.body)||getAiOutputConstraintError(state.settings,run.accountId,run.chatId,message.body)) return null;
  return outreachContextKey(state,run.folderId,run.chatId,run.id,Date.now(),message);
}
