import { useAppStore } from '@/store/appStore';
import { useI18n } from '@/i18n';
import { playbookBindingKey, resolvePlaybook } from '@/lib/aiPlaybooks';

export function PlaybookSelect({value, onChange}: {value: string; onChange: (id: string) => void}) {
  const {t} = useI18n();
  const library = useAppStore(state => state.settings.aiPlaybooks);
  const books = (library || []).filter(book => !book.museMissing);
  return <label className="block text-xs">{t('playbook.binding')}<select className="ui-control mt-1 w-full px-2 py-2" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{t('playbook.inherit')}</option><option value="off">{t('playbook.off')}</option>
    {value && value !== 'off' && !books.some(book => book.id === value) && <option value={value} disabled>{t('playbook.missing')}</option>}
    {books.map(book => <option key={book.id} value={book.id}>{book.name}{book.summary.trim() ? '' : ` · ${t('playbook.needsSummary')}`}</option>)}
  </select></label>;
}

export function PlaybookBinding({accountId, chatId}: {accountId?: string; chatId: string}) {
  const {t} = useI18n();
  const settings = useAppStore(state => state.settings);
  const result = resolvePlaybook(settings, accountId, chatId);
  const key = accountId ? playbookBindingKey(accountId, chatId) : '';
  return <div className="space-y-2 rounded-xl border border-zinc-800 p-2.5">
    {accountId ? <PlaybookSelect value={settings.aiPlaybookBindings?.[key] || ''} onChange={id => {
      const current = useAppStore.getState();
      const bindings = {...current.settings.aiPlaybookBindings};
      if (id) bindings[key] = id; else delete bindings[key];
      current.updateSettings({aiPlaybookBindings: bindings});
    }}/> : <p className="text-xs text-zinc-500">{t('playbook.accountRequired')}</p>}
    <p className="text-2xs text-zinc-500">{t('playbook.effective', {name: result.name || t('playbook.off')})}{result.source !== 'none' && ` · ${t(`playbook.from.${result.source}`)}`}</p>
    <p className="text-2xs text-zinc-500">{t('playbook.bindingHint')}</p>
    {result.error && <p role="alert" className="text-xs text-rose-400">{result.error}</p>}
    <button type="button" className="text-xs text-brand hover:underline" onClick={() => { const state = useAppStore.getState(); state.setSettingsCategory('ai'); state.setSettingsOpen(true); }}>{t('playbook.manage')}</button>
    {result.prompt && !result.error && <details className="text-2xs text-zinc-500"><summary className="cursor-pointer">{t('playbook.preview')}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{result.prompt}</pre></details>}
  </div>;
}
