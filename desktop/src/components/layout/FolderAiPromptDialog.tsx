import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";
import { Textarea } from "@/components/ui/primitives";
import { resolveFolderAiProfile } from "@/lib/aiPromptScope";

export function FolderAiPromptDialog({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useAppStore(state => state.settings);
  const folder = settings.chatFolders.find(item => item.id === folderId);
  const [custom, setCustom] = useState(!!folder?.aiSystemPrompt?.trim());
  const [draft, setDraft] = useState(folder?.aiSystemPrompt || "");
  if (!folder) return null;
  const accountId = folder.scope?.type === "all" ? undefined
    : folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId;
  const inherited = resolveFolderAiProfile({ ...settings,
    chatFolders: settings.chatFolders.map(item => item.id === folderId ? { ...item, aiSystemPrompt: undefined } : item),
  }, folderId, accountId);
  const variesByAccount = folder.scope?.type === "all" && inherited.source !== "folder";
  const save = () => {
    if (custom && !draft.trim()) return;
    const current = useAppStore.getState();
    current.updateSettings({ chatFolders: current.settings.chatFolders.map(item => item.id === folderId
      ? { ...item, aiSystemPrompt: custom ? draft.trim().slice(0, 6000) : undefined } : item) });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="folder-ai-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea')];
            const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
              : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined;
            if (target) { event.preventDefault(); target.focus(); }
          }
        }}>
        <h3 id="folder-ai-title" className="text-sm font-semibold text-zinc-100">{t("folderAi.title", { name: folder.name })}</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">{t("folderAi.hint")}</p>
        <label className="mt-4 block text-xs text-zinc-300">
          {t("folderAi.mode")}
          <select autoFocus className="ui-control mt-1 w-full px-3 py-2" value={custom ? "custom" : "inherit"}
            onChange={event => setCustom(event.target.value === "custom")}>
            <option value="inherit">{t("folderAi.inherit")}</option>
            <option value="custom">{t("folderAi.custom")}</option>
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
          {!variesByAccount && inherited.prompt && <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap">{inherited.prompt}</p>}
        </div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800" onClick={onClose}>{t("dialog.cancel")}</button>
          <button type="button" className="rounded-lg bg-brand px-3 py-2 text-xs text-[var(--brand-foreground)] disabled:opacity-40"
            disabled={custom && !draft.trim()} onClick={save}>{t("dialog.save")}</button>
        </div>
      </div>
    </div>
  );
}
