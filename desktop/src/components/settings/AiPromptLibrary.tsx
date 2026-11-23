import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, FileText, Folder, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { resolveFolderAiProfile, type AiPromptFolder, type AiPromptTemplate } from "@/lib/aiPromptScope";
import { promptPlanTemplateIds } from "@/lib/promptPlans";
import type { AppSettings } from "@/store/types";

const ALL_FOLDERS = "__all_prompt_folders__";
const UNFILED = "__unfiled_prompt_templates__";
const TREE_INDENT = 16;
const TREE_CHILD_INDENT = 24;

function flattenPromptFolders(folders: AiPromptFolder[], parentId?: string, depth = 0, collapsed = new Set<string>()): Array<{ folder: AiPromptFolder; depth: number }> {
  return folders.filter(folder => folder.parentId === parentId).flatMap(folder => [
    { folder, depth },
    ...(collapsed.has(folder.id) ? [] : flattenPromptFolders(folders, folder.id, depth + 1, collapsed)),
  ]);
}

type PromptTreeRow = { kind: "folder"; folder: AiPromptFolder; depth: number } | { kind: "template"; template: AiPromptTemplate; depth: number };
function flattenPromptTree(folders: AiPromptFolder[], templates: AiPromptTemplate[], parentId: string | undefined, depth: number, collapsed: Set<string>, search: string): PromptTreeRow[] {
  return folders.filter(folder => folder.parentId === parentId).flatMap(folder => [
    { kind: "folder" as const, folder, depth },
    ...(collapsed.has(folder.id) ? [] : [
      ...flattenPromptTree(folders, templates, folder.id, depth + 1, collapsed, search),
      ...templates.filter(template => template.folderId === folder.id && template.name.toLocaleLowerCase().includes(search))
        .map(template => ({ kind: "template" as const, template, depth: depth + 1 })),
    ]),
  ]);
}

function templateInUse(settings: AppSettings, id: string) {
  return settings.chatFolders.some(folder => folder.aiPromptTemplateId === id || promptPlanTemplateIds(folder.aiPromptPlan).includes(id))
    || Object.values(settings.aiPromptPlanByChat || {}).some(plan => promptPlanTemplateIds(plan).includes(id))
    || (settings.aiPromptPlans || []).some(plan => promptPlanTemplateIds(plan.plan).includes(id));
}

function templateMatchesFolder(template: AiPromptTemplate, folderId: string) {
  return folderId === ALL_FOLDERS || (folderId === UNFILED ? !template.folderId : template.folderId === folderId);
}

