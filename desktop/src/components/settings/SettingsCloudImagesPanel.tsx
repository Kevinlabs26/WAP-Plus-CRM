import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { CloudUploadDetails } from "@/components/chat/CloudUploadStatus";
import { connectDrive, disconnectDrive, driveCommand, driveEmails, driveFolderId, initializeDrive, saveDriveConfig, useGoogleDrive, type DriveFolder } from "@/lib/googleDrive";

export function SettingsCloudImagesPanel() {
  const { t } = useI18n();
  const { email, configured, needsAccess, ready, connecting, uploadBusy, config, error:accountError } = useGoogleDrive();
  const [path,setPath] = useState<DriveFolder[]>([]);
  const [folders,setFolders] = useState<DriveFolder[]>([]);
  const [page,setPage] = useState<string>();
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [selected,setSelected] = useState<DriveFolder|null>(null);
  const [folderLink,setFolderLink] = useState("");
  const [mode,setMode] = useState<"public"|"emails">("emails");
  const [emails,setEmails] = useState("");
  const [error,setError] = useState("");
  const [saved,setSaved] = useState(false);
  const request = useRef(0);
  const current = path.at(-1);
  const locked = connecting || uploadBusy || saving;

  useEffect(()=>{void initializeDrive();},[]);
  useEffect(()=>{
    setSelected(config?{id:config.folderId,name:config.folderName}:null);
    setMode(config?.mode||"emails");setEmails(config?.emails.join(", ")||"");
    setPath(email?[{id:"root",name:t("cloud.myDrive")}]:[]);
    setFolderLink("");setError("");setSaved(false);
  },[email,t]);

  useEffect(()=>{
    const ticket=++request.current;
    setFolders([]);setPage(undefined);
    if(!email||!current||needsAccess){setLoading(false);return;}
    setLoading(true);setError("");
    void driveCommand<{files:DriveFolder[];nextPageToken?:string}>({action:"folders",email,parentId:current.id})
      .then(result=>{if(ticket===request.current){setFolders(result.files||[]);setPage(result.nextPageToken);}})
      .catch(error=>{if(ticket===request.current)setError(String(error));})
      .finally(()=>{if(ticket===request.current)setLoading(false);});
    return ()=>{request.current++;};
  },[email,current?.id,needsAccess]);

  const more = async()=>{
    if(!page||!email||!current||loading)return;
    const ticket=++request.current;setLoading(true);
    try{
      const result=await driveCommand<{files:DriveFolder[];nextPageToken?:string}>({action:"folders",email,parentId:current.id,pageToken:page});
      if(ticket===request.current){setFolders(value=>[...value,...(result.files||[])]);setPage(result.nextPageToken);}
    }catch(error){if(ticket===request.current)setError(String(error));}
    finally{if(ticket===request.current)setLoading(false);}
  };
  const locate=async()=>{
    const id=driveFolderId(folderLink);
    if(!id){setError(t("cloud.invalidFolder"));return;}
    const ticket=++request.current;setLoading(true);setError("");
    try{
      const folder=await driveCommand<DriveFolder>({action:"folder",email,folderId:id});
      if(ticket===request.current){setSelected(folder);setPath(folder.id==="root"?[folder]:[{id:"root",name:t("cloud.myDrive")},folder]);setSaved(false);}
    }catch(error){if(ticket===request.current)setError(String(error));}
    finally{if(ticket===request.current)setLoading(false);}
  };
  const save=async()=>{
    if(!email||!selected)return;
    setSaving(true);setSaved(false);setError("");
    try{await saveDriveConfig({email,folderId:selected.id,folderName:selected.name,mode,emails:mode==="emails"?driveEmails(emails):[]});setSaved(true);}
    catch(error){setError(String(error));}finally{setSaving(false);}
  };

  return <div className="mx-auto max-w-3xl space-y-6">
    <header><h3 className="text-lg font-semibold">{t("cloud.title")}</h3><p className="mt-1 text-xs text-zinc-500">{t("cloud.description")}</p></header>
    <CloudUploadDetails/>
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><div className="text-sm font-medium">Google Drive</div><div className="break-all text-xs text-zinc-400">{email||t("cloud.notConnected")}</div></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-btn-secondary" disabled={!ready||!configured||locked} onClick={()=>void connectDrive()}>{connecting?<Loader2 className="h-4 w-4 animate-spin"/>:null}{t(email?"cloud.changeAccount":"cloud.connect")}</button>
          {connecting?<button type="button" className="ui-btn-ghost" onClick={()=>void invoke("google_sheets_cancel_connect").catch(error=>setError(String(error)))}>{t("cloud.cancel")}</button>:email&&<button type="button" className="ui-btn-ghost" disabled={locked} onClick={()=>void disconnectDrive().catch(error=>setError(String(error)))}>{t("cloud.disconnect")}</button>}
        </div>
      </div>
      {ready&&!configured&&<p className="text-xs text-amber-500">{t("cloud.oauthMissing")}</p>}
      {needsAccess&&<p className="text-xs text-amber-500">{t("cloud.reauthorize")}</p>}
      {accountError&&<p role="alert" className="break-words text-xs text-red-400">{accountError}</p>}
    </section>
    {email&&!needsAccess&&<fieldset disabled={locked} className="min-w-0 space-y-5 disabled:opacity-60">
      <section className="space-y-3 border-t border-zinc-800 pt-4">
        <h4 className="text-sm font-medium">{t("cloud.folder")}</h4>
        <div className="flex min-w-0 gap-2"><input aria-label={t("cloud.folderLink")} className="ui-control min-w-0 flex-1 px-3" placeholder={t("cloud.folderLink")} value={folderLink} onChange={event=>setFolderLink(event.target.value)}/><button type="button" className="ui-btn-secondary shrink-0" disabled={!folderLink.trim()||loading} onClick={()=>void locate()}>{t("cloud.locate")}</button></div>
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <nav aria-label={t("cloud.folder")} className="flex flex-wrap items-center gap-1 bg-zinc-800/30 px-3 py-2 text-xs">
            {path.map((folder,index)=><span key={`${folder.id}-${index}`} className="flex min-w-0 items-center gap-1">{index>0&&<ChevronRight className="h-3 w-3 shrink-0"/>}<button type="button" className="max-w-48 truncate hover:text-brand" disabled={loading} onClick={()=>setPath(value=>value.slice(0,index+1))}>{folder.name}</button></span>)}
          </nav>
          <div className="max-h-52 overflow-y-auto p-1">
            {folders.map(folder=><button type="button" key={folder.id} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-zinc-800" disabled={loading} onClick={()=>setPath(value=>[...value,folder])}><Folder className="h-4 w-4 shrink-0 text-brand"/><span className="min-w-0 flex-1 truncate">{folder.name}</span><ChevronRight className="h-3 w-3 shrink-0"/></button>)}
            {loading?<p role="status" className="flex items-center gap-2 p-3 text-xs text-zinc-500"><Loader2 className="h-3 w-3 animate-spin"/>{t("cloud.loading")}</p>:!folders.length&&<p className="p-3 text-xs text-zinc-500">{t("cloud.noFolders")}</p>}
            {page&&!loading&&<button type="button" className="ui-btn-ghost w-full" onClick={()=>void more()}>{t("cloud.more")}</button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="break-all text-zinc-400">{t("cloud.selected")}: {selected?.name||"—"}</span><button type="button" className="ui-btn-secondary" disabled={loading||!current} onClick={()=>{setSelected(current!);setSaved(false);}}>{t("cloud.useFolder")}</button></div>
      </section>
      <section className="space-y-3 border-t border-zinc-800 pt-4">
        <h4 className="text-sm font-medium">{t("cloud.sharing")}</h4>
        <div className="flex flex-wrap gap-4 text-sm">{(["emails","public"] as const).map(value=><label key={value} className="flex cursor-pointer items-center gap-2"><input type="radio" name="drive-sharing" value={value} checked={mode===value} onChange={()=>{setMode(value);setSaved(false);}}/>{t(value==="emails"?"cloud.restricted":"cloud.public")}</label>)}</div>
        {mode==="emails"?<><input aria-label={t("cloud.emails")} className="ui-control w-full px-3" value={emails} placeholder={t("cloud.emails")} onChange={event=>{setEmails(event.target.value);setSaved(false);}}/><p className="text-xs leading-5 text-zinc-500">{t("cloud.privateHint")}</p></>:<p className="text-xs leading-5 text-amber-500">{t("cloud.publicHint")}</p>}
      </section>
      <div className="flex items-center gap-3"><button type="button" className="ui-btn-primary" disabled={!selected||loading} onClick={()=>void save()}>{saving?<Loader2 className="h-4 w-4 animate-spin"/>:null}{t("cloud.save")}</button>{saved&&<span role="status" className="text-xs text-brand">{t("cloud.saved")}</span>}</div>
    </fieldset>}
    {error&&<p role="alert" className="break-words text-xs text-red-400">{error}</p>}
    <p className="text-xs leading-5 text-zinc-500">{t("cloud.linkHint")}</p>
  </div>;
}
