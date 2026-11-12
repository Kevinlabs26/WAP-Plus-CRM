import { isTauri } from './bridge.ts';
import { trackAiRequest } from './aiUsage.ts';
import { enqueueMuseTask, museQueueSnapshot } from './museQueue.ts';
import { createMuseChatRedactor, musePrivacyIdentities } from './museChatPrivacy.ts';

export type MuseWebStatus = { opened:boolean; ready:boolean; state:string; message:string; mediaProtocol?:number;parallelMedia?:boolean };
export type MuseWebContext = {profile:string;prefix:string;history:{id:string;text:string}[];suffix:string};
async function native<T>(command:string,args:Record<string,unknown>={}) {
  if(!isTauri())throw Error('Muse 网页接入仅支持桌面版');
  const {invoke}=await import('@tauri-apps/api/core');
  try { return await invoke<T>(command,args); }
  catch(error){
    if(/Failed to fetch/i.test(String(error)))throw Error('Muse 桌面通信中断，请确认桌面版已完成重启；先在 Muse 窗口检查结果，避免重复生成');
    throw error;
  }
}
export const openMuseWeb=(media=false)=>native<void>('muse_web_open',{media});
let switchingAccount=false,accountNeedsLogin=false;
export async function museWebStatus(media=false):Promise<MuseWebStatus>{
  const status=await native<MuseWebStatus>('muse_web_status',{media});
  if(status.ready&&!switchingAccount)accountNeedsLogin=false;
  return status;
}
export async function switchMuseWebAccount():Promise<void>{
  const queue=museQueueSnapshot();
  if(switchingAccount||queue.textRunning||queue.textWaiting||queue.mediaRunning||queue.mediaWaiting)throw Error('Muse 正在处理或排队，请等待完成后切换账号');
  switchingAccount=true;accountNeedsLogin=true;
  try{await native<void>('muse_web_switch_account');}finally{switchingAccount=false;}
}
function requireMuseAccount(){if(switchingAccount||accountNeedsLogin)throw Error('请先登录新的 Muse 账号，再点击“检查连接”');}
export type MuseGeneratedMedia = { mimeType: "image/png"|"image/jpeg"|"image/webp"|"video/mp4"|"video/webm"; data: string };
export type MuseWebOutput = { text?: string; media?: MuseGeneratedMedia };
export type MuseReferenceImage = { mimeType: "image/jpeg"|"image/png"|"image/webp"; dataUrl: string };
function parseMedia(media:{mimeType:string;dataUrl:string}):MuseGeneratedMedia {
  const match=/^data:(image\/(?:png|jpeg|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(media.dataUrl||'');
  if(!match||match[1]!==media.mimeType||match[2]!.length>(match[1]!.startsWith('video/')?22_400_000:11_200_000))throw Error('Muse 返回的媒体格式无效或文件过大');
  return {mimeType:match[1] as MuseGeneratedMedia['mimeType'],data:match[2]!};
}
export function collectMuseWebMedia():Promise<MuseGeneratedMedia>{
  requireMuseAccount();
  return enqueueMuseTask('media',async()=>parseMedia(await native<{mimeType:string;dataUrl:string}>('muse_web_collect_media')));
}
export function generateMuseWebOutput(prompt:string,signal?:AbortSignal,conversationKey?:string,context?:MuseWebContext,referenceImage?:MuseReferenceImage | MuseReferenceImage[],expectMedia=false,priority=0,onStart?:()=>void):Promise<MuseWebOutput> {
  requireMuseAccount();
  return enqueueMuseTask(expectMedia?'media':'text',async()=>{
    signal?.throwIfAborted();
    onStart?.();
    if(context || conversationKey?.startsWith('["sheet-extract",')){
      const redact=createMuseChatRedactor(musePrivacyIdentities());
      if(context){
        if(prompt!==context.prefix+context.history.map(item=>item.text).join('\n')+context.suffix)throw Error('Muse 聊天上下文不一致，未发送');
        context={...context,profile:redact(context.profile||''),prefix:redact(context.prefix),history:context.history.map(item=>({...item,text:redact(item.text)})),suffix:redact(context.suffix)};
        prompt=context.prefix+context.history.map(item=>item.text).join('\n')+context.suffix;
      }else prompt=redact(prompt);
      // Older threads and handoff summaries may still contain unredacted personal data.
      conversationKey=conversationKey?JSON.stringify(['private-chat-v1',conversationKey]):undefined;
      signal?.throwIfAborted();
    }
    if(expectMedia){
      const status=await museWebStatus(true);
      signal?.throwIfAborted();
      if(status.mediaProtocol!==7||!status.parallelMedia)throw Error('桌面后台仍是旧版 Muse 连接，请退出并重启桌面开发版；本次未提交生图');
      if(!status.ready)throw Error(status.message||'Muse 页面尚未连接就绪');
    }
    const requestId=crypto.randomUUID();
    const cancel=()=>{void native('muse_web_cancel',{requestId}).catch(()=>undefined);};
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      const referenceImages=Array.isArray(referenceImage)?referenceImage:referenceImage?[referenceImage]:[];
      if(referenceImages.length>2)throw Error('最多使用一张主体照片和一张风格参考图');
      const result=await native<string|{text:string|null;media:{mimeType:string;dataUrl:string}|null;error:string|null;summaryRequests:number;summaryFailed:boolean}>('muse_web_generate',{requestId,prompt,conversationKey,context,referenceImage:null,referenceImages,expectMedia});
      if(typeof result==='object'&&result?.summaryRequests===1){
        await trackAiRequest({provider:'muse',model:'muse-web',feature:'context'},async()=>{if(result.summaryFailed)throw Error('Muse 续接摘要失败');}).catch(()=>undefined);
      }
      signal?.throwIfAborted();
      if(typeof result==='object'&&result?.error)throw Error(result.error);
      const text=typeof result==='string'?result:result?.text;
      if(text!==null&&text!==undefined&&(typeof text!=='string'||text.length>64000))throw Error('Muse 返回内容无效');
      let media: MuseGeneratedMedia|undefined;
      if(typeof result==='object'&&result?.media){
        media=parseMedia(result.media);
      }
      if(!(typeof text==='string'&&text.trim())&&!media)throw Error('Muse 没有返回文字或媒体');
      return { ...(typeof text==='string'&&text.trim()?{text}:{}), ...(media?{media}:{}) };
    } finally {signal?.removeEventListener('abort',cancel);}
  },signal,priority);
}
export async function generateMuseWeb(prompt:string,signal?:AbortSignal,conversationKey?:string,context?:MuseWebContext,priority=0,onStart?:()=>void):Promise<string> {
  const result=await generateMuseWebOutput(prompt,signal,conversationKey,context,undefined,false,priority,onStart);
  if(!result.text)throw Error('Muse 只返回了媒体文件，当前操作需要文字回复');
  return result.text;
}
