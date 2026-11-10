import type { SettingsShape } from "../store/settingsDefaults";
import type { Message } from "../types/crm";
import type { AutoReplyRuntime } from "./autoReplyRuntime";
import { resolveAutoReplyScope } from "./autoReplyScope";
import { resolveAiReplyProfile } from "./aiPromptScope";
import { hasRealAiKey } from "./aiSuggest";
import { evaluateAutoReplyDecision, resolveAutoReplyPolicy } from "./aiSafety";

type StatusKey = "paused"|"manual"|"offline"|"missingAi"|"invalidPrompt"|"queued"|"failed"|"uncertain"|"waitingReply"|"waiting"|"transcribing"|"generating"|"retry"|"human"|"outsideHours"|"takeover"|"ready";
export function getChatAiStatus({settings,chatId,accountId,connected,thread,runtime,now=Date.now()}:{
  settings:SettingsShape;chatId:string;accountId?:string;connected:boolean;thread:readonly Message[];runtime?:AutoReplyRuntime;now?:number;
}):{key:StatusKey;reason?:string;retryAt?:number} {
  const scope=resolveAutoReplyScope(settings,chatId);
  if(scope.source==="paused")return {key:"paused"};
  if(scope.mode!=="auto")return {key:"manual",reason:scope.folderName};
  if(!connected)return {key:"offline"};
  if(!hasRealAiKey(settings))return {key:"missingAi"};
  const profile=resolveAiReplyProfile(settings,accountId,chatId);
  if(profile.error)return {key:"invalidPrompt",reason:profile.error};
  const messages=thread.filter(message=>!message.accountId||message.accountId===accountId);
  const directions=messages.map(message=>message.direction);
  const inbound=messages[directions.lastIndexOf("in")],outgoing=messages[directions.lastIndexOf("out")];
  const outgoingAfter=directions.lastIndexOf("out")>directions.lastIndexOf("in");
  if(outgoing&&outgoingAfter&&["ai_auto_reply","ai_proactive"].includes(outgoing.systemKind||"")) {
    if(outgoing.deliveryUncertain)return {key:"uncertain",reason:outgoing.lastError};
    if(outgoing.deliveryStatus==="failed")return {key:"failed",reason:outgoing.lastError};
    if(["pending","queued"].includes(outgoing.deliveryStatus||""))return {key:"queued",reason:outgoing.lastError};
    return {key:"waitingReply"};
  }
  const policy=resolveAutoReplyPolicy(settings.aiAutoReplyPolicy,settings.aiAutoReplyPolicyByAccountId,accountId);
  const decision=inbound?evaluateAutoReplyDecision(messages,inbound,now,policy):undefined;
  if(outgoing&&outgoingAfter) {
    if(decision&&!decision.allow&&decision.kind==="manual_takeover")return {key:"takeover",reason:decision.reason};
    return {key:"waitingReply"};
  }
  if(runtime&&runtime.inboundId===inbound?.id&&(!runtime.accountId||runtime.accountId===accountId))return {key:runtime.phase,reason:runtime.reason,retryAt:runtime.retryAt};
  if(decision&&!decision.allow)return {key:decision.kind==="outside_hours"?"outsideHours":decision.kind==="manual_takeover"?"takeover":"human",reason:decision.reason};
  return {key:"ready"};
}
