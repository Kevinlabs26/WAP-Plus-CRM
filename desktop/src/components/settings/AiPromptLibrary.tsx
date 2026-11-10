import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { resolveFolderAiProfile } from "@/lib/aiPromptScope";

export function AiPromptLibrary() {
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings),templates=settings.aiPromptTemplates||[],folders=settings.chatFolders;
  const [id,setId]=useState(""),[name,setName]=useState(""),[prompt,setPrompt]=useState(""),[query,setQuery]=useState("");
  const used=folders.filter(folder=>folder.aiPromptTemplateId===id);
  const affected=id?folders.filter(folder=>resolveFolderAiProfile(settings,folder.id,folder.scope?.type==="account"?folder.scope.accountId:settings.liveBaileysAccountId).templateIds?.includes(id)):[];
  const load=(id:string)=>{const template=templates.find(item=>item.id===id);setId(id);setName(template?.name||"");setPrompt(template?.prompt||"");};
  const save=()=>{
    if(!name.trim()||!prompt.trim())return;
    const current=useAppStore.getState(),library=current.settings.aiPromptTemplates||[];
    if(!id&&library.length>=100){current.pushToast(t("aiLibrary.capacity"),"error");return;}
    const template={id:id||crypto.randomUUID(),name:name.trim().slice(0,80),prompt:prompt.trim().slice(0,6000)};
    current.updateSettings({aiPromptTemplates:id?library.map(item=>item.id===id?template:item):[...library,template]});setId(template.id);
  };
  return <details className="rounded-xl border border-zinc-800 p-3">
    <summary className="cursor-pointer text-[13px] font-semibold">{t("aiLibrary.title")} · {templates.length}</summary>
    <p className="mt-2 text-2xs text-zinc-500">{t("aiLibrary.hint")}</p>
    <Input className="mt-2" value={query} placeholder={t("aiLibrary.search")} aria-label={t("aiLibrary.search")} onChange={event=>setQuery(event.target.value)} />
    <div className="mt-2 flex gap-2"><select aria-label={t("aiLibrary.choose")} className="ui-control min-w-0 flex-1 px-2 py-2" value={id} onChange={event=>load(event.target.value)}>
      <option value="">{t("aiLibrary.new")}</option>
      {templates.filter(item=>item.id===id||item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select><Button onClick={()=>load("")}>{t("aiLibrary.new")}</Button></div>
    <Input className="mt-2" maxLength={80} value={name} aria-label={t("aiLibrary.name")} placeholder={t("aiLibrary.name")} onChange={event=>setName(event.target.value)} />
    <Textarea className="mt-2 min-h-40" maxLength={6000} rows={6} value={prompt} aria-label={t("folderAi.prompt")} onChange={event=>setPrompt(event.target.value)} />
    <p className="mt-1 text-2xs text-zinc-500">{t("aiLibrary.used",{count:affected.length})}{affected.length?` · ${affected.map(item=>item.name).join("、")}`:""}</p>
    <div className="mt-2 flex flex-wrap gap-2"><Button variant="primary" disabled={!name.trim()||!prompt.trim()||!!id&&!templates.some(item=>item.id===id)} onClick={save}>{t("dialog.save")}</Button>
      <Button disabled={!id||!prompt.trim()||templates.length>=100} onClick={()=>{setId("");setName(`${name} (copy)`.slice(0,80));}}>{t("aiLibrary.copy")}</Button>
      <Button disabled={!id||!!used.length} title={used.length?t("aiLibrary.inUse"):undefined} onClick={()=>{
        const current=useAppStore.getState();if(current.settings.chatFolders.some(folder=>folder.aiPromptTemplateId===id))return;
        current.updateSettings({aiPromptTemplates:current.settings.aiPromptTemplates.filter(item=>item.id!==id)});load("");
      }}>{t("common.delete")}</Button></div>
  </details>;
}
