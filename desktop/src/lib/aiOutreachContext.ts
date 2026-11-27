import { isImmediateOutreach, outreachRunClock, outreachRunExpired, type AiOutreachRun } from './aiOutreachRules.ts';
import type { AppState } from "../store/types";
import type { Message, ChatPreview, Contact } from "../types/crm";
import { normalizeOutreachRule, outreachClock, outreachGoal } from "./aiOutreachRules.ts";
import { resolveAiReplyProfile } from "./aiPromptScope.ts";
import { getSuggestionContextKey, hasRealAiKey } from "./aiSuggest.ts";
import { isWaAccountConnected } from "./accountConnection.ts";
import { getAutoReplyOutputBlockReason, isWithinAutoReplyHours, resolveAutoReplyPolicy } from "./aiSafety.ts";
import { resolveSendTarget } from "./utils.ts";
import { getAiOutputConstraintError } from "./aiReplyConstraints.ts";
import { lastContactedAccounts, recipientKey } from "./scheduledPlans.ts";
import { deliveryAckRank } from "../store/bridgeIngestHelpers.ts";
import { firstContactHistory } from "./aiOutreachAllocation.ts";

export type OutreachState = Pick<AppState,"settings"|"chats"|"contacts"|"messages"|"messagesByChatId"|"baileysUi">;
export type OutreachReason = "ready"|"disabled"|"folder_paused"|"not_member"|"all_paused"|"master_paused"|"unsupported_channel"|"missing_ai"|"invalid_contact"|"invalid_recipient"|"person_excluded"|"latest_account"|"invalid_account"|"account_paused"|"offline"|"manual_optout"|"outside_hours"|"not_time"|"delivery_pending"|"takeover"|"optout"|"stale_history"|"changed_context"|"already_contacted"|"unanswered"|"missing_prompt"|"expired"|"duplicate"|"unallocated";
type Candidate = {chat:ChatPreview;historyChatId:string;contact:Contact;accountId:string;recipient:string;rule:ReturnType<typeof normalizeOutreachRule>;day:string;basisAt:string;thread:Message[];policy:ReturnType<typeof resolveAutoReplyPolicy>;firstContactVerified:boolean;reviewOnly:boolean};
export type OutreachCheck = {candidate:Candidate;reason:"ready"}|{candidate:null;reason:Exclude<OutreachReason,"ready">};

