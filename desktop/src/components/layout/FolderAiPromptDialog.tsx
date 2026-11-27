import {PlaybookScheduleFields} from '@/components/settings/PlaybookScheduleFields';
import {scheduledPlaybook} from '@/lib/playbookPlans';
import { X } from "lucide-react";
import { useState } from "react";
import { useAppStore, flushPersist } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Textarea } from "@/components/ui/primitives";
import { resolveFolderAiProfile } from "@/lib/aiPromptScope";
import { AiOutreachControls } from "@/components/settings/AiOutreachControls";
import { nextScheduledOutreachAt, normalizeOutreachRule } from "@/lib/aiOutreachRules";
import { outreachFolderDismissal, tickAiOutreach } from "@/lib/aiOutreach";
import { resolveAiReplyConstraints } from "@/lib/aiReplyConstraints";
import { lastContactedAccounts, recipientKey } from "@/lib/scheduledPlans";
import { resolveSendTarget } from "@/lib/utils";
import { AiOutreachPreview } from "@/components/settings/AiOutreachPreview";
import { PlaybookSelect } from "@/components/crm/PlaybookBinding";
import { PromptPlanBindingFields } from "@/components/settings/PromptPlanFields";
import { evaluatePromptPlan, usesPromptPlans } from "@/lib/promptPlans";
import { activeFirstContactAssignments, allocateFirstContacts } from "@/lib/aiOutreachAllocation";
import { outreachFolderChatIds } from "@/lib/aiOutreachContext";

