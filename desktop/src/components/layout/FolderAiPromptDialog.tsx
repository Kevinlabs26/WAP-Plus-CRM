import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Textarea } from "@/components/ui/primitives";
import { resolveFolderAiProfile } from "@/lib/aiPromptScope";
import { AiPromptLibrary } from "@/components/settings/AiPromptLibrary";
import { AiOutreachControls } from "@/components/settings/AiOutreachControls";
import { normalizeOutreachRule } from "@/lib/aiOutreachRules";
import { resolveAiReplyConstraints } from "@/lib/aiReplyConstraints";
import { lastContactedAccounts, recipientKey } from "@/lib/scheduledPlans";
import { resolveSendTarget } from "@/lib/utils";
import { AiOutreachPreview } from "@/components/settings/AiOutreachPreview";

export function FolderAiPromptDialog({ folderId, onClose, hideReplyMode=false }: { folderId: string; onClose: () => void; hideReplyMode?:boolean }) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const folder = settings.chatFolders.find(item => item.id === folderId);
  const [mode, setMode] = useState(folder?.aiPromptMode === "append" ? "append" : folder?.aiPromptMode === "inherit" ? "inherit" : folder?.aiSystemPrompt?.trim()||folder?.aiPromptTemplateId ? "custom" : "inherit");
  const [draft, setDraft] = useState(folder?.aiSystemPrompt || "");
  const [templateId,setTemplateId]=useState(folder?.aiPromptTemplateId||"");
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
  const [outreach,setOutreach]=useState(normalizeOutreachRule(folder?.aiOutreach||{mode:"auto",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,trigger:"both"}));
  const [maxChars,setMaxChars]=useState(folder?.aiReplyMaxChars?.toString()||"");
  const [forbidden,setForbidden]=useState(folder?.aiReplyForbiddenTerms?.join("\n")||"");
  if (!folder) return null;
  const custom=mode!=="inherit";
  const accountId = folder.scope?.type === "all" ? previewAccount||followingAccount
    : folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId;
  const inherited = resolveFolderAiProfile({ ...settings,
    chatFolders: settings.chatFolders.map(item => item.id === folderId ? { ...item, aiSystemPrompt: undefined,aiPromptMode:"inherit",aiPromptTemplateId:undefined } : item),
  }, folderId, accountId);
  const variesByAccount = folder.scope?.type === "all";
  const forbiddenTerms=forbidden.split(/[\n,，]/).map(term=>term.trim()).filter(Boolean);
  const draftSettings:typeof settings={...settings,chatFolders:settings.chatFolders.map(item=>item.id===folderId?{...item,
    aiPromptMode:mode==="custom"?"replace":mode as "append"|"inherit",aiSystemPrompt:custom?draft:undefined,aiPromptTemplateId:custom?templateId||undefined:undefined,
    aiReplyMaxChars:maxChars?Number(maxChars):undefined,aiReplyForbiddenTerms:forbiddenTerms,aiOutreach:outreach}:item)};
  const preview=resolveFolderAiProfile(draftSettings,folderId,accountId);
  const limits=resolveAiReplyConstraints(draftSettings,accountId,undefined,folderId);
  const invalid=custom&&!draft.trim()&&!templateId||!!preview.error||forbiddenTerms.length>50||forbiddenTerms.some(term=>term.length>100)||!!maxChars&&(!Number.isInteger(Number(maxChars))||Number(maxChars)<20||Number(maxChars)>2000);
  const save = () => {
    if (invalid) return;
    const current = useAppStore.getState();
    current.updateSettings({ chatFolders: current.settings.chatFolders.map(item => item.id === folderId
      ? { ...item, aiSystemPrompt: custom ? draft.trim().slice(0, 6000) : undefined,
        aiPromptMode:mode==="custom"?"replace":mode as "append"|"inherit",aiPromptTemplateId:custom?templateId||undefined:undefined,aiOutreach:outreach,...(hideReplyMode?{}:{autoReplyMode:replyMode==="inherit"?undefined:replyMode}),
        aiReplyMaxChars:maxChars?Number(maxChars):undefined,aiReplyForbiddenTerms:forbiddenTerms } : item) });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="folder-ai-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, input:not(:disabled), summary')].filter(control=>control.getClientRects().length>0);
            const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
              : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined;
            if (target) { event.preventDefault(); target.focus(); }
          }
        }}>
        <h3 id="folder-ai-title" className="text-sm font-semibold text-zinc-100">{t("folderAi.title", { name: folder.name })}</h3>
        {settings.aiAutoReplyPaused&&<p role="status" className="mt-2 text-xs text-amber-500">{t("aiChat.paused")}</p>}
        <label className="mt-4 block text-xs text-zinc-300">
          {t("folderAi.mode")}
          <select autoFocus className="ui-control mt-1 w-full px-3 py-2" value={mode}
            onChange={event => setMode(event.target.value)}>
            <option value="inherit">{t("folderAi.inherit")}</option>
            <option value="append">{t("aiLibrary.append")}</option>
            <option value="custom">{t("folderAi.custom")}</option>
          </select>
        </label>
        {!hideReplyMode&&<div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span>{t("aiFolder.defaultReply")}</span>
          <div className="flex gap-1">{(["inherit","auto","manual"] as const).map(value=><button key={value} type="button" aria-pressed={replyMode===value} onClick={()=>setReplyMode(value)}
            className={`rounded-full px-3 py-1.5 ${replyMode===value?"bg-brand/15 text-brand":"bg-zinc-800 text-zinc-400"}`}>{t(value==="inherit"?"crmPanel.inheritShort":value==="auto"?"multi.replyMode.auto":"multi.replyMode.manual")}</button>)}</div>
        </div>}
        <label className="mt-4 block text-xs text-zinc-300">{t("aiLibrary.choose")}
          <select className="ui-control mt-1 w-full px-2 py-2" aria-label={t("aiLibrary.choose")} value={custom?templateId:""} onChange={event=>{setTemplateId(event.target.value);if(event.target.value&&mode==="inherit")setMode("append");}}>
            <option value="">{t("aiLibrary.none")}</option>{settings.aiPromptTemplates?.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
        {custom ? <label className="mt-4 block text-xs text-zinc-300">
          {t("folderAi.prompt")}
          <Textarea className="mt-1 min-h-48" rows={8} maxLength={6000} value={draft}
            placeholder={t("folderAi.placeholder")} onChange={event => setDraft(event.target.value)} />
          <span className="mt-1 block text-right text-zinc-500">{draft.length}/6000</span>
        </label> : <div className="mt-4 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
          <p>{variesByAccount ? t("folderAi.perAccount") : t("folderAi.effective", {
            source: t(`folderAi.source.${inherited.source}`, { name: inherited.folderName || "" }),
          })}</p>
        </div>}
        {variesByAccount&&<select aria-label={t("aiLibrary.previewAccount")} title={t("aiLibrary.previewOnly")} value={previewAccount} onChange={event=>setPreviewAccount(event.target.value)} className="ui-control mt-3 w-full px-2 py-2 text-xs">
          <option value="">{t("aiLibrary.followChat",{account:settings.waAccounts?.find(account=>account.id===followingAccount)?.label||followingAccount||"—"})}</option>
          {settings.waAccounts?.map(account=><option key={account.id} value={account.id}>{account.label}: {account.userName||account.phoneE164}</option>)}
        </select>}
        <AiOutreachControls value={outreach} onChange={setOutreach}/>
        {outreach.enabled&&<AiOutreachPreview settings={draftSettings} folderIds={[folderId]} assumeRunning={settings.aiOutreachPaused}/>}
        <details className="mt-3 rounded-lg border border-zinc-800 p-3 text-xs"><summary className="cursor-pointer">{t("aiFolder.advanced")}</summary>
        <details className="mt-3 text-xs"><summary className="cursor-pointer">{t("aiLibrary.preview")}</summary>
          <p className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-zinc-400">{preview.error||preview.prompt||t("folderAi.source.default")}</p>
        </details>
        <details className="mt-3 rounded-lg border border-zinc-800 p-3 text-xs"><summary className="cursor-pointer">{t("aiConstraints.title")}</summary>
          <p className="mt-2 text-2xs text-zinc-500">{t("aiConstraints.hint")}</p>
          <label className="mt-2 block">{t("aiConstraints.max")}<input type="number" min={20} max={2000} value={maxChars} onChange={event=>setMaxChars(event.target.value)} className="ui-control mt-1 w-full px-2 py-2" /></label>
          <label className="mt-2 block">{t("aiConstraints.forbidden")}<Textarea rows={3} maxLength={5000} value={forbidden} onChange={event=>setForbidden(event.target.value)}/></label>
          <p className="mt-2 text-2xs text-zinc-500">{t("aiConstraints.effective",{max:limits.maxChars||"—",terms:limits.forbiddenTerms.join("、")||"—"})}</p>
        </details>
        <div className="mt-3"><AiPromptLibrary /></div>
        </details>
        {preview.error&&<p role="alert" className="mt-3 text-xs text-rose-400">{preview.error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800" onClick={onClose}>{t("dialog.cancel")}</button>
          <button type="button" className="rounded-lg bg-brand px-3 py-2 text-xs text-[var(--brand-foreground)] disabled:opacity-40"
            disabled={invalid} onClick={save}>{t("dialog.save")}</button>
        </div>
      </div>
    </div>
  );
}
