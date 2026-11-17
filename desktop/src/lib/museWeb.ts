import { isTauri } from './bridge.ts';
import { trackAiRequest } from './aiUsage.ts';
import { enqueueMuseTask, museQueueSnapshot } from './museQueue.ts';
import { createMuseChatRedactor, musePrivacyGateMessage, musePrivacyIdentities, museTrainingDisabledConfirmed } from './museChatPrivacy.ts';

export type MuseWebStatus = { opened:boolean; ready:boolean; state:string; message:string; mediaProtocol?:number;parallelMedia?:boolean };
export type MuseWebAccount = {id:string;name:string;note:string;selected:boolean;primary:boolean};
export type MuseWebAccountPool = {accounts:MuseWebAccount[];selectedId:string;primaryId:string};
export type MuseAccountRemoveResult = {pool:MuseWebAccountPool;cleanupWarning:string|null};
export type MuseSideChat = {id:string;title:string;stable:boolean;ambiguous:boolean};
export type MuseSideChatCleanup = {id:string;accountId:string;dueAtMs:number;chats:MuseSideChat[];error:string|null;repeatEveryDays?:number;identityScheme?:number;excludedChatIds?:string[]};
export type MuseSideChatDeleteResult = {deleted:string[];error:string|null};
export type MuseWebContext = {profile:string;prefix:string;history:{id:string;text:string}[];suffix:string};
const checkedReadyAccounts=new Set<string>();
let nextAutoReplyAccount=0;
async function native<T>(command:string,args:Record<string,unknown>={}) {
  if(!isTauri())throw Error('Muse 网页接入仅支持桌面版');
  const {invoke}=await import('@tauri-apps/api/core');
  try { return await invoke<T>(command,args); }
  catch(error){
    if(/Failed to fetch/i.test(String(error)))throw Error('Muse 桌面通信中断，请确认桌面版已完成重启；先在 Muse 窗口检查结果，避免重复生成');
    throw error;
  }
}
export const openMuseWeb=(media=false,accountId?:string)=>native<void>('muse_web_open',{media,accountId});
export const museWebWorkspaceAccount=()=>native<string>('muse_web_workspace_account');
export const setMuseWorkspaceContentVisible=(visible:boolean)=>native<void>('muse_web_workspace_content_visible',{visible});
export const setMuseWorkspaceSidebarCollapsed=(collapsed:boolean)=>native<void>('muse_web_workspace_sidebar_set_collapsed',{collapsed});
export const museWebAccounts=()=>native<MuseWebAccountPool>('muse_web_accounts');
function requireMuseQueueIdle(){
  const queue=museQueueSnapshot();
  if(queue.textRunning||queue.textWaiting||queue.mediaRunning||queue.mediaWaiting)throw Error('Muse 正在处理或排队，请等待完成后切换账号');
}
export async function addMuseWebAccount():Promise<MuseWebAccountPool>{
  requireMuseQueueIdle();
  return native<MuseWebAccountPool>('muse_web_account_add');
}
export async function updateMuseWebAccount(accountId:string,name:string,note:string):Promise<MuseWebAccountPool>{
  return native<MuseWebAccountPool>('muse_web_account_update',{accountId,name,note});
}
export async function removeMuseWebAccount(accountId:string):Promise<MuseAccountRemoveResult>{
  requireMuseQueueIdle();
  return native<MuseAccountRemoveResult>('muse_web_account_remove',{accountId});
}
export async function museWebSideChats(accountId:string):Promise<MuseSideChat[]>{
  return native<MuseSideChat[]>('muse_web_side_chats',{accountId});
}
export async function deleteMuseWebSideChats(accountId:string,chats:MuseSideChat[]):Promise<MuseSideChatDeleteResult>{
  requireMuseQueueIdle();
  return native<MuseSideChatDeleteResult>('muse_web_delete_side_chats',{accountId,chats});
}
export const museWebCleanupSchedules=()=>native<MuseSideChatCleanup[]>('muse_web_cleanup_schedules');
export const scheduleMuseWebSideChatCleanup=(task:MuseSideChatCleanup)=>native<MuseSideChatCleanup[]>('muse_web_cleanup_schedule_add',{task});
export const updateMuseWebSideChatCleanup=(taskId:string,remainingChats:MuseSideChat[],error?:string)=>native<MuseSideChatCleanup[]>('muse_web_cleanup_schedule_update',{taskId,remainingChats,error});
export const advanceMuseWebSideChatCleanup=(taskId:string)=>native<MuseSideChatCleanup[]>('muse_web_cleanup_schedule_advance',{taskId});
export const cancelMuseWebSideChatCleanup=(taskId:string)=>native<MuseSideChatCleanup[]>('muse_web_cleanup_schedule_cancel',{taskId});
export async function selectMuseWebAccount(accountId:string):Promise<MuseWebAccountPool>{
  requireMuseQueueIdle();
  return native<MuseWebAccountPool>('muse_web_account_select',{accountId});
}
export async function setMuseWebPrimaryAccount(accountId:string):Promise<MuseWebAccountPool>{
  requireMuseQueueIdle();
  return native<MuseWebAccountPool>('muse_web_account_set_primary',{accountId});
}
export async function museWebStatus(media=false,accountId?:string):Promise<MuseWebStatus>{
  const status=await native<MuseWebStatus>('muse_web_status',{media,accountId});
  if(!media&&accountId){if(status.ready)checkedReadyAccounts.add(accountId);else checkedReadyAccounts.delete(accountId);}
  return status;
}
export async function nextMuseAutoReplyAccount(accountIds?:readonly string[]):Promise<string>{
  const pool=await museWebAccounts();
  const allowed=accountIds?new Set(accountIds):undefined;
  const eligible=()=>pool.accounts.filter(account=>museTrainingDisabledConfirmed(account.id)&&(!allowed||allowed.has(account.id)));
  let ready=eligible().filter(account=>checkedReadyAccounts.has(account.id));
  if(!ready.length){
    // Readiness is cached per webview, so the separate Muse workspace may not have populated this renderer's cache.
    await Promise.all(eligible().map(async account=>{
      try{await museWebStatus(false,account.id);}catch{checkedReadyAccounts.delete(account.id);}
    }));
    ready=eligible().filter(account=>checkedReadyAccounts.has(account.id));
  }
  if(!ready.length)return '';
  const account=ready[nextAutoReplyAccount%ready.length]!;
  nextAutoReplyAccount=(nextAutoReplyAccount+1)%ready.length;
  return account.id;
}
export async function readyMuseAutoReplyAccounts(accountIds?:readonly string[]):Promise<string[]>{
  const pool=await museWebAccounts();
  const allowed=accountIds?new Set(accountIds):undefined;
  return pool.accounts.filter(account=>checkedReadyAccounts.has(account.id)&&museTrainingDisabledConfirmed(account.id)&&(!allowed||allowed.has(account.id))).map(account=>account.id);
}
export type MuseGeneratedMedia = { mimeType: "image/png"|"image/jpeg"|"image/webp"|"video/mp4"|"video/webm"; data: string };
export type MuseWebOutput = { text?: string; media?: MuseGeneratedMedia };
export type MuseReferenceImage = { mimeType: "image/jpeg"|"image/png"|"image/webp"; dataUrl: string };
function parseMedia(media:{mimeType:string;dataUrl:string}):MuseGeneratedMedia {
  const match=/^data:(image\/(?:png|jpeg|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(media.dataUrl||'');
  if(!match||match[1]!==media.mimeType||match[2]!.length>(match[1]!.startsWith('video/')?22_400_000:11_200_000))throw Error('Muse 返回的媒体格式无效或文件过大');
  return {mimeType:match[1] as MuseGeneratedMedia['mimeType'],data:match[2]!};
}
export function collectMuseWebMedia(accountId?:string):Promise<MuseGeneratedMedia>{
  return enqueueMuseTask('media',async()=>parseMedia(await native<{mimeType:string;dataUrl:string}>('muse_web_collect_media',{accountId})));
}
export async function generateMuseWebOutput(prompt:string,signal?:AbortSignal,conversationKey?:string,context?:MuseWebContext,referenceImage?:MuseReferenceImage | MuseReferenceImage[],expectMedia=false,priority=0,onStart?:()=>void,accountId?:string):Promise<MuseWebOutput> {
  const targetAccount=accountId||(await museWebAccounts()).selectedId;
  if(!museTrainingDisabledConfirmed(targetAccount))throw Error(musePrivacyGateMessage());
  return enqueueMuseTask(expectMedia?'media':'text',async()=>{
    signal?.throwIfAborted();
    if(!museTrainingDisabledConfirmed(targetAccount))throw Error(musePrivacyGateMessage());
    onStart?.();
    if(context || conversationKey?.startsWith('["sheet-extract",') || conversationKey?.startsWith('["customer-insight",')){
      const redact=createMuseChatRedactor(musePrivacyIdentities());
      if(context){
        if(prompt!==context.prefix+context.history.map(item=>item.text).join('\n')+context.suffix)throw Error('Muse 聊天上下文不一致，未发送');
        const redactKeepingPaths=(value:string)=>{
          const pathBlock=/<read_only_muse_workspace_files>[\s\S]*?<\/read_only_muse_workspace_files>/.exec(value)?.[0];
          return pathBlock?redact(value.replace(pathBlock,'__MUSE_WORKSPACE_PATHS__')).replace('__MUSE_WORKSPACE_PATHS__',pathBlock):redact(value);
        };
        context={...context,profile:redactKeepingPaths(context.profile||''),prefix:redactKeepingPaths(context.prefix),history:context.history.map(item=>({...item,text:redact(item.text)})),suffix:redact(context.suffix)};
        prompt=context.prefix+context.history.map(item=>item.text).join('\n')+context.suffix;
      }else prompt=redact(prompt);
      // Older threads and handoff summaries may still contain unredacted personal data.
      conversationKey=conversationKey?JSON.stringify(['private-chat-v1',conversationKey]):undefined;
      signal?.throwIfAborted();
    }
    if(expectMedia){
      const status=await museWebStatus(true);
      signal?.throwIfAborted();
      if(status.mediaProtocol!==8||!status.parallelMedia)throw Error('桌面后台仍是旧版 Muse 连接，请退出并重启桌面开发版；本次未提交媒体任务');
      if(!status.ready)throw Error(status.message||'Muse 页面尚未连接就绪');
    }
    const requestId=crypto.randomUUID();
    const cancel=()=>{void native('muse_web_cancel',{requestId}).catch(()=>undefined);};
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      const referenceImages=Array.isArray(referenceImage)?referenceImage:referenceImage?[referenceImage]:[];
      if(referenceImages.length>2)throw Error('最多使用一张主体照片和一张风格参考图');
      const result=await native<string|{text:string|null;media:{mimeType:string;dataUrl:string}|null;error:string|null;summaryRequests:number;summaryFailed:boolean}>('muse_web_generate',{accountId:targetAccount,requestId,prompt,conversationKey,context,referenceImage:null,referenceImages,expectMedia});
      if(typeof result==='object'&&result?.summaryRequests===1){
        await trackAiRequest({provider:'muse',model:'muse-web',feature:'context'},async()=>{if(result.summaryFailed)throw Error('Muse 续接摘要失败');}).catch(()=>undefined);
      }
      signal?.throwIfAborted();
      if(typeof result==='object'&&result?.error)throw Error(result.error);
      const text=typeof result==='string'?result:result?.text;
      if(text!==null&&text!==undefined&&(typeof text!=='string'||text.length>512000))throw Error('Muse 返回内容无效');
      let media: MuseGeneratedMedia|undefined;
      if(typeof result==='object'&&result?.media){
        media=parseMedia(result.media);
      }
      if(!(typeof text==='string'&&text.trim())&&!media)throw Error('Muse 没有返回文字或媒体');
      return { ...(typeof text==='string'&&text.trim()?{text}:{}), ...(media?{media}:{}) };
    } finally {signal?.removeEventListener('abort',cancel);}
  },signal,priority,targetAccount).catch(error=>{
    if(/login|登录/i.test(error instanceof Error?error.message:String(error)))checkedReadyAccounts.delete(targetAccount);
    throw error;
  });
}
export async function generateMuseWeb(prompt:string,signal?:AbortSignal,conversationKey?:string,context?:MuseWebContext,priority=0,onStart?:()=>void,accountId?:string):Promise<string> {
  const result=await generateMuseWebOutput(prompt,signal,conversationKey,context,undefined,false,priority,onStart,accountId);
  if(!result.text)throw Error('Muse 只返回了媒体文件，当前操作需要文字回复');
  return result.text;
}
