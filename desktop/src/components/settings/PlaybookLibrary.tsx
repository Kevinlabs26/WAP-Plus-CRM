import {PlaybookPlans} from './PlaybookPlans';
import { useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useI18n } from '@/i18n';
import { Button, Input, Textarea } from '@/components/ui/primitives';
import { importPlaybooks, MAX_PLAYBOOK_CHARS, MAX_PLAYBOOK_SUMMARY_CHARS, MAX_PLAYBOOK_TOTAL_CHARS } from '@/lib/aiPlaybooks';
import { syncMusePlaybooks } from '@/lib/musePlaybookSync';
import { openMuseWeb } from '@/lib/museWeb';

export function PlaybookLibrary() {
  const {t} = useI18n();
  const settings = useAppStore(state => state.settings);
  const books = settings.aiPlaybooks || [];
  const available = books.filter(book => !book.museMissing);
  const [id, setId] = useState(''), [name, setName] = useState(''), [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editorSnapshot = useRef('');
  const selected = available.find(book => book.id === id);
  const choose = (nextId: string, library = available) => {
    const book = library.find(item => item.id === nextId);
    editorSnapshot.current = book ? JSON.stringify(book) : '';
    setId(nextId); setName(book?.name || ''); setSummary(book?.summary || ''); setError('');
  };
  const used = (settings.chatFolders || []).filter(folder => folder.aiPlaybookId === id).length +
    Object.values(settings.aiPlaybookBindings || {}).filter(value => value === id).length + Number(!!id && settings.aiPlaybookOverviewId === id) + (settings.aiPlaybookPlans||[]).filter(plan=>plan.days.includes(id)).length;
  const save = () => {
    const current = useAppStore.getState();
    const latest = current.settings.aiPlaybooks.find(book => book.id === id);
    if (!latest || JSON.stringify(latest) !== editorSnapshot.current) {setError(t('playbook.editChanged')); return;}
    const library = (current.settings.aiPlaybooks || []).map(book => book.id === id ? {...book, name: name.trim(), summary: summary.trim()} : book);
    if (library.reduce((total, book) => total + book.content.length + book.summary.length, 0) > MAX_PLAYBOOK_TOTAL_CHARS) { setError(t('playbook.capacity')); return; }
    current.updateSettings({aiPlaybooks: library});
    editorSnapshot.current = JSON.stringify(library.find(book => book.id === id));
    current.pushToast(t('playbook.saved'), 'success');
  };
  return <section className="space-y-3 rounded-xl border border-zinc-800 p-4">
    <h4 className="text-sm font-semibold">{t('playbook.library')} · {available.length}</h4>
    <p className="text-xs text-zinc-500">{t('playbook.museSyncHint')}</p>
    <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void syncMusePlaybooks().then(count => {
        const current = useAppStore.getState();
        current.updateSettings({aiPlaybookAutoSync: true});
        if (!selected || name === selected.name && summary === selected.summary) choose(id || current.settings.aiPlaybooks.find(book => book.musePath && !book.museMissing)?.id || '', current.settings.aiPlaybooks);
        current.pushToast(t('playbook.museSynced', {count}), 'success');
      }).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
    }}>{t(busy ? 'playbook.syncing' : 'playbook.museSync')}</Button>
      <Button disabled={busy} onClick={() => {void openMuseWeb().catch(err => setError(String(err)));}}>{t('muse.open')}</Button></div>
    {settings.aiPlaybookMuseRoot && <>
      <p className="break-all text-2xs text-zinc-500">{t('playbook.museSource')}: {settings.aiPlaybookMuseRoot}</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.aiPlaybookAutoSync === true} onChange={event => useAppStore.getState().updateSettings({aiPlaybookAutoSync: event.target.checked})}/>{t('playbook.autoSync')}</label>
    </>}
    {!!settings.aiPlaybookMuseSyncedAt && <p className="text-2xs text-zinc-500">{t('playbook.lastSync')}: {new Date(settings.aiPlaybookMuseSyncedAt).toLocaleString()}</p>}
    {settings.aiPlaybookMuseError && <p role="alert" className="text-xs text-amber-500">{settings.aiPlaybookMuseError}</p>}
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
        choose(library.find(book => !book.musePath && book.sourceName === files[0].name)!.id, library);
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
        {available.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}
      </select></label>
      <label className="block text-xs">{t('playbook.edit')}<select className="ui-control mt-1 w-full px-2 py-2" value={selected?.id || ''} onChange={event => choose(event.target.value)}>
        <option value="">{t('playbook.choose')}</option>{available.map(book => <option key={book.id} value={book.id}>{book.name}{book.summary.trim() ? '' : ` · ${t('playbook.needsSummary')}`}</option>)}
      </select></label>
    </>}
    {selected && <>
      <Input disabled={busy} value={name} maxLength={120} aria-label={t('playbook.name')} onChange={event => setName(event.target.value)}/>
      <label className="block text-xs">{t('playbook.summary')}<Textarea disabled={busy} className="mt-1 min-h-40" value={summary} maxLength={MAX_PLAYBOOK_SUMMARY_CHARS} rows={7} onChange={event => setSummary(event.target.value)}/></label>
      <p className="text-2xs text-zinc-500">{t('playbook.summaryHint')} · {summary.length}/{MAX_PLAYBOOK_SUMMARY_CHARS}</p>
      {selected.musePath ? <div className="break-all text-2xs text-zinc-500">{t('playbook.remoteSourceHint')}<br/>{selected.musePath}{selected.museMissing && <p role="alert" className="text-amber-500">{t('playbook.remoteMissing')}</p>}</div>
        : <details className="text-xs"><summary className="cursor-pointer">{t('playbook.source')} · {selected.sourceName}</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-zinc-400">{selected.content}</pre></details>}
      <p className="text-2xs text-zinc-500">{t('playbook.used', {count: used})}</p>
      <div className="flex gap-2"><Button variant="primary" disabled={busy || !name.trim() || !summary.trim()} onClick={save}>{t('dialog.save')}</Button>
        <Button disabled={busy || used > 0} onClick={async () => {
          if (!await useAppStore.getState().requestConfirm({title: t('playbook.deleteTitle', {name: selected.name}), description: t('playbook.deleteHint'), confirmLabel: t('common.delete'), tone: 'danger'})) return;
          const current = useAppStore.getState(), config = current.settings;
          if (config.aiPlaybookOverviewId === id || config.chatFolders.some(folder => folder.aiPlaybookId === id) || Object.values(config.aiPlaybookBindings || {}).includes(id) || (config.aiPlaybookPlans||[]).some(plan=>plan.days.includes(id))) return;
          current.updateSettings({aiPlaybooks: config.aiPlaybooks.filter(book => book.id !== id)}); choose('');
        }}>{t('common.delete')}</Button></div>
    </>}
    <PlaybookPlans/>
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
  </section>;
}
