import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CloudUpload, Copy, Loader2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { initializeDrive, reloadDriveJournal, retryDriveUpload, uploadContactAvatar, useGoogleDrive } from "@/lib/googleDrive";

export function CloudUploadStatus() {
  const { t } = useI18n();
  const menu = useGoogleDrive(state=>state.menu);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{void initializeDrive();},[]);
  useEffect(()=>{
    if(!menu)return;
    const previous=document.activeElement;
    menuRef.current?.querySelector("button")?.focus();
    const close=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))useGoogleDrive.setState({menu:null});};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();useGoogleDrive.setState({menu:null});if(previous instanceof HTMLElement)previous.focus();}};
    document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};
  },[menu]);
  useEffect(()=>()=>useGoogleDrive.setState({menu:null}),[]);
  return <>
    {menu&&createPortal(<div ref={menuRef} role="menu" className="fixed z-[230] rounded-lg border border-zinc-700 bg-zinc-900 p-1 text-xs text-zinc-100 shadow-xl" style={{left:Math.max(4,Math.min(menu.x,window.innerWidth-200)),top:Math.max(4,Math.min(menu.y,window.innerHeight-48))}}>
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-3 py-2 hover:bg-zinc-800" onClick={()=>{useGoogleDrive.setState({menu:null});void uploadContactAvatar(menu.contact,menu.accountId);}}><CloudUpload className="h-4 w-4"/>{t("cloud.upload")}</button>
    </div>,document.body)}
  </>;
}

export function CloudUploadBanner() {
  const { t } = useI18n();
  const job = useGoogleDrive(state => state.job);
  const busy = useGoogleDrive(state => state.uploadBusy);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job?.stage !== "done" || !job.completedAt) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, job.completedAt + 10_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [job?.id, job?.stage, job?.completedAt]);
  const doneVisible = job?.stage === "done" && Boolean(job.completedAt) && now < job.completedAt! + 10_000;
  if (!job || (job.stage === "done" && !doneVisible)) return null;
  const uploading = job.stage === "uploading";
  const percent = job.uploadProgress ?? 0;
  const copy = () => { void retryDriveUpload(job.id); };
  return <div role="region" aria-label={t("cloud.upload")} className="ml-auto flex min-w-0 max-w-[42vw] items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-1.5 text-[var(--app-text)] shadow-sm xl:max-w-[34rem]">
    {uploading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand"/> : job.stage === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand"/> : <CloudUpload className="h-4 w-4 shrink-0 text-amber-500"/>}
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-baseline gap-2 text-[11px] leading-4">
        <span className="shrink-0 font-medium">{t(`cloud.stage.${job.stage}`)}{uploading ? ` ${percent}%` : ""}</span>
        <span className="truncate text-[var(--app-muted)]">{job.title}</span>
      </div>
      {uploading && <div role="progressbar" aria-label={t("cloud.stage.uploading")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--app-border)]"><div className="h-full rounded-full bg-brand transition-[width]" style={{width:`${percent}%`}}/></div>}
      {job.stage === "done" && <div className="text-[10px] leading-3 text-[var(--app-muted)]">{t("cloud.copyAgainHint")}</div>}
      {job.error && <div role="alert" className="max-w-full truncate text-[10px] text-rose-500" title={job.error}>{job.error}</div>}
    </div>
    {job.shared && job.url && <button type="button" className="ui-btn-secondary !min-h-7 shrink-0 gap-1 px-2 text-[10px]" disabled={busy} onClick={copy}><Copy className="h-3 w-3"/>{t("cloud.copy")}</button>}
    {job.stage === "error" && !job.shared && <button type="button" className="ui-btn-secondary !min-h-7 shrink-0 px-2 text-[10px]" disabled={busy} onClick={copy}>{t("cloud.retry")}</button>}
  </div>;
}

export function CloudUploadDetails() {
  const {t}=useI18n();
  const jobs=useGoogleDrive(state=>state.jobs);
  const selected=useGoogleDrive(state=>state.selectedJobId);
  const job=useGoogleDrive(state=>state.selectedJobId==="hidden"?null:state.jobs.find(job=>job.id===state.selectedJobId)||state.job);
  const journalError=useGoogleDrive(state=>state.journalError);
  const busy=useGoogleDrive(state=>state.uploadBusy);
  return <div className="space-y-2">
    {jobs.length>0&&<label className="block text-xs text-zinc-400">{t("cloud.recentJobs")}<select aria-label={t("cloud.recentJobs")} className="ui-control mt-1 w-full px-2" value={selected||job?.id||"hidden"} onChange={event=>useGoogleDrive.setState({selectedJobId:event.target.value})}><option value="hidden">{t("cloud.chooseJob")}</option>{jobs.map(job=><option key={job.id} value={job.id}>{new Date(job.createdAt).toLocaleString()} · {job.title} · {t(`cloud.stage.${job.stage}`)}</option>)}</select></label>}
    {journalError&&<div role="alert" className="break-words text-xs text-red-400">{t("cloud.journalError")}：{journalError}<button type="button" className="ui-btn-secondary ml-2" disabled={busy} onClick={()=>void reloadDriveJournal()}>{t("cloud.reloadJournal")}</button></div>}
    {job&&<aside role="region" aria-label={t("cloud.upload")} className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100">
      <div className="flex items-start gap-2">{["reading","uploading","sharing","copying"].includes(job.stage)?<Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand"/>:job.stage==="done"?<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand"/>:<CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"/>}<div className="min-w-0 flex-1"><div role="status" aria-live="polite" className="text-sm font-medium">{t(`cloud.stage.${job.stage}`)}</div><div className="mt-1 truncate text-xs text-zinc-400">{job.title}</div></div><button type="button" className="ui-btn-ghost !h-6 !w-6 !p-0" aria-label={t("cloud.close")} disabled={busy} onClick={()=>useGoogleDrive.setState({selectedJobId:"hidden"})}><X className="h-4 w-4"/></button></div>
      <p className="mt-2 truncate text-xs text-zinc-500" title={`${job.config.email} · ${job.config.folderName}`}>{job.config.email} · {job.config.folderName}</p>
      <p className="mt-1 truncate text-xs text-zinc-500" title={job.config.emails.join(", ")}>{job.config.mode==="public"?t("cloud.public"):job.config.emails.join(", ")}</p>
      {job.error&&<p role="alert" className="mt-2 break-words text-xs leading-5 text-red-400">{job.error}</p>}
      {job.shared&&job.url&&<div className="mt-3 flex min-w-0 gap-1"><input aria-label={t("cloud.link")} readOnly className="ui-control min-w-0 flex-1 px-2 text-xs" value={job.url} onFocus={event=>event.target.select()}/><button type="button" className="ui-btn-secondary !px-2" title={t("cloud.copy")} aria-label={t("cloud.copy")} disabled={busy} onClick={()=>void retryDriveUpload(job.id)}><Copy className="h-4 w-4"/></button></div>}
      {!busy&&job.stage!=="done"&&<button type="button" className="ui-btn-secondary mt-3" onClick={()=>void retryDriveUpload(job.id)}>{t(job.shared?"cloud.copy":"cloud.retry")}</button>}
    </aside>}
    </div>;
}
