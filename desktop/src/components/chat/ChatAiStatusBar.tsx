import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useAutoReplyRuntime } from "@/lib/autoReplyRuntime";
import { resolveAiReplyProfile } from "@/lib/aiPromptScope";
import { resolveAutoReplyScope } from "@/lib/autoReplyScope";
import { getChatAiStatus } from "@/lib/aiReplyStatus";
import { FolderAiPromptDialog } from "@/components/layout/FolderAiPromptDialog";
import { useI18n } from "@/i18n";
import type { Message } from "@/types/crm";
import { Switch } from "@/components/ui/primitives";
import { recipientKey } from "@/lib/scheduledPlans";

export function ChatAiStatusBar({chatId,accountId,connected,thread,recipient}:{chatId:string;accountId:string;connected:boolean;thread:readonly Message[];recipient?:string}) {
  const {t}=useI18n();
  const settings=useAppStore(state=>state.settings);
  const runtime=useAutoReplyRuntime(state=>state.byChat[chatId]);
  const [editing,setEditing]=useState("");
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30_000);return()=>window.clearInterval(timer);},[]);
  const profile=resolveAiReplyProfile(settings,accountId,chatId);
  const scope=resolveAutoReplyScope(settings,chatId);
  const override=settings.aiAutoReplyManualChatIds?.includes(chatId)?"manual":settings.aiAutoReplyModeByChatId?.[chatId]||"inherit";
  const status=getChatAiStatus({settings,chatId,accountId,connected,thread,runtime,now});
  const templates=profile.templateIds?.map(id=>settings.aiPromptTemplates.find(template=>template.id===id)?.name).filter(Boolean).join(" + ");
  const source=templates||profile.folderName||t(`folderAi.source.${profile.source}`,{name:profile.folderName||""});
  const personKey=recipient?recipientKey("",recipient):"";
  const configure=()=>{
    const folderId=profile.folderId||profile.primaryFolderIds?.find(id=>settings.chatFolders.find(folder=>folder.id===id)?.scope?.type==="account")||profile.primaryFolderIds?.[0];
    if(folderId)setEditing(folderId);else useAppStore.getState().setSettingsOpen(true,"auto-reply");
  };
  const setMode=(mode:"inherit"|"auto"|"manual")=>{
    const state=useAppStore.getState();
    if(resolveAutoReplyScope(state.settings,chatId).source==="paused")return;
    const modes={...state.settings.aiAutoReplyModeByChatId};
    if(mode==="inherit")delete modes[chatId];else modes[chatId]=mode;
    state.updateSettings({aiAutoReplyModeByChatId:modes,aiAutoReplyManualChatIds:(state.settings.aiAutoReplyManualChatIds||[]).filter(id=>id!==chatId)});
  };
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 px-3 py-1.5 text-[11px]">
    <button type="button" onClick={configure} title={source} className="max-w-[45%] truncate text-left text-brand">AI · {source}</button>
    <span role="status" className="min-w-0 flex-1 truncate text-zinc-500" title={status.reason}>{t(`aiChat.${status.key}`)}{status.reason&&<> · {status.reason}</>}{status.retryAt&&<> · {new Date(status.retryAt).toLocaleTimeString()}</>}</span>
    <div role="group" aria-label={t("aiFolder.reply")} className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-800 p-0.5">
      {(["inherit","auto","manual"] as const).map(mode=><button key={mode} type="button" disabled={scope.source==="paused"} aria-pressed={override===mode} onClick={()=>setMode(mode)}
        className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 ${override===mode?"bg-brand/15 font-medium text-brand":"text-zinc-500 hover:text-zinc-200"}`}>
        {t(mode==="inherit"?"crmPanel.inheritShort":mode==="auto"?"multi.replyMode.auto":"multi.replyMode.manual")}
      </button>)}
    </div>
    {personKey&&<label className="flex shrink-0 items-center gap-1.5 text-zinc-500" title={t("aiOutreach.personHint")}>{t("aiOutreach.person")}
      <Switch checked={!settings.aiOutreachExcludedRecipients?.includes(personKey)} onChange={event=>{
        const state=useAppStore.getState(),excluded=state.settings.aiOutreachExcludedRecipients||[];
        state.updateSettings({aiOutreachExcludedRecipients:event.target.checked?excluded.filter(key=>key!==personKey):[...new Set([...excluded,personKey])]});
      }}/>
    </label>}
    {editing&&<FolderAiPromptDialog key={editing} folderId={editing} hideReplyMode onClose={()=>setEditing("")}/>}
  </div>;
}
