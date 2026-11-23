import {useEffect,useState} from 'react';
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
    {books.map(book => <option key={book.id} value={book.id}>{book.musePath?.split('/').at(-1) || book.sourceName || book.name}{!book.musePath && !book.summary.trim() ? ` · ${t('playbook.needsSummary')}` : ''}</option>)}
  </select></label>;
}

export function PlaybookBinding({accountId, chatId}: {accountId?: string; chatId: string}) {
  const {t} = useI18n();
  const settings = useAppStore(state => state.settings);
  const museProvider = settings.aiProvider === 'muse';
  const [,setClock]=useState(0);
  useEffect(() => {
    if (!museProvider || !settings.aiPlaybookPlans?.length) return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [museProvider, settings.aiPlaybookPlans?.length]);
  if (!museProvider) return null;
  const result = resolvePlaybook(settings, accountId, chatId);
  const key = accountId ? playbookBindingKey(accountId, chatId) : '';
  return <div className="space-y-2 border-t border-zinc-800/80 pt-2.5">
    {accountId ? <PlaybookSelect value={settings.aiPlaybookBindings?.[key] || ''} onChange={id => {
      const current = useAppStore.getState();
      const bindings = {...current.settings.aiPlaybookBindings};
      if (id) bindings[key] = id; else delete bindings[key];
      current.updateSettings({aiPlaybookBindings: bindings});
    }}/> : <p className="text-xs text-zinc-500">{t('playbook.accountRequired')}</p>}
    {result.plan&&!result.error&&<p role="status" className="text-2xs text-zinc-500">{result.plan.day?t('plan.current',{name:result.plan.name,day:result.plan.day}):t('plan.notStarted')}{result.plan.next?' · '+t('plan.next',{time:result.plan.next}):' · '+t('plan.finished')}</p>}
    {result.error && <p role="alert" className="text-xs text-rose-400">{result.error}</p>}
    <button type="button" className="text-xs text-brand hover:underline" onClick={() => { const state = useAppStore.getState(); state.setSettingsCategory('playbook'); state.setSettingsOpen(true); }}>{t('playbook.manage')}</button>
  </div>;
}
