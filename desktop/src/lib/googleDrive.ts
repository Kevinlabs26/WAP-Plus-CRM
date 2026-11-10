import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { idbGet, idbSet } from "./idb";
import { isTauri } from "./bridge";
import { useAppStore } from "@/store/appStore";
import { baileysFetchAvatar } from "./baileys";
import type { Contact } from "@/types/crm";
import { registerDesktopNotifyAction } from "./desktopNotify";
import { translateCurrent as t } from "@/i18n";

export type DriveConfig = { email: string; folderId: string; folderName: string; mode: "public" | "emails"; emails: string[] };
export type DriveFolder = {id:string;name:string;capabilities?:{canAddChildren?:boolean}};
type Stage = "reading" | "uploading" | "sharing" | "copying" | "done" | "error" | "copyError";
export type DriveJob = { id:string;createdAt:string;title:string; stage:Stage; config:DriveConfig; load?:()=>Promise<string>|string; data?:string; fileId?:string; url?:string; shared?:boolean; error?:string; uploadProgress?:number; completedAt?:number };
type DriveState = {
  ready:boolean;configured:boolean;email:string|null;needsAccess:boolean;config:DriveConfig|null;error:string;connecting:boolean;uploadBusy:boolean;job:DriveJob|null;jobs:DriveJob[];selectedJobId:string|null;journalError:string;
  menu:{x:number;y:number;contact:Contact;accountId?:string|null}|null;
};
export const useGoogleDrive = create<DriveState>(()=>({ready:false,configured:false,email:null,needsAccess:false,config:null,error:"",connecting:false,uploadBusy:false,job:null,jobs:[],selectedJobId:null,journalError:"",menu:null}));
const KEY = "google-drive-upload-v1";
let initialized:Promise<void>|undefined;
let journalReload:Promise<void>|undefined;
let journalLoaded=false;
let journalQueue=Promise.resolve();
function setJob(job:DriveJob){
  const state=useGoogleDrive.getState();
  let images=0;
  const jobs=[job,...state.jobs.filter(item=>item.id!==job.id)].slice(0,30).map(item=>({...item,load:item.id===job.id?item.load:undefined,data:item.data&&++images<=3?item.data:undefined}));
  for(const old of state.jobs)if(!jobs.some(item=>item.id===old.id))registerDesktopNotifyAction(`cloud-upload:${old.id}`,null);
  useGoogleDrive.setState({job:jobs[0],jobs});
}
function persistJobs(){
  if(!journalLoaded)return Promise.reject(Error(t("cloud.journalError")));
  const jobs=useGoogleDrive.getState().jobs.map(({load,...job})=>job);
  const save=journalQueue.then(()=>invoke("google_drive_jobs",{jobs})).then(()=>{useGoogleDrive.setState({journalError:""});});
  journalQueue=save.catch(error=>{useGoogleDrive.setState({journalError:String(error)});});
  return save;
}
export function showDriveJob(id:string){
  const state=useGoogleDrive.getState();
  if(state.jobs.some(job=>job.id===id))useGoogleDrive.setState({selectedJobId:id});
  else {useAppStore.getState().pushToast(t("cloud.taskExpired"),"info");return;}
  useAppStore.getState().setSettingsOpen(true,"cloud-images");
}