export function AiPromptLibrary({ initiallyOpen = false, fill = false }: { initiallyOpen?: boolean; fill?: boolean } = {}) {
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings),templates=settings.aiPromptTemplates||[],folders=settings.chatFolders;
  const promptFolders=settings.aiPromptFolders||[];
  const [id,setId]=useState(templates[0]?.id||""),[name,setName]=useState(templates[0]?.name||""),[prompt,setPrompt]=useState(templates[0]?.prompt||""),[templateFolderId,setTemplateFolderId]=useState(templates[0]?.folderId||"");
  const [query,setQuery]=useState(""),[folderFilter,setFolderFilter]=useState(ALL_FOLDERS);
  const [folderDraft,setFolderDraft]=useState<{id?:string;parentId?:string}|null>(null),[folderName,setFolderName]=useState("");
  const [collapsedFolderIds,setCollapsedFolderIds]=useState<Set<string>>(()=>new Set());
  const selected = templates.find(item => item.id === id);
  const dirty = name !== (selected?.name || "") || prompt !== (selected?.prompt || "") || templateFolderId !== (selected?.folderId || "");
  const used=!!id && templateInUse(settings,id);
  const affected=id?folders.filter(folder=>resolveFolderAiProfile(settings,folder.id,folder.scope?.type==="account"?folder.scope.accountId:settings.liveBaileysAccountId).templateIds?.includes(id)):[];
  const load=(nextId:string)=>{
    const template=templates.find(item=>item.id===nextId);
    setId(nextId);setName(template?.name||"");setPrompt(template?.prompt||"");setTemplateFolderId(template?.folderId||"");
  };
  const selectTemplate = async (nextId: string) => {
    if (nextId === id && nextId !== "") return true;
    if (dirty && !await useAppStore.getState().requestConfirm({
      title: t("aiLibrary.unsavedDraft"),
      description: t("aiLibrary.discardDescription"),
      confirmLabel: t("aiLibrary.discardDraft"),
      cancelLabel: t("settings.keepEditing"),
      tone: "danger",
    })) return false;
    load(nextId);
    return true;
  };
  const expandFolderPath=(folderId?:string)=>{
    const openIds=new Set([ALL_FOLDERS]);
    if(folderId){
      const byId=new Map(promptFolders.map(folder=>[folder.id,folder]));
      let current=byId.get(folderId);const seen=new Set<string>();
      while(current&&!seen.has(current.id)){seen.add(current.id);openIds.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}
    }else openIds.add(UNFILED);
    setCollapsedFolderIds(current=>{const next=new Set(current);for(const openId of openIds)next.delete(openId);return next;});
  };
  const startNewTemplate = async () => {
    const targetFolder = promptFolders.some(folder => folder.id === folderFilter) ? folderFilter : "";
    if (id === "" && !dirty) {
      setQuery("");setTemplateFolderId(targetFolder);
      expandFolderPath(targetFolder);
      return;
    }
    if (await selectTemplate("")) {
      setQuery("");setTemplateFolderId(targetFolder);
      expandFolderPath(targetFolder);
    }
  };
  const selectFolder = async (nextFolderId: string) => {
    if (nextFolderId === folderFilter) return;
    if (dirty && !await useAppStore.getState().requestConfirm({
      title: t("aiLibrary.unsavedDraft"),
      description: t("aiLibrary.discardDescription"),
      confirmLabel: t("aiLibrary.discardDraft"),
      cancelLabel: t("settings.keepEditing"),
      tone: "danger",
    })) return;
    setFolderFilter(nextFolderId);setQuery("");
    expandFolderPath(nextFolderId===ALL_FOLDERS||nextFolderId===UNFILED?undefined:nextFolderId);
    const first = templates.find(template => templateMatchesFolder(template,nextFolderId));
    load(first?.id||"");
  };
  const chooseTemplate=async(template:AiPromptTemplate)=>{
    if(!await selectTemplate(template.id))return;
    const target=template.folderId||UNFILED;
    setFolderFilter(target);expandFolderPath(template.folderId);
  };
  const save=()=>{
    if(!name.trim()||!prompt.trim())return;
    const current=useAppStore.getState(),library=current.settings.aiPromptTemplates||[];
    if(!id&&library.length>=100){current.pushToast(t("aiLibrary.capacity"),"error");return;}
    if (id && !library.some(item => item.id === id)) return;
    const currentFolders=current.settings.aiPromptFolders||[];
    const folderId=templateFolderId&&currentFolders.some(folder=>folder.id===templateFolderId)?templateFolderId:undefined;
    const template={id:id||crypto.randomUUID(),name:name.trim().slice(0,80),prompt:prompt.trim().slice(0,6000),...(folderId?{folderId}:{})};
    current.updateSettings({aiPromptTemplates:id?library.map(item=>item.id===id?template:item):[...library,template]});
    setId(template.id);setName(template.name);setPrompt(template.prompt);setTemplateFolderId(folderId||"");
    expandFolderPath(folderId);
    if(folderFilter!==ALL_FOLDERS&&!templateMatchesFolder(template,folderFilter)){setFolderFilter(folderId||UNFILED);setQuery("");}
  };
  const beginFolderDraft=(parentId?:string)=>{
    setFolderName("");setFolderDraft({parentId});
    if(parentId)expandFolderPath(parentId);
  };
  const beginFolderRename=(folder:AiPromptFolder)=>{setFolderName(folder.name);setFolderDraft({id:folder.id,parentId:folder.parentId});};
  const saveFolder=()=>{
    const cleanName=folderName.trim().slice(0,80);
    if(!cleanName||!folderDraft)return;
    const current=useAppStore.getState(),currentFolders=current.settings.aiPromptFolders||[];
    if(!folderDraft.id&&currentFolders.length>=100){current.pushToast(t("aiLibrary.folder.capacity"),"error");return;}
    const duplicate=currentFolders.some(folder=>folder.id!==folderDraft.id&&folder.parentId===folderDraft.parentId&&folder.name.toLocaleLowerCase()===cleanName.toLocaleLowerCase());
    if(duplicate){current.pushToast(t("aiLibrary.folder.duplicate"),"error");return;}
    if(folderDraft.id){
      current.updateSettings({aiPromptFolders:currentFolders.map(folder=>folder.id===folderDraft.id?{...folder,name:cleanName}:folder)});
    }else{
      const folder={id:crypto.randomUUID(),name:cleanName,...(folderDraft.parentId?{parentId:folderDraft.parentId}:{})};
      current.updateSettings({aiPromptFolders:[...currentFolders,folder]});
    }
    expandFolderPath(folderDraft.parentId);
    setFolderDraft(null);setFolderName("");
  };
  const deleteFolder=async(folder:AiPromptFolder)=>{
    const state=useAppStore.getState();
    if(!await state.requestConfirm({title:t("aiLibrary.folder.deleteTitle",{name:folder.name}),description:t("aiLibrary.folder.deleteHint"),confirmLabel:t("common.delete"),tone:"danger"}))return;
    const current=useAppStore.getState(),currentFolders=current.settings.aiPromptFolders||[],currentTemplates=current.settings.aiPromptTemplates||[];
    const currentFolder=currentFolders.find(item=>item.id===folder.id);
    if(!currentFolder)return;
    const parentId=currentFolder.parentId;
    const nextFolders=currentFolders.filter(item=>item.id!==folder.id).map(item=>item.parentId===folder.id?{...item,parentId}:item);
    const nextTemplates=currentTemplates.map(item=>item.folderId===folder.id?{...item,folderId:parentId}:item);
    current.updateSettings({aiPromptFolders:nextFolders,aiPromptTemplates:nextTemplates});
    if(folderFilter===folder.id)setFolderFilter(parentId||ALL_FOLDERS);
    expandFolderPath(parentId);
    if(templateFolderId===folder.id)setTemplateFolderId(parentId||"");
    if(folderDraft?.id===folder.id)setFolderDraft(null);
  };
  const folderCounts=new Map<string,number>();
  for(const template of templates)if(template.folderId)folderCounts.set(template.folderId,(folderCounts.get(template.folderId)||0)+1);
  const flatFolders=flattenPromptFolders(promptFolders);
  const searchTerm=query.trim().toLocaleLowerCase();
  const unfiledTemplates=templates.filter(template=>!template.folderId&&template.name.toLocaleLowerCase().includes(searchTerm));
  const unfiledCount=templates.filter(template=>!template.folderId).length;
  const visibleFolderRows=flattenPromptTree(promptFolders,templates,undefined,1,collapsedFolderIds,searchTerm);
  const allHasChildren=promptFolders.some(folder=>!folder.parentId)||unfiledCount>0;
  const selectedFolderIsReal=promptFolders.some(folder=>folder.id===folderFilter);
  const selectedFolderDepth=flatFolders.find(item=>item.folder.id===folderFilter)?.depth??-1;
  const canCreateFolder=promptFolders.length<100&&!folderDraft;
  const title = `${t("aiLibrary.title")} · ${templates.length}`;
  const content = <>
    <p className="mt-2 shrink-0 text-2xs text-zinc-500">{t("aiLibrary.hint")}</p>
    <div className={`mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,2fr)] ${fill ? "min-h-0 flex-1" : ""}`}>
      <aside className={fill ? "flex min-h-0 min-w-0 flex-col p-3" : "min-w-0 self-start p-3"}>
        <div className="flex flex-col gap-2">
          <Input className="min-w-0" value={query} placeholder={t("aiLibrary.search")} aria-label={t("aiLibrary.search")} onChange={event=>setQuery(event.target.value)} />
          <Button disabled={templates.length >= 100} onClick={()=>void startNewTemplate()}>{t("aiLibrary.new")}</Button>
        </div>
        <div className={`mt-3 border-t border-zinc-800 pt-2 ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-2xs font-semibold text-zinc-500">{t("aiLibrary.folders")}</p>
            <Button size="xs" variant="ghost" disabled={!canCreateFolder||selectedFolderIsReal&&selectedFolderDepth>=15} aria-label={t(selectedFolderIsReal?"aiLibrary.folder.subfolder":"aiLibrary.folder.new")} title={t(selectedFolderIsReal?"aiLibrary.folder.subfolder":"aiLibrary.folder.new")} onClick={()=>beginFolderDraft(selectedFolderIsReal?folderFilter:undefined)}><FolderPlus className="h-4 w-4" /></Button>
          </div>
          {folderDraft && <div className="mb-2 space-y-1">
            <Input autoFocus maxLength={80} value={folderName} aria-label={t("aiLibrary.folder.name")} placeholder={t("aiLibrary.folder.name")} onChange={event=>setFolderName(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();saveFolder();}if(event.key==="Escape")setFolderDraft(null);}} />
            <div className="flex gap-1"><Button size="sm" variant="primary" disabled={!folderName.trim()} aria-label={t("dialog.save")} title={t("dialog.save")} onClick={saveFolder}><Check className="h-4 w-4" /></Button><Button size="sm" aria-label={t("common.cancel")} title={t("common.cancel")} onClick={()=>setFolderDraft(null)}><X className="h-4 w-4" /></Button></div>
          </div>}
          <div role="tree" aria-label={t("aiLibrary.folders")} className={`space-y-1 overflow-y-auto ${fill ? "min-h-0 flex-1" : "max-h-[28rem]"}`}>
            <div role="treeitem" aria-level={1} aria-expanded={allHasChildren? !collapsedFolderIds.has(ALL_FOLDERS):undefined} className="flex min-w-0 items-center gap-1">
              {allHasChildren?<Button size="xs" variant="ghost" className="!min-h-0 h-5 w-5 shrink-0 p-0" aria-label={t(collapsedFolderIds.has(ALL_FOLDERS)?"aiLibrary.folder.expand":"aiLibrary.folder.collapse",{name:t("aiLibrary.all")})} onClick={()=>setCollapsedFolderIds(current=>{const next=new Set(current);if(next.has(ALL_FOLDERS))next.delete(ALL_FOLDERS);else next.add(ALL_FOLDERS);return next;})}>{collapsedFolderIds.has(ALL_FOLDERS)?<ChevronRight className="h-3.5 w-3.5"/>:<ChevronDown className="h-3.5 w-3.5"/>}</Button>:<span className="h-5 w-5 shrink-0"/>}
              <Button size="sm" variant={folderFilter===ALL_FOLDERS?"primary":"ghost"} className="min-w-0 flex-1 justify-start" aria-pressed={folderFilter===ALL_FOLDERS} onClick={()=>void selectFolder(ALL_FOLDERS)}><Folder className="mr-1.5 h-3.5 w-3.5" />{t("aiLibrary.all")}<span className="ml-auto">{templates.length}</span></Button>
            </div>
            {!collapsedFolderIds.has(ALL_FOLDERS)&&<>
              <div role="treeitem" aria-level={2} aria-expanded={unfiledCount>0? !collapsedFolderIds.has(UNFILED):undefined} className="flex min-w-0 items-center gap-1" style={{marginLeft:TREE_INDENT}}>
                {unfiledCount>0?<Button size="xs" variant="ghost" className="!min-h-0 h-5 w-5 shrink-0 p-0" aria-label={t(collapsedFolderIds.has(UNFILED)?"aiLibrary.folder.expand":"aiLibrary.folder.collapse",{name:t("aiLibrary.unfiled")})} onClick={()=>setCollapsedFolderIds(current=>{const next=new Set(current);if(next.has(UNFILED))next.delete(UNFILED);else next.add(UNFILED);return next;})}>{collapsedFolderIds.has(UNFILED)?<ChevronRight className="h-3.5 w-3.5"/>:<ChevronDown className="h-3.5 w-3.5"/>}</Button>:<span className="h-5 w-5 shrink-0"/>}
                <Button size="sm" variant={folderFilter===UNFILED?"primary":"ghost"} className="min-w-0 flex-1 justify-start" aria-pressed={folderFilter===UNFILED} onClick={()=>void selectFolder(UNFILED)}><Folder className="mr-1.5 h-3.5 w-3.5" />{t("aiLibrary.unfiled")}<span className="ml-auto">{unfiledCount}</span></Button>
              </div>
              {!collapsedFolderIds.has(UNFILED)&&unfiledTemplates.map(template=><div key={template.id} role="treeitem" aria-level={3} aria-selected={id===template.id} style={{marginLeft:TREE_INDENT+TREE_CHILD_INDENT*2}}>
                <Button size="sm" data-prompt-template={template.id} aria-label={`${t("aiLibrary.choose")}: ${template.name}`} aria-pressed={id===template.id} variant={id===template.id?"primary":"ghost"} className="h-auto w-full min-w-0 justify-start gap-1.5 px-2 text-left" onClick={()=>void chooseTemplate(template)}><FileText className="h-3.5 w-3.5 shrink-0"/><span className="truncate font-medium">{template.name}</span></Button>
              </div>)}
              {visibleFolderRows.map(row=>{
                if(row.kind==="template")return <div key={`template:${row.template.id}`} role="treeitem" aria-level={row.depth+1} aria-selected={id===row.template.id} style={{marginLeft:TREE_INDENT+row.depth*TREE_CHILD_INDENT}}>
                  <Button size="sm" data-prompt-template={row.template.id} aria-label={`${t("aiLibrary.choose")}: ${row.template.name}`} aria-pressed={id===row.template.id} variant={id===row.template.id?"primary":"ghost"} className="h-auto w-full min-w-0 justify-start gap-1.5 px-2 text-left" onClick={()=>void chooseTemplate(row.template)}><FileText className="h-3.5 w-3.5 shrink-0"/><span className="truncate font-medium">{row.template.name}</span></Button>
                </div>;
                const folder=row.folder;
                const hasChildren=promptFolders.some(item=>item.parentId===folder.id)||templates.some(item=>item.folderId===folder.id);
                const isCollapsed=collapsedFolderIds.has(folder.id);
                const isSelected=folderFilter===folder.id;
                return <div key={`folder:${folder.id}`} role="treeitem" aria-level={row.depth+1} aria-expanded={hasChildren?!isCollapsed:undefined} className="flex min-w-0 items-center gap-1" style={{marginLeft:TREE_INDENT+(row.depth-1)*TREE_CHILD_INDENT}}>
                  {hasChildren?<Button size="xs" variant="ghost" className="!min-h-0 h-5 w-5 shrink-0 p-0" aria-label={t(isCollapsed?"aiLibrary.folder.expand":"aiLibrary.folder.collapse",{name:folder.name})} onClick={()=>setCollapsedFolderIds(current=>{const next=new Set(current);if(next.has(folder.id))next.delete(folder.id);else next.add(folder.id);return next;})}>{isCollapsed?<ChevronRight className="h-3.5 w-3.5"/>:<ChevronDown className="h-3.5 w-3.5"/>}</Button>:<span className="h-5 w-5 shrink-0"/>}
                  <Button size="sm" variant={isSelected?"primary":"ghost"} className="min-w-0 flex-1 justify-start truncate px-2" aria-pressed={isSelected} onClick={()=>void selectFolder(folder.id)}><Folder className="mr-1.5 h-3.5 w-3.5 shrink-0" /><span className="truncate">{folder.name}</span><span className="ml-auto pl-1">{folderCounts.get(folder.id)||0}</span></Button>
                  {isSelected&&<><Button size="xs" variant="ghost" disabled={!!folderDraft} aria-label={t("aiLibrary.folder.rename",{name:folder.name})} title={t("aiLibrary.folder.rename",{name:folder.name})} onClick={()=>beginFolderRename(folder)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="xs" variant="ghost" disabled={!!folderDraft} aria-label={t("aiLibrary.folder.deleteTitle",{name:folder.name})} title={t("aiLibrary.folder.deleteTitle",{name:folder.name})} onClick={()=>void deleteFolder(folder)}><Trash2 className="h-3.5 w-3.5" /></Button></>}
                </div>;
              })}
            </>}
            {searchTerm&&!templates.some(template=>template.name.toLocaleLowerCase().includes(searchTerm))&&<p className="px-2 py-3 text-xs text-zinc-500">{t("aiLibrary.noResults")}</p>}
          </div>
        </div>
      </aside>
      <section className={fill ? "flex min-h-0 min-w-0 flex-col space-y-2" : "min-w-0 space-y-2"}>
        <h4 className="text-sm font-semibold">{id ? selected?.name || name : t("aiLibrary.new")}</h4>
        <Input maxLength={80} value={name} aria-label={t("aiLibrary.name")} placeholder={t("aiLibrary.name")} onChange={event=>setName(event.target.value)} />
        <label className="block text-xs text-zinc-500">{t("aiLibrary.folder")}
          <select className="ui-control mt-1 w-full px-2 py-2" value={templateFolderId} onChange={event=>setTemplateFolderId(event.target.value)}>
            <option value="">{t("aiLibrary.unfiled")}</option>
            {flatFolders.map(({folder,depth})=><option key={folder.id} value={folder.id}>{`${"　".repeat(depth)}${folder.name}`}</option>)}
          </select>
        </label>
        <Textarea className={fill ? "min-h-64 flex-1" : "min-h-64"} maxLength={6000} rows={12} value={prompt} aria-label={t("folderAi.prompt")} onChange={event=>setPrompt(event.target.value)} />
        <p className="text-2xs text-zinc-500">{t("aiLibrary.used",{count:affected.length})}{affected.length?` · ${affected.map(item=>item.name).join("、")}`:""}</p>
        {dirty && <p role="status" className="text-2xs text-amber-500">{t("aiLibrary.unsavedDraft")}</p>}
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!name.trim()||!prompt.trim()||!!id&&!selected} onClick={save}>{t(id ? "dialog.save" : "aiLibrary.createAndSave")}</Button>
          <Button size="sm" disabled={!id||!prompt.trim()||templates.length>=100} aria-label={t("aiLibrary.copy")} title={t("aiLibrary.copy")} onClick={()=>{setId("");setName(`${name} (copy)`.slice(0,80));}}><Copy className="h-4 w-4" /></Button>
          <Button size="sm" disabled={!id||used} aria-label={t("common.delete")} title={used?t("aiLibrary.inUse"):t("common.delete")} onClick={()=>{
            const current=useAppStore.getState();if(templateInUse(current.settings,id))return;
            const remaining=current.settings.aiPromptTemplates.filter(item=>item.id!==id);
            current.updateSettings({aiPromptTemplates:remaining});load(remaining[0]?.id||"");
          }}><Trash2 className="h-4 w-4" /></Button></div>
      </section>
    </div>
  </>;
  return fill ? <div className="flex min-h-0 flex-1 flex-col border-y border-zinc-800 py-3">
    <h4 className="flex shrink-0 items-center gap-1 cursor-default text-[13px] font-semibold"><ChevronDown className="h-3.5 w-3.5" />{title}</h4>
    {content}
  </div> : <details open={initiallyOpen || undefined} className="border-y border-zinc-800 py-3">
    <summary className="cursor-pointer text-[13px] font-semibold">{title}</summary>
    {content}
  </details>;
}
