import {PlaybookPlans} from './PlaybookPlans';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/primitives';
import { importPlaybooks, MAX_PLAYBOOK_CHARS, MAX_PLAYBOOK_TOTAL_CHARS } from '@/lib/aiPlaybooks';
import { normalizeMuseFolder, syncMusePlaybooks } from '@/lib/musePlaybookSync';
import { museWebAccounts, openMuseWeb } from '@/lib/museWeb';

export function PlaybookLibrary() {
  const {t} = useI18n();
  const settings = useAppStore(state => state.settings);
  const books = settings.aiPlaybooks || [];
  const available = books.filter(book => !book.museMissing);
  const museBooks = available.filter(book => book.musePath);
  const sharedMuseBooks = museBooks.filter(book => book.content.trim() || book.summary.trim()).length;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const workspaceLinked = settings.aiPlaybookMuseWorkspaceLinked === true;
  const overview = books.find(book => book.id === settings.aiPlaybookOverviewId);
  const workspacePrefix = settings.aiPlaybookMuseRoot ? `${settings.aiPlaybookMuseRoot.replace(/\/$/, '')}/` : '';
  const inferredFolder = workspacePrefix && overview?.musePath?.startsWith(workspacePrefix) ? overview.musePath.slice(workspacePrefix.length).split('/').slice(0, -1).join('/') : '';
  const [folderPath, setFolderPath] = useState(settings.aiPlaybookMuseFolder || inferredFolder);
  useEffect(() => setFolderPath(settings.aiPlaybookMuseFolder || inferredFolder), [settings.aiPlaybookMuseAccountId, settings.aiPlaybookMuseFolder, settings.aiPlaybookMuseRoot, inferredFolder]);
  const input = useRef<HTMLInputElement>(null);
  const sync = async (folder: string) => {
    const count = await syncMusePlaybooks(true, folder);
    const current = useAppStore.getState();
    current.updateSettings({aiPlaybookAutoSync: true});
    setFolderPath(folder);
    current.pushToast(t('playbook.museSynced', {count}), 'success');
  };
  const startSync = () => {
    let folder: string;
    try { folder = normalizeMuseFolder(folderPath); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); return; }
    setBusy(true); setError('');
    void sync(folder).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
  };
  return <section className="mx-auto max-w-3xl space-y-3 border-t border-zinc-800 pt-4">
    <h4 className="text-sm font-semibold">{t('playbook.library')} · {available.length}</h4>
    <p className="text-xs text-zinc-500">{t('playbook.museSyncHint')}</p>
    {settings.aiProvider==='muse'&&<label className="block text-xs">{t('playbook.museMode')}
      <select className="ui-control mt-1 w-full px-2 py-2" value={settings.aiPlaybookMuseMode||'workspace'} onChange={event=>useAppStore.getState().updateSettings({aiPlaybookMuseMode:event.target.value==='shared'?'shared':'workspace'})}>
        <option value="shared">{t('playbook.museModeShared')}</option>
        <option value="workspace">{t('playbook.museModeWorkspace')}</option>
      </select>
      <span className="mt-1 block text-2xs text-zinc-500">{t(settings.aiPlaybookMuseMode==='shared'?'playbook.museModeSharedHint':'playbook.museModeWorkspaceHint')}</span>
    </label>}
    <label className="block text-xs">{t('playbook.scopeLabel')}
      <input className="ui-control mt-1 w-full px-3 py-2 text-xs" value={folderPath} disabled={busy} placeholder={t('playbook.scopePlaceholder')} onChange={event => {setFolderPath(event.target.value);setError('');}} />
    </label>
    <p className="text-2xs text-zinc-500">{t('playbook.scopeHint')}</p>
    <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={startSync}>{t(busy ? 'playbook.syncing' : workspaceLinked ? 'playbook.museSync' : 'playbook.findSources')}</Button>
      <Button disabled={busy} onClick={() => {void museWebAccounts().then(pool=>openMuseWeb(false,pool.primaryId)).catch(err => setError(String(err)));}}>{t('muse.open')}</Button></div>
    {!workspaceLinked&&settings.aiPlaybookMuseAccountId&&<p role="status" className="text-xs text-amber-500">{t('playbook.primaryChanged')}</p>}
    {workspaceLinked && settings.aiPlaybookMuseRoot && <>
      <p className="break-all text-2xs text-zinc-500">{t('playbook.museSource')}: {settings.aiPlaybookMuseRoot}</p>
      {!!museBooks.length&&<p className="text-2xs text-zinc-500">{t('playbook.museShared',{shared:sharedMuseBooks,total:museBooks.length})}</p>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.aiPlaybookAutoSync === true} onChange={event => useAppStore.getState().updateSettings({aiPlaybookAutoSync: event.target.checked})}/>{t('playbook.autoSync')}</label>
    </>}
    {!!settings.aiPlaybookMuseSyncedAt && <p className="text-2xs text-zinc-500">{t('playbook.lastSync')}: {new Date(settings.aiPlaybookMuseSyncedAt).toLocaleString()}</p>}
    <details className="space-y-2 text-xs"><summary className="cursor-pointer text-zinc-500">{t('playbook.localImport')}</summary>
    <p className="text-xs text-zinc-500">{t('playbook.importHint')}</p>
    <input ref={input} type="file" multiple accept=".md,text/markdown" className="hidden" aria-label={t('playbook.import')} onChange={event => {
      const files = Array.from(event.target.files || []); event.target.value = '';
      if (!files.length) return;
      setBusy(true); setError('');
      void (async () => {
        if (files.length > 100 || files.some(file => file.size > MAX_PLAYBOOK_CHARS * 4) || files.reduce((sum, file) => sum + file.size, 0) > 4 * MAX_PLAYBOOK_TOTAL_CHARS) throw Error(t('playbook.capacity'));
        const contents = await Promise.all(files.map(async file => ({name: file.name, text: await file.text()})));
        const current = useAppStore.getState();
        const library = importPlaybooks(current.settings.aiPlaybooks || [], contents);
        current.updateSettings({aiPlaybooks: library});
        current.pushToast(t('playbook.imported', {count: files.length}), 'success');
      })().catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
    }}/>
    <Button disabled={busy} onClick={() => input.current?.click()}>{t(busy ? 'cloud.stage.reading' : 'playbook.import')}</Button>
    </details>
    {!books.length && <p className="text-xs text-zinc-500">{t('playbook.empty')}</p>}
    {!!books.length && <>
      <label className="block text-xs">{t('playbook.overview')}<select className="ui-control mt-1 w-full px-2 py-2" value={settings.aiPlaybookOverviewId || ''} onChange={event => useAppStore.getState().updateSettings({aiPlaybookOverviewId: event.target.value})}>
        <option value="">{t('playbook.noOverview')}</option>
        {settings.aiPlaybookOverviewId && !available.some(book => book.id === settings.aiPlaybookOverviewId) && <option value={settings.aiPlaybookOverviewId} disabled>{t('playbook.missing')}</option>}
        {available.map(book => <option key={book.id} value={book.id}>{book.musePath || book.name}</option>)}
      </select></label>
    </>}
    <PlaybookPlans/>
    {(error || settings.aiPlaybookMuseError) && <p role="alert" className="text-xs text-amber-500">{error || settings.aiPlaybookMuseError}</p>}
  </section>;
}