export function FolderAiPromptDialog({ folderId, onClose, hideReplyMode=false }: { folderId: string; onClose: () => void; hideReplyMode?:boolean }) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const folder = settings.chatFolders.find(item => item.id === folderId);
  const originalOutreach=folder?.aiOutreach?normalizeOutreachRule(folder.aiOutreach):undefined;
  const [mode, setMode] = useState(folder?.aiPromptMode === "append" ? "append" : folder?.aiPromptMode === "inherit" ? "inherit" : folder?.aiSystemPrompt?.trim()||folder?.aiPromptTemplateId ? "custom" : "inherit");
  const [draft, setDraft] = useState(folder?.aiSystemPrompt || "");
  const [templateId,setTemplateId]=useState(folder?.aiPromptTemplateId||"");
  const [playbookId,setPlaybookId]=useState(folder?.aiPlaybookId||"");
  const [schedule,setSchedule]=useState(folder?.aiPlaybookSchedule);
  const [promptPlan, setPromptPlan] = useState(folder?.aiPromptPlan);
  const [replyMode,setReplyMode]=useState<"inherit"|"auto"|"manual">(folder?.autoReplyMode||"inherit");
  const [previewAccount,setPreviewAccount]=useState("");
  const [followingAccount]=useState(()=>{
    const state=useAppStore.getState(),chats=state.chats||[],contacts=state.contacts||[];
    const chat=chats.find(item=>item.id===state.selectedChatId)||chats.find(item=>folder?.chatIds.includes(item.id));
    const contact=contacts.find(item=>item.id===chat?.contactId);
    const recipient=contact&&resolveSendTarget({phone:contact.phone,channelAddress:contact.channelAddress,entityId:contact.id});
    const latest=recipient&&lastContactedAccounts(chats,contacts,state.messages||[]).get(recipientKey("",recipient));
    return latest||(state.selectedThreadAccount?.chatId===chat?.id?state.selectedThreadAccount?.accountId:undefined)||chat?.accountId||contact?.accountId||settings.liveBaileysAccountId||settings.activeAccountId;
  });
  const [outreach,setOutreach]=useState(normalizeOutreachRule(folder?.aiOutreach||{mode:"auto",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
  const [maxChars,setMaxChars]=useState(folder?.aiReplyMaxChars?.toString()||"");
  const [forbidden,setForbidden]=useState(folder?.aiReplyForbiddenTerms?.join("\n")||"");
  if (!folder) return null;
  const custom=mode!=="inherit";
  const promptPlansEnabled = usesPromptPlans(settings.aiProvider);
  const museProvider = settings.aiProvider === "muse";
  const accountId = folder.scope?.type === "all" ? previewAccount||followingAccount
    : folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId;
  const inherited = resolveFolderAiProfile({ ...settings,
    chatFolders: settings.chatFolders.map(item => item.id === folderId ? { ...item, aiSystemPrompt: undefined,aiPromptMode:"inherit",aiPromptTemplateId:undefined } : item),
  }, folderId, accountId);
  const variesByAccount = folder.scope?.type === "all";
  const allocationFor = (state: ReturnType<typeof useAppStore.getState>) => variesByAccount && outreach.firstContactQuotas
    ? allocateFirstContacts(state, outreachFolderChatIds(state, folderId), outreach.firstContactQuotas, activeFirstContactAssignments({
      ...outreach, scheduledFirstContactAssignments:state.settings.chatFolders.find(item => item.id === folderId)?.aiOutreach?.scheduledFirstContactAssignments,
    }))
    : undefined;
  const allocation = outreach.enabled ? allocationFor(useAppStore.getState()) : undefined;
  const previewOutreach = allocation ? {...outreach,firstContactAssignments:allocation.assignments,scheduledFirstContactAssignments:undefined} : outreach;
  const forbiddenTerms=forbidden.split(/[\n,，]/).map(term=>term.trim()).filter(Boolean);
  const draftSettings:typeof settings={...settings,chatFolders:settings.chatFolders.map(item=>item.id===folderId?{...item,
    aiPromptMode:mode==="custom"?"replace":mode as "append"|"inherit",aiSystemPrompt:custom?draft:undefined,
    ...(!museProvider ? { aiPromptTemplateId: custom ? templateId || undefined : undefined } : {}),
    aiReplyMaxChars:maxChars?Number(maxChars):undefined,aiReplyForbiddenTerms:forbiddenTerms,aiPlaybookId:playbookId||undefined,aiPlaybookSchedule:schedule,aiPromptPlan:promptPlan,aiOutreach:previewOutreach}:item)};
  const preview=resolveFolderAiProfile(draftSettings,folderId,accountId);
  const limits=resolveAiReplyConstraints(draftSettings,accountId,undefined,folderId);
  const promptPlanError = promptPlansEnabled && evaluatePromptPlan(promptPlan, settings.aiPromptTemplates || [], undefined, settings.aiPromptPlans || []).error;
  const playbookError = museProvider && schedule && scheduledPlaybook(settings.aiPlaybookPlans || [], schedule).error;
  const invalid=!!promptPlanError||!!playbookError||!museProvider&&custom&&!draft.trim()&&!templateId||!!preview.error||forbiddenTerms.length>50||forbiddenTerms.some(term=>term.length>100)||!!maxChars&&(!Number.isInteger(Number(maxChars))||Number(maxChars)<20||Number(maxChars)>2000);
  const immediate=outreach.enabled&&outreach.startMode==="immediate";
  const save = () => {
    if (invalid || immediate && (outreach.paused || settings.aiAutoReplyPaused || settings.aiOutreachPaused)) return;
    const current = useAppStore.getState();
    const freshAllocation = outreach.enabled ? allocationFor(current) : undefined;
    const rule = freshAllocation ? {...outreach,firstContactAssignments:freshAllocation.assignments,scheduledFirstContactAssignments:undefined} : outreach;
    const scheduleChanged=!originalOutreach||originalOutreach.enabled!==outreach.enabled||originalOutreach.paused!==outreach.paused||originalOutreach.startMode!==outreach.startMode||originalOutreach.time!==outreach.time||originalOutreach.timeZone!==outreach.timeZone;
    const savedOutreach=!outreach.enabled?{...rule,runNowAt:undefined,scheduleStartAt:undefined}
      :immediate?{...rule,runNowAt:Date.now(),scheduleStartAt:undefined}
      :{...rule,runNowAt:undefined,scheduleStartAt:scheduleChanged?nextScheduledOutreachAt(rule)??undefined:rule.scheduleStartAt};
    current.updateSettings({ chatFolders: current.settings.chatFolders.map(item => item.id === folderId
      ? { ...item, aiSystemPrompt: custom ? draft.trim() : undefined,
        aiPromptMode:mode==="custom"?"replace":mode as "append"|"inherit",
        ...(!museProvider ? { aiPromptTemplateId: custom ? templateId || undefined : undefined } : {}),
        ...(museProvider ? { aiPlaybookId: playbookId || undefined, aiPlaybookSchedule: schedule } : {}),
        ...(promptPlansEnabled ? { aiPromptPlan: promptPlan } : {}),
        aiOutreach:savedOutreach,...(hideReplyMode?{}:{autoReplyMode:replyMode==="inherit"?undefined:replyMode}),
        aiReplyMaxChars:maxChars?Number(maxChars):undefined,aiReplyForbiddenTerms:forbiddenTerms } : item),
      ...(savedOutreach.enabled?{aiTaskDismissedIds:current.settings.aiTaskDismissedIds.filter(id=>id!==outreachFolderDismissal(folderId))}:{}) });
    if (immediate) {
      void flushPersist(useAppStore.getState).then(()=>{
        useAppStore.getState().pushToast(t("aiOutreach.runNowStarted"),"info");
        onClose();
        void tickAiOutreach(Date.now(),true).catch(error=>useAppStore.getState().pushToast(String(error),"error"));
      }).catch(error=>useAppStore.getState().pushToast(String(error),"error"));
    } else onClose();
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="folder-ai-title"
        className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        style={{ width: "min(94vw, 1152px)", height: "min(88vh, 820px)" }}
        onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, input:not(:disabled), summary')].filter(control=>control.getClientRects().length>0);
            const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
              : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined;
            if (target) { event.preventDefault(); target.focus(); }
          }
        }}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-6">
          <h3 id="folder-ai-title" className="text-[17px] font-semibold leading-none text-zinc-100">{t("folderAi.title", { name: folder.name })}</h3>
          <button type="button" className="ui-btn-ghost h-9 w-9 !px-0" onClick={onClose} title={t("settings.close")} aria-label={t("settings.close")}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-5xl space-y-4">
        {settings.aiAutoReplyPaused&&<p role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500">{t("aiChat.paused")}</p>}
        <div className="grid gap-4 md:grid-cols-2">
        <label className={`block text-xs text-zinc-300 ${hideReplyMode ? "md:col-span-2" : ""}`}>
          {t("folderAi.mode")}
          <select autoFocus className="ui-control mt-1 w-full px-3 py-2" value={mode}
            onChange={event => setMode(event.target.value)}>
            <option value="inherit">{t("folderAi.inherit")}</option>
            <option value="append">{t("aiLibrary.append")}</option>
            <option value="custom">{t("folderAi.custom")}</option>
          </select>
        </label>
        {!hideReplyMode&&<div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-xs">
          <span>{t("aiFolder.defaultReply")}</span>
          <div className="flex gap-1">{(["inherit","auto","manual"] as const).map(value=><button key={value} type="button" aria-pressed={replyMode===value} onClick={()=>setReplyMode(value)}
            className={`rounded-full px-3 py-1.5 ${replyMode===value?"bg-brand/15 text-brand":"bg-zinc-800 text-zinc-400"}`}>{t(value==="inherit"?"crmPanel.inheritShort":value==="auto"?"multi.replyMode.auto":"multi.replyMode.manual")}</button>)}</div>
        </div>}
        {!museProvider&&<label className={`block text-xs text-zinc-300 ${variesByAccount ? "" : "md:col-span-2"}`}>{t("aiLibrary.choose")}
          <select className="ui-control mt-1 w-full px-2 py-2" aria-label={t("aiLibrary.choose")} value={custom?templateId:""} onChange={event=>{setTemplateId(event.target.value);if(event.target.value&&mode==="inherit")setMode("append");}}>
            <option value="">{t("aiLibrary.none")}</option>{settings.aiPromptTemplates?.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>}
        {variesByAccount&&<label className="block text-xs text-zinc-300">
          {t("aiLibrary.previewAccount")}
          <select title={t("aiLibrary.previewOnly")} value={previewAccount} onChange={event=>setPreviewAccount(event.target.value)} className="ui-control mt-1 w-full px-2 py-2 text-xs">
            <option value="">{t("aiLibrary.followChat",{account:settings.waAccounts?.find(account=>account.id===followingAccount)?.label||followingAccount||"—"})}</option>
            {settings.waAccounts?.map(account=><option key={account.id} value={account.id}>{account.label}: {account.userName||account.phoneE164}</option>)}
          </select>
        </label>}
        {!custom&&<div className={`flex items-center px-1 py-2 text-xs text-zinc-400 ${museProvider && variesByAccount ? "md:self-end" : "md:col-span-2"}`}>
          <p>{variesByAccount ? t("folderAi.perAccount") : t("folderAi.effective", {
            source: t(`folderAi.source.${inherited.source}`, { name: inherited.folderName || "" }),
          })}</p>
        </div>}
        </div>
        {custom&&<label className="block text-xs text-zinc-300">
          {t("folderAi.prompt")}
          <Textarea className="mt-1 min-h-48" rows={8} value={draft}
            placeholder={t("folderAi.placeholder")} onChange={event => setDraft(event.target.value)} />
          <span className="mt-1 block text-right text-zinc-500">{t("settingsAutoReply.promptLength", { count: draft.length })}</span>
        </label>}
        {museProvider && <section className="space-y-2">
          <fieldset disabled={!!schedule} className="disabled:opacity-50"><PlaybookSelect value={playbookId} onChange={setPlaybookId}/></fieldset>
          <PlaybookScheduleFields value={schedule} onChange={setSchedule}/>
        </section>}
        {promptPlansEnabled && <PromptPlanBindingFields value={promptPlan} onChange={setPromptPlan} inheritLabel={t("promptPlan.followParent")} />}
        <AiOutreachControls value={outreach} onChange={setOutreach}>
          {variesByAccount&&<fieldset className="space-y-2">
            <label className="inline-flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={!!outreach.firstContactQuotas} onChange={event=>setOutreach({...outreach,firstContactQuotas:event.target.checked?{}:undefined,firstContactAssignments:undefined})}/>
              {t("allocation.title")}
            </label>
            {outreach.firstContactQuotas&&allocation&&<>
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {settings.waAccounts.map(account=>{
                  const quotas=outreach.firstContactQuotas!;
                  const checked=Object.hasOwn(quotas,account.id);
                  return <div key={account.id} className="flex min-w-0 items-center gap-2 text-xs">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input type="checkbox" checked={checked} onChange={event=>{
                        const next={...quotas};
                        if(event.target.checked)next[account.id]=0;
                        else delete next[account.id];
                        setOutreach({...outreach,firstContactQuotas:next});
                      }}/>
                      <span className="truncate">{account.label||account.id}</span>
                    </label>
                    <input type="number" className="ui-control w-20 px-2 py-1" aria-label={t("allocation.quota",{name:account.label||account.id})} min={0} max={100} disabled={!checked} value={checked?quotas[account.id]:""} onChange={event=>setOutreach({...outreach,firstContactQuotas:{...quotas,[account.id]:Math.max(0,Math.min(100,Math.trunc(Number(event.target.value)||0)))}})}/>
                  </div>;
                })}
              </div>
              <p className="text-2xs text-zinc-500" role="status">{t("allocation.summary",{assigned:Object.keys(allocation.assignments).length,eligible:allocation.eligible,existing:allocation.existing})}</p>
              <p className="text-2xs text-zinc-500">{t("allocation.hint")}</p>
            </>}
          </fieldset>}
        </AiOutreachControls>
        {outreach.enabled&&<div className="space-y-2">
          {settings.aiAutoReplyPaused&&<p role="status" className="text-xs text-amber-500">{t("aiChat.paused")}</p>}
          {settings.aiOutreachPaused&&<p role="status" className="text-xs text-amber-500">{t("aiOutreach.masterPaused")}</p>}
        </div>}
        {outreach.enabled&&<AiOutreachPreview settings={draftSettings} folderIds={[folderId]} assumeRunning={settings.aiOutreachPaused}/>}
        <div className="grid gap-4 xl:grid-cols-2">
        <details className="text-xs"><summary className="cursor-pointer">{t("folderAi.basePreview")}</summary>
          <p className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-zinc-400">{preview.error||preview.prompt||t("folderAi.source.default")}</p>
        </details>
        <details className="rounded-lg border border-zinc-800 p-3 text-xs"><summary className="cursor-pointer">{t("folderAi.otherLimits")}</summary>
          <p className="mt-2 text-2xs text-zinc-500">{t("aiConstraints.hint")}</p>
          <label className="mt-2 block">{t("aiConstraints.max")}<input type="number" min={20} max={2000} value={maxChars} onChange={event=>setMaxChars(event.target.value)} className="ui-control mt-1 w-full px-2 py-2" /></label>
          <label className="mt-2 block">{t("aiConstraints.forbidden")}<Textarea rows={3} maxLength={5000} value={forbidden} onChange={event=>setForbidden(event.target.value)}/></label>
          <p className="mt-2 text-2xs text-zinc-500">{t("aiConstraints.effective",{max:limits.maxChars||"—",terms:limits.forbiddenTerms.join("、")||"—"})}</p>
        </details>
        </div>
        {preview.error&&<p role="alert" className="mt-3 text-xs text-rose-400">{preview.error}</p>}
          </div>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-800 px-6 py-3">
          <button type="button" className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800" onClick={onClose}>{t("dialog.cancel")}</button>
          <button type="button" className="rounded-lg bg-brand px-3 py-2 text-xs text-[var(--brand-foreground)] disabled:opacity-40"
            disabled={invalid||immediate&&(!!outreach.paused||settings.aiAutoReplyPaused||settings.aiOutreachPaused)} onClick={save}>{outreach.enabled?t(immediate?"aiOutreach.saveRunNow":"aiOutreach.saveScheduled"):t("dialog.save")}</button>
        </footer>
      </div>
    </div>
  );
}
