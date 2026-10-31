import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { DuplicateScheduledPlanError, saveScheduledPlan } from "@/lib/scheduledPlanActions";
import { scheduledFolderChatIds, scheduledPlanTargets, MAX_SCHEDULED_PLAN_ITEMS, MIN_SCHEDULED_GAP_SEC, MAX_PLAN_STEPS, type ScheduledPlan, type ScheduledPlanStep } from "@/lib/scheduledPlans";

function localTime() {
  const date = new Date(Date.now() + 5 * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ScheduledPlanDialog({ chatIds, folderId, initialText = "", initialStartNow = false, onClose }: {
  chatIds?: string[]; folderId?: string; initialText?: string; initialStartNow?: boolean; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const settings = useAppStore(s => s.settings);
  const chats = useAppStore(s => s.chats);
  const contacts = useAppStore(s => s.contacts);
  const pushToast = useAppStore(s => s.pushToast);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [selected, setSelected] = useState(() => new Set(chatIds || (folderId ? scheduledFolderChatIds(settings, folderId, false) : [])));
  const [query, setQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState(initialText);
  const [media, setMedia] = useState<ScheduledPlan["media"]>();
  const [steps,setSteps] = useState<ScheduledPlanStep[]>([]);
  const [endAt,setEndAt] = useState("");
  const [quiet,setQuiet] = useState(false);
  const [quietStart,setQuietStart] = useState("22:00");
  const [quietEnd,setQuietEnd] = useState("08:00");
  const [nativeMedia,setNativeMedia] = useState(false);
  const [dueAt, setDueAt] = useState(localTime);
  const [startNow, setStartNow] = useState(initialStartNow);
  const [gapSec, setGapSec] = useState(30);
  const [page, setPage] = useState(0);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [duplicateIds,setDuplicateIds] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const readerRef = useRef<FileReader | null>(null);
  const fileStep = useRef(0);
  const dueAtInput = useRef<HTMLInputElement>(null);
  const gapInput = useRef<HTMLInputElement>(null);
  const folder = settings.chatFolders.find(item => item.id === folderId);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const candidates = useMemo(() => {
    const ids = folderId ? scheduledFolderChatIds(settings, folderId, includeChildren) : chatIds;
    const all = scheduledPlanTargets({ settings, chats, contacts }, ids);
    if (!folder || folder.scope?.type === "all") return all;
    const owner = folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default";
    return all.filter(item => item.accountId === owner);
  }, [settings, chats, contacts, chatIds, folderId, includeChildren]);
  const chosen = candidates.filter(item => selected.has(item.chatId));
  const visible = candidates.filter(item => (!review || selected.has(item.chatId)) && `${item.contactName}\n${item.recipient}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 50) - 1));
  const pageItems = visible.slice(currentPage * 50, currentPage * 50 + 50);
  const sequence = [{text,media},...steps].flatMap(s=>nativeMedia&&s.media?.kind==="audio"&&s.text.trim()?[{text:s.text},{...s,text:""}]:[s]);
  const contentValid = sequence.length<=MAX_PLAN_STEPS && sequence.every(s=>(!!s.text.trim()||!!s.media)&&s.text.length<=4000 && (s.gapSec===undefined||Number.isFinite(s.gapSec)&&s.gapSec>=20&&s.gapSec<=3600));
  const valid = chosen.length > 0 && chosen.length <= MAX_SCHEDULED_PLAN_ITEMS && contentValid && Number.isFinite(gapSec) && gapSec >= MIN_SCHEDULED_GAP_SEC && gapSec <= 3600 && (startNow || Date.parse(dueAt) > Date.now()) && (!endAt||Date.parse(endAt)>(startNow?Date.now():Date.parse(dueAt))) && (!quiet||quietStart!==quietEnd);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLElement>('input:not([type="file"]),textarea')?.focus();
    return () => { const reader = readerRef.current; readerRef.current = null; reader?.abort(); previous?.focus(); };
  }, []);

  return <div role="dialog" aria-modal="true" aria-labelledby="scheduled-plan-title" className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4"
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === "Tab") {
        const controls = Array.from(formRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled):not([type="file"]),button:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || []).filter(node => node.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <form ref={formRef} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
      onSubmit={event => {
        event.preventDefault(); if (busy || reading) return;
        if (!review) {
          // Native date/number editors can commit their last segment on submit, after the last React change event.
          const time = dueAtInput.current?.value || dueAt;
          const gap = Number(gapInput.current?.value ?? gapSec);
          if ((!startNow && !(Date.parse(time) > Date.now())) || gap < MIN_SCHEDULED_GAP_SEC || gap > 3600 || !Number.isFinite(gap)) { setError(t("planQueue.invalidTime")); return; }
          if (!chosen.length || chosen.length > MAX_SCHEDULED_PLAN_ITEMS || !contentValid) return;
          if (endAt && !(Date.parse(endAt)>Math.max(Date.now(),startNow?Date.now():Date.parse(time)))) {setError(t("planQueue.invalidDeadline"));return;}
          setDueAt(time); setGapSec(gap); setReview(true); setQuery(""); setPage(0); setError("");if(contentRef.current)contentRef.current.scrollTop=0; return;
        }
        if (valid) void save();
      }}>
      <header className="flex items-center justify-between border-b border-zinc-800 p-4">
        <h2 id="scheduled-plan-title" className="font-semibold text-zinc-100">{t(review ? "planQueue.preview" : startNow ? "planQueue.bulkTitle" : "planQueue.create")}</h2>
        <Button disabled={busy} variant="ghost" onClick={onClose}>{t("common.close")}</Button>
      </header>
      <div ref={contentRef} className="grid min-h-0 gap-5 overflow-y-auto p-4 md:grid-cols-2">
        <div className="space-y-3">
          {!review ? <>
            <label className="block space-y-1 text-xs text-zinc-400"><span>{t("planQueue.name")}</span><Input maxLength={80} value={title} onChange={event => setTitle(event.target.value)} /></label>
            <label className="block space-y-1 text-xs text-zinc-400"><span>{t("planQueue.template")}</span><Input placeholder={t("multi.searchQuickReplies")} value={templateQuery} onChange={event => setTemplateQuery(event.target.value)} />
              <select aria-label={t("planQueue.template")} className="ui-control w-full px-2" value="" onChange={event => {
                if (event.target.value.startsWith("plan:")) {
                  const plan=settings.scheduledPlans.find(p=>p.id===event.target.value.slice(5));
                  if(plan){cancelMediaRead();setTitle(plan.title);setText(plan.text);setMedia(plan.media);setSteps((plan.steps||[]).map(s=>({...s})));setNativeMedia(!!plan.nativeMedia);} return;
                }
                const template = settings.quickReplies.find(item => item.id === event.target.value);
                if (template) { cancelMediaRead(); setTitle(template.title); setText(template.body); setMedia(template.media ? { ...template.media } : undefined);setSteps([]); }
              }}>
                <option value="">{t("planQueue.pickTemplate")}</option>
                {settings.quickReplies.filter(item => `${item.title}\n${item.body}`.toLocaleLowerCase().includes(templateQuery.toLocaleLowerCase())).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                {(settings.scheduledPlans||[]).filter(p=>!p.mediaUnavailable&&p.title.toLocaleLowerCase().includes(templateQuery.toLocaleLowerCase())).map(p=><option key={p.id} value={"plan:"+p.id}>{t("planQueue.sequenceTemplate")} · {p.title}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-zinc-400"><span>{t("scheduled.message")} · {text.length}/4000</span><Textarea rows={6} maxLength={4000} value={text} onChange={event => setText(event.target.value)} /></label>
          </> : <><h3 className="font-medium text-zinc-100">{title || t("planQueue.create")}</h3>{sequence.length===1&&<p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{text}</p>}</>}
          {media && (!review||sequence.length===1) && <div className="space-y-2 rounded-lg border border-zinc-700 p-3">
            {media.kind === "image" ? <img src={media.dataUrl} alt={media.fileName} className="max-h-32 w-full object-contain" /> : media.kind === "audio" ? <audio controls src={media.dataUrl} className="w-full" /> : media.kind === "video" ? <video controls src={media.dataUrl} className="max-h-32 w-full" /> : null}
            <p className="break-all text-xs text-zinc-400">{media.fileName}</p>
            {!review && <Button size="sm" onClick={() => { cancelMediaRead(); setMedia(undefined); }}>{t("settingsQuickReplies.removeMedia")}</Button>}
          </div>}
          {!review && <><input ref={fileInput} type="file" className="hidden" aria-label={t("settingsQuickReplies.addMedia")} onChange={event => {
            const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) readMedia(file);
          }} /><Button size="sm" disabled={reading} onClick={() => {fileStep.current=0;fileInput.current?.click();}}>{t(reading ? "quickLibrary.readingMedia" : "settingsQuickReplies.addMedia")}</Button></>}
          {!review && !!steps.length && <Button size="sm" onClick={()=>moveStep(0,1)}>{t("planQueue.moveDown")}</Button>}
          {!review && steps.map((step,index)=><div key={index} className="space-y-2 rounded-lg border border-zinc-700 p-3">
            <p className="text-xs text-brand">{t("planQueue.stepNumber",{number:index+2})}</p>
            <select aria-label={t("planQueue.stepTemplate",{number:index+2})} className="ui-control w-full px-2" value="" onChange={e=>{const q=settings.quickReplies.find(q=>q.id===e.target.value);if(q){cancelMediaRead();setSteps(list=>list.map((s,i)=>i===index?{...s,text:q.body,media:q.media}:s));}}}>
              <option value="">{t("planQueue.pickTemplate")}</option>{settings.quickReplies.filter(q=>`${q.title}\n${q.body}`.toLocaleLowerCase().includes(templateQuery.toLocaleLowerCase())).map(q=><option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
            <Textarea rows={3} maxLength={4000} aria-label={t("planQueue.stepText",{number:index+2})} value={step.text} onChange={e=>setSteps(list=>list.map((s,i)=>i===index?{...s,text:e.target.value}:s))} />
            {step.media&&<><p className="break-all text-xs text-zinc-400">{step.media.fileName}</p>{step.media.kind==="image"&&<img src={step.media.dataUrl} alt={step.media.fileName} className="max-h-24 object-contain"/>}<Button size="sm" onClick={()=>{cancelMediaRead();setSteps(list=>list.map((s,i)=>i===index?{...s,media:undefined}:s));}}>{t("settingsQuickReplies.removeMedia")}</Button></>}
            <Input type="number" min={20} max={3600} aria-label={t("planQueue.stepGap",{number:index+2})} value={step.gapSec??gapSec} onInput={e=>setSteps(list=>list.map((s,i)=>i===index?{...s,gapSec:Number(e.currentTarget.value)}:s))}/>
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={reading} onClick={()=>{fileStep.current=index+1;fileInput.current?.click();}}>{t("settingsQuickReplies.addMedia")}</Button><Button size="sm" onClick={()=>moveStep(index+1,-1)}>{t("planQueue.moveUp")}</Button><Button size="sm" disabled={index===steps.length-1} onClick={()=>moveStep(index+1,1)}>{t("planQueue.moveDown")}</Button><Button size="sm" onClick={()=>{cancelMediaRead();setSteps(list=>list.filter((_,i)=>i!==index));}}>{t("common.delete")}</Button></div>
          </div>)}
          {!review&&<><Button size="sm" disabled={steps.length>=MAX_PLAN_STEPS-1||reading} onClick={()=>setSteps(list=>[...list,{text:""}])}>{t("planQueue.addStep")}</Button><label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={nativeMedia} onChange={e=>setNativeMedia(e.target.checked)}/>{t("planQueue.nativeMedia")}</label></>}
          {review&&sequence.length>1&&<div className="space-y-2 rounded border border-zinc-700 p-3">{sequence.map((s,index)=><div key={index} className="border-b border-zinc-800 py-2 text-sm"><p className="text-brand">{t("planQueue.stepNumber",{number:index+1})} · {s.gapSec||gapSec}s</p><p className="whitespace-pre-wrap">{s.text}</p>{s.media&&<><p>{s.media.fileName}</p>{s.media.kind==="image"?<img src={s.media.dataUrl} alt={s.media.fileName} className="max-h-32 object-contain"/>:s.media.kind==="audio"?<audio src={s.media.dataUrl} controls className="w-full"/>:s.media.kind==="video"?<video src={s.media.dataUrl} controls className="max-h-32 w-full"/>:null}</>}</div>)}</div>}
          <p className="text-xs text-zinc-500">{t(nativeMedia ? "planQueue.nativeHint" : "planQueue.mediaHint")}</p>
          {!review ? <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex gap-2">
              <Button size="sm" aria-pressed={startNow} variant={startNow ? "primary" : "secondary"} onClick={() => setStartNow(true)}>{t("planQueue.queueNow")}</Button>
              <Button size="sm" aria-pressed={!startNow} variant={!startNow ? "primary" : "secondary"} onClick={() => setStartNow(false)}>{t("scheduled.title")}</Button>
            </div>
            {!startNow && <label className="block space-y-1 text-xs text-zinc-400"><span>{t("planQueue.startTime")}</span><Input ref={dueAtInput} aria-label={t("planQueue.startTime")} type="datetime-local" required value={dueAt} onInput={event => setDueAt(event.currentTarget.value)} /></label>}
            <label className="block space-y-1 text-xs text-zinc-400"><span>{t("planQueue.gap")}</span><Input ref={gapInput} type="number" min={20} max={3600} required value={gapSec} onInput={event => setGapSec(Number(event.currentTarget.value))} /></label>
          </div> : <p className="text-sm text-brand">{startNow ? t("planQueue.queueNow") : new Date(dueAt).toLocaleString(locale, { timeZone }) + " · " + timeZone}<br />{t(sequence.length>1?"planQueue.defaultPace":"planQueue.pace", { seconds: gapSec })}</p>}
          {!review?<div className="space-y-2 text-xs text-zinc-400"><label className="block">{t("planQueue.deadline")}<Input type="datetime-local" value={endAt} onInput={e=>setEndAt(e.currentTarget.value)}/></label><label className="flex gap-2"><input type="checkbox" checked={quiet} onChange={e=>setQuiet(e.target.checked)}/>{t("planQueue.quietHours")}</label>{quiet&&<div className="flex gap-2"><Input type="time" aria-label={t("planQueue.quietStart")} value={quietStart} onInput={e=>setQuietStart(e.currentTarget.value)}/><Input type="time" aria-label={t("planQueue.quietEnd")} value={quietEnd} onInput={e=>setQuietEnd(e.currentTarget.value)}/></div>}</div>:<p className="text-xs text-zinc-400">{endAt&&t("planQueue.deadline")+": "+new Date(endAt).toLocaleString(locale)} {quiet&&`${quietStart}–${quietEnd} · ${timeZone}`}</p>}
          {startNow && <p className="text-xs text-zinc-500">{t("planQueue.queueNowHint")}</p>}
          <p className="text-xs text-zinc-500">{timeZone} · {t("planQueue.rules")}</p>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">{t("planQueue.targets", { count: chosen.length })} {folder ? "· " + folder.name : ""}</h3>
          {folderId && !review && <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" aria-label={t("planQueue.includeChildren")} checked={includeChildren} onChange={event => {
            const include = event.target.checked; setIncludeChildren(include); setSelected(new Set(scheduledFolderChatIds(settings, folderId, include))); setPage(0);
          }} />{t("planQueue.includeChildren")}</label>}
          <Input aria-label={t("planQueue.searchTargets")} placeholder={t("planQueue.searchTargets")} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
          {!review && !!pageItems.length && <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={pageItems.every(item => selected.has(item.chatId))} onChange={event => {
            const next = new Set(selected); pageItems.forEach(item => event.target.checked ? next.add(item.chatId) : next.delete(item.chatId)); setSelected(next);
          }} />{t("quickLibrary.selectPage")}</label>}
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-2">
            {pageItems.map((item, index) => <label key={item.id} className="flex items-start gap-2 rounded p-2 hover:bg-zinc-800">
              {!review && <input type="checkbox" className="mt-1" checked={selected.has(item.chatId)} onChange={event => { const next = new Set(selected); event.target.checked ? next.add(item.chatId) : next.delete(item.chatId); setSelected(next); }} />}
              <span className="min-w-0"><span className="block truncate text-sm text-zinc-200">{currentPage * 50 + index + 1}. {item.contactName}</span><span className="block truncate text-xs text-zinc-500">{settings.waAccounts.find(account => account.id === item.accountId)?.label || item.accountId} · {item.recipient}</span></span>
            </label>)}
            {!pageItems.length && <p className="p-4 text-xs text-zinc-500">{t("planQueue.noTargets")}</p>}
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-500"><Button size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>‹</Button><span>{currentPage + 1}/{Math.max(1, Math.ceil(visible.length / 50))}</span><Button size="sm" disabled={(currentPage + 1) * 50 >= visible.length} onClick={() => setPage(currentPage + 1)}>›</Button></div>
          <p className="text-xs text-zinc-500">{t("planQueue.snapshot")}</p>
          {chosen.length > 1000 && <p role="alert" className="text-xs text-rose-400">{t("planQueue.capacity")}</p>}
        </div>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 p-4">
        <p role="alert" className="text-xs text-rose-400">{error}</p>
        <div className="flex shrink-0 gap-2">{review && <Button disabled={busy} onClick={() => {setReview(false);setDuplicateIds([]);setError("");}}>{t("planQueue.back")}</Button>}<Button type="submit" variant="primary" disabled={!valid || busy || reading}>{t(busy ? "common.saving" : duplicateIds.length ? "planQueue.confirmDuplicate" : review ? startNow ? "planQueue.confirmBulk" : "planQueue.confirm" : "planQueue.preview")}</Button></div>
      </footer>
    </form>
  </div>;

  async function save() {
    setBusy(true); setError("");
    try {
      const input={ title: title.trim() || t(startNow ? "planQueue.bulkTitle" : "planQueue.create"), text:sequence[0].text, media:sequence[0].media,steps:sequence.length>1?sequence.slice(1):undefined,nativeMedia, dueAt: startNow ? new Date().toISOString() : new Date(dueAt).toISOString(), gapSec, timeZone, items: chosen,endAt:endAt?new Date(endAt).toISOString():undefined,quietHours:quiet?{start:quietStart,end:quietEnd}:undefined };
      try { await saveScheduledPlan(input,startNow,duplicateIds); }
      catch(error){
        if(!(error instanceof DuplicateScheduledPlanError))throw error;
        setDuplicateIds(ids=>[...new Set([...ids,...error.planIds])]);setError(error.message);return;
      }
      pushToast(t(startNow ? "planQueue.bulkQueued" : "planQueue.saved"), "success"); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : t("planQueue.failed")); }
    finally { setBusy(false); }
  }

  function readMedia(file: File) {
    if (file.size > 8 * 1024 * 1024) { setError(t("settingsQuickReplies.mediaTooLarge")); return; }
    setReading(true); setError("");
    const targetStep=fileStep.current;
    const reader = new FileReader(); readerRef.current = reader;
    reader.onload = () => { if (readerRef.current !== reader) return;const attachment:ScheduledPlan["media"]={ dataUrl: String(reader.result), fileName: file.name.slice(0, 180), mimeType: file.type || "application/octet-stream", size: file.size,
      kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "file" }; if(targetStep===0)setMedia(attachment);else setSteps(list=>list.map((s,i)=>i===targetStep-1?{...s,media:attachment}:s));setReading(false); };
    reader.onerror = () => { if (readerRef.current !== reader) return; setError(t("settingsQuickReplies.mediaReadFailed")); setReading(false); };
    reader.readAsDataURL(file);
  }
  function cancelMediaRead() {
    const reader = readerRef.current; readerRef.current = null; reader?.abort(); setReading(false);
  }
  function moveStep(index:number,delta:number){
    cancelMediaRead();const list:ScheduledPlanStep[]=[{text,media,gapSec},...steps.map(s=>({...s,gapSec:s.gapSec??gapSec}))];const other=index+delta;
    if(other<0||other>=list.length)return;[list[index],list[other]]=[list[other],list[index]];
    setText(list[0].text);setMedia(list[0].media);setGapSec(list[0].gapSec||gapSec);setSteps(list.slice(1));
  }
}
