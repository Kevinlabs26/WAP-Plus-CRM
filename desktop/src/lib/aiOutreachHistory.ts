import { useAppStore } from "@/store/appStore";
import { loadMessagesPage } from "@/lib/storage";
import { mergeMessagesByTime } from "@/store/messageOrdering";
import { retainMessageChats } from "@/store/messageMemory";
import type { Message } from "@/types/crm";
import { isDataRestoreActive, getDataRestoreGeneration } from "@/store/restoreGuard";

const loadedHistory=new Map<string,{at:number;epoch:number}>();
export async function hydrateOutreachHistory(chatId:string){
  if(isDataRestoreActive())throw new Error("正在恢复数据，请稍后重新检查主动联系");
  const epoch=getDataRestoreGeneration();
  const state=useAppStore.getState();
  retainMessageChats("ai-outreach",[chatId,...(state.settings.aiOutreachRuns||[]).filter(run=>["generating","draft","queued"].includes(run.status)).map(run=>run.chatId)]);
  const chat=state.chats.find(chat=>chat.id===chatId),cached=loadedHistory.get(chatId);
  if(!chat?.hasMessageHistory||cached?.epoch===epoch&&Date.now()-cached.at<60_000)return;
  const page=await loadMessagesPage({chatId,limit:240});
  const fresh=useAppStore.getState().chats.find(chat=>chat.id===chatId);
  if(isDataRestoreActive()||getDataRestoreGeneration()!==epoch||!fresh||fresh.contactId!==chat.contactId||fresh.accountId!==chat.accountId)throw new Error("会话或数据已变化，停止载入旧历史");
  if(page?.items.length)useAppStore.setState(current=>({messages:mergeMessagesByTime(current.messages,page.items as Message[])}));
  loadedHistory.delete(chatId);loadedHistory.set(chatId,{at:Date.now(),epoch});
  if(loadedHistory.size>1000)loadedHistory.delete(loadedHistory.keys().next().value!);
}
