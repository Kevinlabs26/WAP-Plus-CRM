import type { AppState } from '../store/types';
import { lastContactedAccounts, recipientKey } from './scheduledPlans';
import { resolveSendTarget } from './utils';
import { isWaAccountConnected } from './accountConnection';
type State=Pick<AppState,'settings'|'chats'|'contacts'|'messages'|'baileysUi'>;
export function outreachPeople(state:State,chatIds:readonly string[]) {
  const contacts=new Map(state.contacts.map(c=>[c.id,c]));
  const groups=new Map<string,typeof state.chats>();
  for(const chat of state.chats){const c=contacts.get(chat.contactId);if(!c||c.isGroup||chat.isGroup)continue;
    const target=resolveSendTarget({phone:c.phone,channelAddress:c.channelAddress,entityId:c.id});if(!target)continue;
    const key=recipientKey('',target);groups.set(key,[...(groups.get(key)||[]),chat]);}
  const latest=lastContactedAccounts(state.chats,state.contacts,state.messages);
  const selected=new Set(chatIds),people=new Map<string,{chatId:string;accountId:string;kind:'existing'|'new'|'unknown'}>();
  for(const [key,chats] of groups){const source=chats.find(c=>selected.has(c.id));if(!source)continue;
    const ids=new Set(chats.map(c=>c.id));
    const messages=state.messages.filter(m=>ids.has(m.chatId)&&m.mediaType!=='system'&&(m.direction==='in'||!['pending','queued','failed','local'].includes(m.deliveryStatus||'')));
    const known=chats.filter(c=>c.hasMessageHistory||c.hasOutgoingHistory||c.lastMessage||c.lastMessageDirection||contacts.get(c.contactId)?.lastMessageAt);
    const hasHistory=latest.has(key)||known.length||messages.length;
    const owner=latest.get(key)||[...messages].sort((a,b)=>b.sentAt.localeCompare(a.sentAt))[0]?.accountId||[...known].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.accountId||source.accountId||contacts.get(source.contactId)?.accountId||'';
    people.set(key,{chatId:source.id,accountId:owner,kind:hasHistory?'existing':chats.every(c=>c.hasMessageHistory===false||c.id.startsWith('chat-c-'))?'new':'unknown'});
  }
  return people;
}
export function allocateFirstContacts(state:State,chatIds:readonly string[],quotas:Record<string,number>,previous:Record<string,string>={}) {
  const people=outreachPeople(state,chatIds),assignments:Record<string,string>={};
  const remaining=new Map(Object.entries(quotas).filter(([id])=>state.settings.waAccounts.some(a=>a.id===id)).map(([id,n])=>[id,Math.max(0,Math.min(100,Math.floor(n)||0))]));
  for(const [key,p] of people)if(p.kind==='new'&&previous[key]&&(remaining.get(previous[key])||0)>0){assignments[key]=previous[key];remaining.set(previous[key],remaining.get(previous[key])!-1);}
  for(const [key,p] of people)if(p.kind==='new'&&!assignments[key]){
    const account=[...remaining].find(([id,n])=>n>0&&isWaAccountConnected(state.settings.waAccounts,id,state.settings.liveBaileysAccountId,state.baileysUi.connection));
    if(account){assignments[key]=account[0];remaining.set(account[0],account[1]-1);}
  }
  return {people,assignments};
}
