import {useEffect,useRef,useState} from "react";
import type {AppSettings} from "@/store/types";
import {Button,Input} from "@/components/ui/primitives";
import {useI18n} from "@/i18n";
import {isTauri} from "@/lib/bridge";
import {vertexStatus,saveVertexCredentials,removeVertexCredentials,vertexAccessToken,type VertexAiStatus} from "@/lib/vertexAi";

export function VertexAiFields({settings,updateSettings}:{settings:AppSettings;updateSettings:(patch:Partial<AppSettings>)=>void}){
  const {t}=useI18n(),[status,setStatus]=useState<VertexAiStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[verified,setVerified]=useState(false),file=useRef<HTMLInputElement>(null);
  const latest=useRef(settings),revision=useRef(0);latest.current=settings;
  useEffect(()=>{let active=true;const version=revision.current;if(isTauri())void vertexStatus().then(value=>{if(active&&revision.current===version){setStatus(value);updateSettings({vertexCredentialId:value.credentialId||"",...(!latest.current.vertexProjectId&&value.projectId?{vertexProjectId:value.projectId}:{})});}}).catch(error=>{if(active&&revision.current===version)setError(String(error));});return()=>{active=false;};},[]);
  const run=async(work:()=>Promise<void>)=>{if(busy)return;revision.current++;setBusy(true);setError("");setVerified(false);try{await work();}catch(error){setError(String(error));}finally{setBusy(false);}};
  const hasProject=!!(status?.configured||settings.vertexCredentialId||settings.vertexProjectId);
  return <div className="col-span-2 space-y-3">
    <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label={t("vertex.import")} onChange={event=>{const selected=event.target.files?.[0];event.target.value="";if(selected)void run(async()=>{if(selected.size>32_768)throw Error(t("vertex.tooLarge"));const result=await saveVertexCredentials(await selected.text());setStatus(result);const current=latest.current;updateSettings({vertexCredentialId:result.credentialId||"",...(!current.vertexProjectId||current.vertexProjectId===status?.projectId?{vertexProjectId:result.projectId||""}:{}),...(!current.vertexLocation?{vertexLocation:"global"}:{})});});}}/>
    <div className="flex flex-wrap items-center gap-2"><Button size="xs" disabled={busy||!isTauri()} onClick={()=>file.current?.click()}>{t(status?.configured?"vertex.replace":"vertex.import")}</Button>{status?.configured&&<><Button size="xs" disabled={busy} onClick={()=>void run(async()=>{await vertexAccessToken(settings.vertexCredentialId);setVerified(true);})}>{t("vertex.verify")}</Button><Button size="xs" disabled={busy} onClick={()=>void run(async()=>{await removeVertexCredentials();setStatus(null);updateSettings({vertexCredentialId:""});})}>{t("vertex.remove")}</Button></>}{busy&&<span role="status" className="text-xs text-zinc-500">{t("vertex.working")}</span>}</div>
    {!hasProject&&<p className="text-xs text-zinc-500">{t("vertex.autoProject")}</p>}
    {hasProject&&<div className="grid grid-cols-2 gap-3"><label className="text-2xs text-zinc-500">{t("vertex.project")}<Input value={settings.vertexProjectId} onChange={event=>updateSettings({vertexProjectId:event.target.value.trim()})} placeholder={t("vertex.autoProject")} className="mt-1"/></label><label className="text-2xs text-zinc-500">{t("vertex.location")}<Input value={settings.vertexLocation} onChange={event=>updateSettings({vertexLocation:event.target.value.trim()})} placeholder="global / us-central1" className="mt-1"/></label></div>}
    {status?.email&&<p className="truncate text-xs text-zinc-500">{status.email}</p>}
    {verified&&<p role="status" className="text-xs text-brand">{t("vertex.verified")}</p>}
    {error&&<p role="alert" className="break-words text-xs text-amber-500">{error}</p>}
    <p className="text-2xs text-zinc-500">{t(isTauri()?"vertex.note":"vertex.desktopOnly")}</p>
    {hasProject&&<label className="block text-2xs text-zinc-500">{t("settingsAi.chatModel")}<Input value={settings.aiModel} onChange={event=>updateSettings({aiModel:event.target.value.trim()})} className="mt-1" placeholder="Gemini Model ID"/></label>}
  </div>;
}