export function driveFolderId(input:string) {
  const text=input.trim();
  if (/^[\w-]+$/.test(text)) return text;
  try { const url=new URL(text);return url.protocol==="https:"&&url.hostname==="drive.google.com" ? /^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/.exec(url.pathname)?.[1] || null : null; } catch {return null;}
}
export function driveEmails(input:string) { return [...new Set(input.split(/[\s,;，；]+/).map(value=>value.trim().toLowerCase()).filter(Boolean))]; }
export function validateDriveConfig(config:DriveConfig) {
  if (!config.email || !driveFolderId(config.folderId) || !config.folderName.trim() || !["public","emails"].includes(config.mode)) throw Error("请选择云盘账号、上传文件夹和分享方式");
  if (config.mode==="emails"&&(!config.emails.length||config.emails.length>20||config.emails.some(email=>!/^([^@\s]+)@([^@\s.]+\.)+[^@\s.]+$/.test(email)))) throw Error("请填写有效的分享邮箱（最多20个）");
}
export function initializeDrive() {
  return initialized ||= (async()=>{
    if (!isTauri()) {useGoogleDrive.setState({ready:true,error:"请在桌面版连接 Google 云盘"});return;}
    if(!journalLoaded){
      try{
        const saved=await invoke<DriveJob[]>("google_drive_jobs");
        const jobs=saved.map(job=>({...job,load:undefined,url:job.fileId?`https://drive.google.com/file/d/${job.fileId}/view`:undefined,
          ...(["reading","uploading","sharing","copying"].includes(job.stage)?{stage:job.shared?"copyError" as const:"error" as const,error:t("cloud.interrupted")}:{}),}));
        for(const job of jobs)registerDesktopNotifyAction(`cloud-upload:${job.id}`,()=>showDriveJob(job.id));
        journalLoaded=true;
        useGoogleDrive.setState({journalError:"",jobs,job:jobs[0]||null,selectedJobId:jobs[0]?.id||null});
      }catch(error){useGoogleDrive.setState({journalError:String(error)});}
    }
    try {
      const [status,config]=await Promise.all([invoke<{configured:boolean;email:string|null;needsAccess:boolean}>("google_sheets_status",{drive:true}),idbGet<DriveConfig>(KEY,true)]);
      useGoogleDrive.setState({...status,config:config?.email===status.email?config:null,ready:true,error:""});
    }catch(error){initialized=undefined;useGoogleDrive.setState({ready:true,error:String(error)});}
  })();
}
export async function connectDrive() {
  if (useGoogleDrive.getState().uploadBusy||useGoogleDrive.getState().connecting) return;
  useGoogleDrive.setState({connecting:true,error:""});
  try {
    await initializeDrive();
    await invoke("google_sheets_prepare_connect");
    const status=await invoke<{configured:boolean;email:string;needsAccess:boolean}>("google_sheets_connect",{drive:true});
    const config=useGoogleDrive.getState().config;
    useGoogleDrive.setState({...status,config:config?.email===status.email?config:null});
    if(config?.email!==status.email) await idbSet(KEY,null);
  }catch(error){useGoogleDrive.setState({error:String(error)});}
  finally{useGoogleDrive.setState({connecting:false});}
}
export function reloadDriveJournal(){
  return journalReload ||= (async()=>{
    await initialized;
    if(useGoogleDrive.getState().uploadBusy)return;
    if(journalLoaded){await persistJobs().catch(()=>{});return;}
    initialized=undefined;await initializeDrive();
  })().finally(()=>{journalReload=undefined;});
}
export async function disconnectDrive() {
  if(useGoogleDrive.getState().uploadBusy)return;
  await invoke("google_sheets_disconnect",{drive:true});
  useGoogleDrive.setState({email:null,needsAccess:false,config:null,error:""});
  await idbSet(KEY,null);
}
export async function saveDriveConfig(config:DriveConfig) {
  validateDriveConfig(config);
  if(useGoogleDrive.getState().uploadBusy||config.email!==useGoogleDrive.getState().email)throw Error("云盘账号已改变或正在上传，请稍后保存");
  const folder=await driveCommand<DriveFolder>({action:"folder",email:config.email,folderId:config.folderId});
  if(!folder.id||!folder.name)throw Error("无法确认上传文件夹");
  config={...config,folderId:folder.id,folderName:folder.name};
  await idbSet(KEY,config);useGoogleDrive.setState({config});
}
export const driveCommand = <T=unknown>(request:Record<string,unknown>)=>invoke<T>("google_drive",{request});