export function unresolvedOutreachRecipients(state: OutreachState): Map<string, string[]> {
  const pending = state.messages.filter(message => message.systemKind === "ai_proactive" && message.direction === "out" &&
    (message.deliveryStatus === "pending" || message.deliveryUncertain && deliveryAckRank(message.deliveryStatus) === 0));
  const recipients = new Map<string, string[]>();
  if (!pending.length) return recipients;
  const missingRecipient = new Set(pending.filter(message => !message.phoneE164).map(message => message.id));
  const recipientByMessageId = new Map(missingRecipient.size
    ? state.settings.aiOutreachRuns.filter(run => run.messageId && missingRecipient.has(run.messageId)).map(run => [run.messageId, run.recipient])
    : []);
  for (const message of pending) {
    const recipient = message.phoneE164 || recipientByMessageId.get(message.id);
    if (!recipient) continue;
    const key = recipientKey("", recipient);
    const ids = recipients.get(key);
    if (ids) ids.push(message.id);
    else recipients.set(key, [message.id]);
  }
  return recipients;
}
export function isOutreachPaused(settings: OutreachState["settings"], messageId: string) {
  const run=settings.aiOutreachRuns.find(item=>item.messageId===messageId);
  return !!(settings.aiAutoReplyPaused||settings.aiOutreachPaused||run&&(settings.chatFolders.find(folder=>folder.id===run.folderId)?.aiOutreach?.paused||run.recipient&&settings.aiOutreachExcludedRecipients?.includes(recipientKey("",run.recipient))));
}
export function isOutreachMessageExpired(settings: OutreachState["settings"], messageId: string, now = Date.now()) {
  const run = settings.aiOutreachRuns.find(item => item.messageId === messageId);
  return !!run && outreachRunExpired(run, settings.chatFolders.find(folder => folder.id === run.folderId)?.aiOutreach, now);
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

export function inspectOutreachCandidate(state: OutreachState, folderId: string, chatId: string, now=Date.now(), runId?:string, ownMessage?:Message, lookup?:{chat:ChatPreview;contact:Contact;members:ReadonlySet<string>;clock:ReturnType<typeof outreachClock>;lastAccounts?:ReadonlyMap<string,string>;rule?:ReturnType<typeof normalizeOutreachRule>;recipientRuns?:readonly AiOutreachRun[];unresolvedRecipients?:ReadonlyMap<string,readonly string[]>;firstContactHistory?:ReturnType<typeof firstContactHistory>},allowOffline=false):OutreachCheck {
  const settings=state.settings,folder=settings.chatFolders.find(item=>item.id===folderId);
  const runs=settings.aiOutreachRuns||[], run=runId?runs.find(item=>item.id===runId):undefined;
  if(run&&outreachRunExpired(run,folder?.aiOutreach,now))return {candidate:null,reason:"expired"};
  if(!folder?.aiOutreach?.enabled)return {candidate:null,reason:"disabled"};
  if(folder.aiOutreach.paused)return {candidate:null,reason:"folder_paused"};
  if(!(lookup?lookup.members.has(chatId):outreachFolderChatIds(state,folderId).includes(chatId)))return {candidate:null,reason:"not_member"};
  if(settings.aiAutoReplyPaused)return {candidate:null,reason:"all_paused"};
  if(settings.aiOutreachPaused)return {candidate:null,reason:"master_paused"};
  if(settings.sendChannel!=="baileys")return {candidate:null,reason:"unsupported_channel"};
  if(!hasRealAiKey(settings))return {candidate:null,reason:"missing_ai"};
  const rule=lookup?.rule||normalizeOutreachRule(folder.aiOutreach);
  const immediate=isImmediateOutreach(rule,now);
  if(rule.startMode==="immediate"&&!immediate)return {candidate:null,reason:"disabled"};
  if(run&&(run.archived||run.roundAt!==(immediate?rule.runNowAt:undefined)))return {candidate:null,reason:"changed_context"};
  if(rule.startMode==="scheduled"&&rule.scheduleStartAt!==undefined&&now<rule.scheduleStartAt)return {candidate:null,reason:"not_time"};
  const chat=lookup?.chat||state.chats.find(item=>item.id===chatId),contact=lookup?.contact||state.contacts.find(item=>item.id===chat?.contactId);
  if (!chat||!contact||chat.id!==chatId||contact.id!==chat.contactId||chat.isGroup||contact.isGroup||chat.localOnly) return {candidate:null,reason:"invalid_contact"};
  const recipient=resolveSendTarget({phone:contact.phone,channelAddress:contact.channelAddress,entityId:contact.id});
  if(!recipient)return {candidate:null,reason:"invalid_recipient"};
  const recipientId=recipientKey("",recipient);
  if((lookup?.unresolvedRecipients??unresolvedOutreachRecipients(state)).get(recipientId)?.some(id=>id!==ownMessage?.id))return {candidate:null,reason:"delivery_pending"};
  if(settings.aiOutreachExcludedRecipients?.includes(recipientKey("",recipient)))return {candidate:null,reason:"person_excluded"};
  const sourceAccountId=chat.accountId||contact.accountId||settings.liveBaileysAccountId||settings.activeAccountId;
  let accountId=sourceAccountId;
  let allocated=false;
  let historyChat=chat;
  let historyContact=contact;
  let firstContactVerified=false;
  let reviewOnly=false;
  if (folder.scope?.type==="all" && rule.firstContactQuotas) {
    const history=lookup?.firstContactHistory||firstContactHistory(state);
    const existing=history.known.get(recipientId);
    if (existing) {
      if (!existing.accountId) return {candidate:null,reason:"latest_account"};
      if (existing.accountId!==sourceAccountId) {
        const linked=history.chatsByRecipient.get(recipientId)?.filter(item=>
          (item.accountId||history.contacts.get(item.contactId)?.accountId||item.phoneId)===existing.accountId)
          .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
        const linkedContact=linked&&history.contacts.get(linked.contactId);
        if (!linked || !linkedContact) return {candidate:null,reason:"latest_account"};
        accountId=existing.accountId;
        historyChat=linked;
        historyContact=linkedContact;
        allocated=true;
      }
    } else if (history.unknown.has(recipientId)) {
      reviewOnly=true;
    } else {
      const assigned = Object.hasOwn(rule.scheduledFirstContactAssignments || {}, recipientId)
        ? rule.scheduledFirstContactAssignments?.[recipientId] : rule.firstContactAssignments?.[recipientId];
      if (!assigned) return {candidate:null,reason:"unallocated"};
      accountId=assigned;
      allocated=true;
      firstContactVerified=true;
    }
  }
  if(folder.scope?.type==="all" && !rule.firstContactQuotas) {
    const preferred=(lookup?.lastAccounts||lastContactedAccounts(state.chats,state.contacts,state.messages)).get(recipientKey("",recipient));
    if(preferred&&preferred!==accountId)return {candidate:null,reason:"latest_account"};
  }
  if (!accountId || !settings.waAccounts.some(account=>account.id===accountId) || !allocated && contact.accountId && contact.accountId!==accountId || folder.scope?.type==="account" && folder.scope.accountId!==accountId)return {candidate:null,reason:"invalid_account"};
  if(settings.sendPausedAccountIds?.includes(accountId))return {candidate:null,reason:"account_paused"};
  if(!allowOffline&&!isWaAccountConnected(settings.waAccounts,accountId,settings.liveBaileysAccountId,state.baileysUi.connection))return {candidate:null,reason:"offline"};
  if(settings.aiAutoReplyManualChatIds?.includes(chatId)||settings.aiAutoReplyManualChatIds?.includes(historyChat.id))return {candidate:null,reason:"manual_optout"};
  if (allocated && accountId!==sourceAccountId && state.chats.some(item=>item.contactId===contact.id && (item.accountId||item.phoneId)===accountId && settings.aiAutoReplyManualChatIds?.includes(item.id))) return {candidate:null,reason:"manual_optout"};
  const policy=resolveAutoReplyPolicy(settings.aiAutoReplyPolicy,settings.aiAutoReplyPolicyByAccountId,accountId);
  if (!isWithinAutoReplyHours(policy,new Date(now))) return {candidate:null,reason:"outside_hours"};
  const clock=outreachRunClock(rule,now);
  if(!isImmediateOutreach(rule,now)&&outreachClock(rule.timeZone,now).time<rule.time)return {candidate:null,reason:"not_time"};
  const thread=(state.messagesByChatId ? state.messagesByChatId[historyChat.id]||[] : state.messages.filter(item=>item.chatId===historyChat.id)).filter(item=>item.id!==ownMessage?.id);
  if (thread.some(item=>item.direction==="out" && (["queued","pending"].includes(item.deliveryStatus||"")||item.deliveryUncertain&&deliveryAckRank(item.deliveryStatus)===0))) return {candidate:null,reason:"delivery_pending"};
  if (thread.some(item=>item.direction==="out"&&!item.systemKind&&now-Date.parse(item.sentAt)<policy.takeoverMinutes*60_000)) return {candidate:null,reason:"takeover"};
  const lastInbound=[...thread].reverse().find(item=>item.direction==="in");
  if (lastInbound&&isOutreachOptOut(lastInbound.transcript||lastInbound.body)) return {candidate:null,reason:"optout"};
  const ownPreview=ownMessage?.chatId===historyChat.id && historyChat.updatedAt===ownMessage.sentAt && historyChat.lastMessage===ownMessage.body;
  const basisAt=ownPreview ? run?.basisAt||"" : historyChat.updatedAt;
  const basis=Date.parse(basisAt);
  if (!Number.isFinite(basis)||basis>now||thread.some(item=>Date.parse(item.sentAt)>basis)) return {candidate:null,reason:"stale_history"};
  if (run && (run.accountId!==accountId||run.day!==clock.day||run.basisAt!==basisAt||run.recipient&&run.recipient!==recipient)) return {candidate:null,reason:"changed_context"};
  if ((lookup?.recipientRuns||runs).some(item=>{
    if(item.id===runId||!(item.chatId===chatId&&item.accountId===accountId||item.recipient&&recipientKey("",item.recipient)===recipientKey("",recipient)))return false;
    if(item.status==="expired"&&!item.messageId)return false;
    if(["waiting","draft","generating"].includes(item.status)) {
      const priorRule=item.folderId===folderId?rule:settings.chatFolders.find(folder=>folder.id===item.folderId)?.aiOutreach;
      return !!priorRule&&!outreachRunExpired(item,priorRule,now);
    }
    if(item.status==="queued")return true;
    const priorRound=(rule.startMode==="immediate"&&rule.runNowAt!==undefined&&(item.roundAt??Date.parse(item.at))<rule.runNowAt)
      ||(rule.startMode==="scheduled"&&rule.scheduleStartAt!==undefined&&Date.parse(item.at)<rule.scheduleStartAt);
    if(priorRound&&item.status==="skipped")return false;
    if(priorRound&&item.folderId===folderId&&(item.status==="failed"||item.status==="cancelled")){
      if(!item.messageId)return false;
      const failed=state.messagesByChatId[item.chatId]?.find(message=>message.id===item.messageId)
        ??state.messages.find(message=>message.id===item.messageId);
      if(failed?.deliveryUncertain&&deliveryAckRank(failed.deliveryStatus)===0)return true;
      if(failed?.deliveryStatus==="failed"&&!failed.deliveryUncertain&&!failed.nextAttemptAt)return false;
    }
    return item.day===clock.day;
  })) return {candidate:null,reason:"already_contacted"};
  if(historyChat.lastMessageDirection==="in"&&(!historyChat.replyHandledAt||historyChat.replyHandledAt<basisAt)||historyChat.replyPendingSince&&(!historyChat.replyHandledAt||historyChat.replyHandledAt<historyChat.replyPendingSince))return {candidate:null,reason:"unanswered"};
  let profile=resolveAiReplyProfile(settings,accountId,chatId,undefined,historyContact.aiChatInstructions);
  if (profile.workspacePlaybook && profile.error && settings.aiPlaybookMuseMode !== "shared") {
    profile=resolveAiReplyProfile(settings,accountId,chatId,undefined,historyContact.aiChatInstructions,true);
  }
  if (profile.error||!profile.prompt) return {candidate:null,reason:"missing_prompt"};
  return {candidate:{chat,historyChatId:historyChat.id,contact:historyContact,accountId,recipient,rule,day:clock.day,basisAt,thread,policy,firstContactVerified,reviewOnly},reason:"ready"};
}

export function outreachCandidate(...args:Parameters<typeof inspectOutreachCandidate>){return inspectOutreachCandidate(...args).candidate;}

export function outreachContextKey(state: OutreachState, folderId:string,chatId:string,runId:string,now=Date.now(),ownMessage?:Message) {
  const candidate=outreachCandidate(state,folderId,chatId,now,runId,ownMessage,undefined,!!ownMessage);
  if (!candidate) return null;
  const rule={...candidate.rule,scheduleStartAt:undefined};
  // Adding a different recipient to a scheduled plan does not invalidate this draft.
  delete rule.scheduledFirstContactAssignments;
  return JSON.stringify([folderId,chatId,candidate.accountId,candidate.recipient,candidate.day,candidate.basisAt,rule,
    state.settings.aiProvider === "muse" ? state.settings.aiOutreachMuseAccountId : undefined,
    getSuggestionContextKey(candidate.contact,candidate.thread,state.settings,candidate.accountId,{auto:true,chatId,outreach:outreachGoal(candidate.rule),outreachDecision:candidate.rule.mode==="auto"||state.settings.aiProvider==="muse",allowSidebarData:candidate.rule.allowSidebarData===true}),
    ...(candidate.firstContactVerified ? ["verified-first-contact"] : candidate.reviewOnly ? ["history-review"] : [])]);
}

export function currentOutreachContext(state: OutreachState,message: Message) {
  const run=state.settings.aiOutreachRuns?.find(item=>item.messageId===message.id);
  if(run&&state.settings.aiTaskDismissedIds?.includes(`outreach:${run.id}`))return null;
  if (!run||run.status!=="queued"||message.systemKind!=="ai_proactive"||message.accountId!==run.accountId||message.channelId!=="baileys"||message.body!==run.text||message.aiReplyContextHash!==run.contextHash) return null;
  if (!run.approved && (!run.autoEvidence || !run.decisionDetails?.evidence || !run.decisionDetails.reason)) return null;
  const museAccountId = run.decisionDetails?.museAccountId;
  if (museAccountId && !state.settings.musePrivacyByAccountId?.[museAccountId]?.trainingDisabledConfirmedAt) return null;
  const folder=state.settings.chatFolders.find(item=>item.id===run.folderId);
  if (folder?.aiOutreach?.mode!=="auto"&&!run.approved) return null;
  const candidate=outreachCandidate(state,run.folderId,run.chatId,Date.now(),run.id,message,undefined,true);
  if (!candidate||message.contactId!==candidate.contact.id||message.phoneE164!==candidate.recipient||getAutoReplyOutputBlockReason(message.body)||getAiOutputConstraintError(state.settings,run.accountId,run.chatId,message.body)) return null;
  if (candidate.reviewOnly && !run.approved) return null;
  if (message.chatId!==run.chatId && (!candidate.rule.firstContactQuotas || !state.chats.some(chat=>chat.id===message.chatId && chat.contactId===candidate.contact.id && (chat.accountId||chat.phoneId)===run.accountId))) return null;
  return outreachContextKey(state,run.folderId,run.chatId,run.id,Date.now(),message);
}