async function imageData(source:string) {
  const limit=8*1024*1024;
  if(/^data:image\/(png|jpeg|gif|webp);base64,/.test(source)) {
    if(source.length>Math.ceil(limit/3)*4+128)throw Error("图片超过8 MB，请先压缩");
    return source;
  }
  if(!/^(blob:|https:\/\/)/.test(source))throw Error("请先加载原图");
  const response=await fetch(source,{signal:AbortSignal.timeout(30_000)});
  if(!response.ok||!response.body)throw Error("读取图片失败，请先加载原图");
  const reader=response.body.getReader();const chunks:BlobPart[]=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error("图片超过8 MB，请先压缩");chunks.push(new Uint8Array(value));}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return new Promise<string>((resolve,reject)=>{const file=new FileReader();file.onload=()=>resolve(String(file.result));file.onerror=file.onabort=()=>reject(Error("读取图片失败"));file.readAsDataURL(new Blob(chunks,{type:response.headers.get("content-type")?.split(";")[0]||"image/jpeg"}));});
}
export async function copyDriveLink() {
  const job=useGoogleDrive.getState().job;
  if(!job?.shared||!job.url)throw Error("链接尚未完成分享");
  if(isTauri())await invoke("clipboard_write_text",{text:job.url});else await navigator.clipboard.writeText(job.url);
  if(useGoogleDrive.getState().job?.id===job.id){setJob({...job,stage:"done",completedAt:Date.now(),error:undefined,data:undefined,load:undefined});await persistJobs();}
}
async function runJob(job:DriveJob) {
  job={...job,stage:"reading",error:undefined};
  setJob(job);useGoogleDrive.setState({uploadBusy:true,selectedJobId:job.id});
  let stop:(()=>void)|undefined;
  const update=(patch:Partial<DriveJob>)=>{
    job={...job,...patch};setJob(job);
  };
  try{
    await persistJobs();
    if(!job.data&&job.load)update({data:await imageData(await job.load()),load:undefined});
    if(!job.data&&!job.fileId)throw Error(t("cloud.sourceMissing"));
    await persistJobs();
    if(!job.fileId){const ids=await driveCommand<{ids:string[]}>({action:"prepare",email:job.config.email});if(!ids.ids?.[0])throw Error("无法准备云盘上传");update({fileId:ids.ids[0]});}
    // Commit the remote identity before submitting bytes; a restart rechecks this exact file.
    await persistJobs();
    stop=await listen<{fileId:string;stage:"uploading"|"sharing"}>("google-drive-upload-stage",({payload})=>{if(payload.fileId===job.fileId&&["uploading","sharing"].includes(job.stage))update({stage:payload.stage});}).catch(()=>undefined);
    const stopProgress=await listen<{fileId:string;loaded:number;total:number}>("google-drive-upload-progress",({payload})=>{if(payload.fileId===job.fileId&&job.stage==="uploading"&&payload.total>0)update({uploadProgress:Math.min(100,Math.floor(payload.loaded/payload.total*100))});}).catch(()=>undefined);
    if(stop) {
      const stopStage=stop;
      stop=()=>{stopStage();stopProgress?.();};
    } else stop=stopProgress;
    update({stage:"uploading",uploadProgress:0});
    const result=await driveCommand<{fileId:string;url:string;shared:boolean;sharingError?:string}>({action:"upload",email:job.config.email,folderId:job.config.folderId,fileId:job.fileId,dataUrl:job.data,name:[...job.title].slice(0,150).join(""),mode:job.config.mode,emails:job.config.emails});
    update({url:result.url,shared:result.shared,uploadProgress:100,...(result.shared?{data:undefined,load:undefined}:{})});
    await persistJobs();
    if(!result.shared)throw Error(result.sharingError||"图片已上传，但共享未完成，请点击重试");
    update({stage:"copying"});
    await copyDriveLink();
    job={...job,stage:"done",data:undefined,load:undefined};
  }catch(error){update({stage:job.shared?"copyError":"error",error:String(error).replace(/^Error: /,"")});await persistJobs().catch(()=>{});}
  finally{
    stop?.();useGoogleDrive.setState({uploadBusy:false});
  }
}
export async function uploadCloudImage(load:NonNullable<DriveJob["load"]>,title:string) {
  if(useGoogleDrive.getState().uploadBusy){useAppStore.getState().pushToast("已有图片正在上传，请稍候","info");return;}
  await initializeDrive();
  const state=useGoogleDrive.getState();
  if(state.uploadBusy)return;
  if(state.journalError){useAppStore.getState().pushToast(`${t("cloud.journalError")}：${state.journalError}`,"error");return;}
  if(!state.config||!state.email||state.needsAccess){useAppStore.getState().setSettingsOpen(true,"cloud-images");useAppStore.getState().pushToast("请先配置云端图片上传","info");return;}
  try{validateDriveConfig(state.config);}catch(error){useAppStore.getState().setSettingsOpen(true,"cloud-images");useAppStore.getState().pushToast(String(error),"error");return;}
  await runJob({id:crypto.randomUUID(),createdAt:new Date().toISOString(),title:[...(title.trim()||"图片")].slice(0,150).join(""),load,stage:"reading",config:{...state.config,emails:[...state.config.emails]}});
}
export async function retryDriveUpload(id?:string){
  const state=useGoogleDrive.getState();if(state.uploadBusy)return;
  if(!journalLoaded){await reloadDriveJournal();return;}
  const job=id?state.jobs.find(job=>job.id===id):state.job;
  if(!job)return;
  if(!job.shared){await runJob(job);return;}
  setJob(job);useGoogleDrive.setState({selectedJobId:job.id});
  useGoogleDrive.setState({uploadBusy:true});
  try{await copyDriveLink();}catch(error){setJob({...job,stage:"copyError",error:String(error)});await persistJobs().catch(()=>{});}
  finally{useGoogleDrive.setState({uploadBusy:false});}
}
export function uploadContactAvatar(contact:Contact,accountId?:string|null) {
  const owner=accountId||contact.accountId||contact.boundPhoneId;
  return uploadCloudImage(async()=>{
    let source=contact.avatarFullUrl||contact.avatarUrl||"";
    if(useAppStore.getState().settings.sendChannel!=="android_bridge"&&(contact.channelAddress||contact.phone)){
      try{const result=await baileysFetchAvatar({jid:contact.channelAddress,phone:contact.phone,quality:"image",accountId:owner});source=result.avatarFullUrl||result.avatarUrl||source;}catch{ /* A cached avatar remains usable. */ }
    }
    if(!source)throw Error("无法读取对方头像");return source;
  },contact.name||contact.phone||"头像");
}
export function openAvatarCloudMenu(event:{preventDefault:()=>void;stopPropagation:()=>void;clientX:number;clientY:number},contact:Contact,accountId?:string|null){event.preventDefault();event.stopPropagation();useGoogleDrive.setState({menu:{x:event.clientX,y:event.clientY,contact,accountId}});}
