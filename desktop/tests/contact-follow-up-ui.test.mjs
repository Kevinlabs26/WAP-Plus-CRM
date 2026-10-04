import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import zh from '../src/i18n/locales/zh-CN.ts';
import en from '../src/i18n/locales/en.ts';
import fr from '../src/i18n/locales/fr.ts';

const mocks = {
  react: `export const useRef = value => globalThis.followUpUiHooks.ref(value);
    export const useState = value => globalThis.followUpUiHooks.state(value);
    export const useEffect = (fn, deps) => globalThis.followUpUiHooks.effect(fn, deps);`,
  'react/jsx-runtime': 'export const jsx = (type, props, key) => ({type, props, key}); export const jsxs = jsx;',
  '@/store/appStore': `export const useAppStore = selector => selector(globalThis.followUpUiStore);
    useAppStore.getState = () => globalThis.followUpUiStore;`,
  '@/i18n': 'export const useI18n = () => ({t: globalThis.followUpUiTranslate});',
  '@/lib/utils': `export const cn = (...items) => items.filter(Boolean).join(' ');
    export const displayPhone = value => value;`,
  '@/components/ui/primitives': `export const Button = 'button'; export const Input = 'input'; export const Textarea = 'textarea';`,
  '@/components/ui/Avatar': 'export const Avatar = () => null;',
  '@/components/crm/ActivityTimeline': 'export const ActivityTimeline = () => null;',
  '@/components/crm/ContactTagsNotesEditor': 'export const ContactTagsNotesEditor = () => null;',
  '@/components/chat/speakMessage': 'export const SPEECH_LANG_OPTIONS = [];',
  'lucide-react': 'export const CalendarPlus = () => null; export const MessageSquare = () => null; export const CalendarClock = () => null; export const X = () => null;',
};
const built = await build({
  stdin: { contents: `export { ContactEditor } from './src/components/crm/ContactEditor.tsx';
    export { ChatFollowUpDialog } from './src/components/chat/ChatFollowUpDialog.tsx';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  alias: { '@': fileURLToPath(new URL('../src/', import.meta.url)) },
  plugins: [{ name: 'contact-follow-up-ui-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { ContactEditor, ChatFollowUpDialog } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function runtime() {
  const cells = [], effects = []; let cursor = 0;
  const hooks = {
    ref(value) { return cells[cursor++] ??= { current: value }; },
    state(value) { const index = cursor++; cells[index] ??= { value: typeof value === 'function' ? value() : value };
      return [cells[index].value, next => { cells[index].value = typeof next === 'function' ? next(cells[index].value) : next; }]; },
    effect(fn, deps) { const index = cursor++, previous = cells[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      cells[index] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { cells[index].cleanup?.(); cells[index].cleanup = fn(); }); },
  };
  return {
    render(fn) { globalThis.followUpUiHooks = hooks; cursor = 0; const tree = fn(); while (effects.length) effects.shift()(); return tree; },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree?.props) return text(tree.props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function button(tree, label) {
  const found = nodes(tree).find(node => node.type === 'button' && text(node) === label);
  assert.ok(found, `Missing button: ${label}`); return found;
}
const contact = (id = 'customer-a') => ({ id, name: id, phone: '+33600000000', stage: 'new', tags: [] });
const task = (id, dueAt, extra = {}) => ({ id, contactId: 'customer-a', contactName: 'customer-a', dueAt, note: '确认报价与运费', done: false, ...extra });
function fixture(input = {}) {
  const originalWindow = globalThis.window; globalThis.window = new EventTarget();
  globalThis.followUpUiTranslate = (key, params = {}) => String(zh[key] || key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
  const component = runtime(), dialogs = new Map(), schedules = [], cancellations = [], updates = [], toasts = [];
  const store = { followUps: input.followUps || [], cancelFollowUp(id) {
    cancellations.push(id);
    const current = store.followUps.find(item => item.id === id && !item.done);
    if (!current) return false;
    store.followUps = store.followUps.map(item => item.id === id ? {...item, done: true, cancelled: true} : item);
    return true;
  } };
  globalThis.followUpUiStore = store;
  let selected = input.contact || contact();
  const props = () => ({ contact: selected, title: selected.name, needsName: false, phones: [], stages: [], compact: !!input.compact,
    updateContact: (...args) => updates.push(args), openContactWorkspace() {},
    scheduleFollowUp: (...args) => { schedules.push(args); return {dueAt: args[1]}; },
    scheduleTomorrowFollowUp: () => { throw new Error('Unexpected tomorrow shortcut'); },
    pushToast: (...args) => toasts.push(args) });
  const render = () => component.render(() => ContactEditor(props()));
  const dialogNode = () => nodes(render()).find(node => node.type === ChatFollowUpDialog);
  const dialog = () => {
    const node = dialogNode(); assert.ok(node, 'Missing scheduling dialog');
    let mounted = dialogs.get(node.key); if (!mounted) { mounted = runtime(); dialogs.set(node.key, mounted); }
    return mounted.render(() => ChatFollowUpDialog(node.props));
  };
  return { render, dialog, dialogNode, store, schedules, cancellations, updates, toasts,
    select(value) { selected = value; render(); },
    cleanup() { for (const mounted of dialogs.values()) mounted.unmount(); component.unmount(); globalThis.window = originalWindow; },
  };
}

test('complete customer details show the actual earliest task datetime and note, with no independent date edit', () => {
  const f = fixture({ contact: {...contact(), nextFollowUpAt: '2026-12-31'}, followUps: [
    task('later', '2026-10-06T15:30'), task('first', '2026-10-05T10:00'), task('done', '2026-10-01', {done: true}),
  ] });
  try {
    const tree = f.render(), time = nodes(tree).find(node => node.type === 'time');
    assert.equal(time.props.dateTime, '2026-10-05T10:00'); assert.equal(text(time), '2026-10-05 10:00');
    assert.match(text(tree), /确认报价与运费/); assert.doesNotMatch(text(tree), /2026-12-31/);
    assert.equal(nodes(tree).some(node => node.type === 'input' && node.props.type === 'date'), false);
    assert.deepEqual(f.updates, []); assert.deepEqual(f.schedules, []);
  } finally { f.cleanup(); }
});

test('an old recorded date is clearly unscheduled and only prefilled in the real scheduling dialog', () => {
  const f = fixture({ contact: {...contact(), nextFollowUpAt: '2026-10-06'}, compact: true });
  try {
    assert.match(text(f.render()), /记录日期：2026-10-06，尚未安排提醒/);
    assert.equal(nodes(f.render()).some(node => node.type === 'button' && text(node) === zh['contact.followUpCancelReminder']), false);
    button(f.render(), zh['contact.followUpSetReminder']).props.onClick();
    const dialog = f.dialog(), date = nodes(dialog).find(node => node.type === 'input' && node.props.type === 'datetime-local');
    assert.equal(date.props.value, '2026-10-06T10:00');
    button(dialog, zh['common.cancel']).props.onClick();
    assert.equal(f.dialogNode(), undefined); assert.deepEqual(f.schedules, []); assert.deepEqual(f.updates, []);
  } finally { f.cleanup(); }
});

test('the real scheduling dialog preserves the task note and writes one formal schedule only on save', () => {
  const f = fixture({ followUps: [task('first', '2026-10-05T10:00')] });
  try {
    button(f.render(), zh['contact.followUpReschedule']).props.onClick();
    let dialog = f.dialog();
    assert.equal(nodes(dialog).find(node => node.type === 'textarea').props.value, '确认报价与运费');
    nodes(dialog).find(node => node.type === 'input').props.onChange({target: {value: '2026-10-07T14:25'}});
    assert.deepEqual(f.schedules, []); assert.deepEqual(f.updates, []);
    dialog = f.dialog(); nodes(dialog).find(node => node.type === 'form').props.onSubmit({preventDefault() {}});
    assert.deepEqual(f.schedules, [['customer-a', '2026-10-07T14:25', '确认报价与运费']]);
    assert.equal(f.dialogNode(), undefined); assert.equal(f.toasts.at(-1)[1], 'success');
  } finally { f.cleanup(); }
});

test('cancel targets only the displayed current task and leaves the other task and retained history available', () => {
  const later = task('later', '2026-10-08T15:30');
  const f = fixture({ followUps: [later, task('first', '2026-10-05T10:00')] });
  try {
    button(f.render(), zh['contact.followUpCancelReminder']).props.onClick();
    assert.deepEqual(f.cancellations, ['first']); assert.equal(f.store.followUps[0], later);
    assert.equal(f.store.followUps[1].done, true); assert.equal(f.store.followUps[1].cancelled, true);
    assert.equal(nodes(f.render()).find(node => node.type === 'time').props.dateTime, later.dueAt);
    assert.equal(f.toasts.at(-1)[0], zh['contact.followUpCancelled']); assert.deepEqual(f.schedules, []);
  } finally { f.cleanup(); }
});

test('switching customers closes the dialog and rejects its stale submit even after switching back', () => {
  const f = fixture({ followUps: [task('first', '2026-10-05T10:00')] });
  try {
    button(f.render(), zh['contact.followUpReschedule']).props.onClick();
    const old = f.dialogNode().props.onSubmit;
    f.select(contact('customer-b')); assert.equal(f.dialogNode(), undefined);
    old('2026-10-09T12:00', 'stale customer A'); assert.deepEqual(f.schedules, []);
    f.select(contact()); old('2026-10-09T12:00', 'stale after return'); assert.deepEqual(f.schedules, []);
    button(f.render(), zh['contact.followUpReschedule']).props.onClick();
    assert.equal(f.dialogNode().props.initialNote, '确认报价与运费');
  } finally { f.cleanup(); }
});

for (const change of ['dueAt', 'note', 'done']) test(`a ${change} change while the dialog is open rejects its stale formal schedule`, () => {
  const f = fixture({ followUps: [task('first', '2026-10-05T10:00')] });
  try {
    button(f.render(), zh['contact.followUpReschedule']).props.onClick();
    const submit = f.dialogNode().props.onSubmit;
    f.store.followUps = [task('first', '2026-10-05T10:00', {
      ...(change === 'dueAt' ? {dueAt: '2026-10-11T10:00'} : {}),
      ...(change === 'note' ? {note: '另一窗口的新备注'} : {}),
      ...(change === 'done' ? {done: true, cancelled: true} : {}),
    })];
    submit('2026-10-09T12:00', 'stale note');
    assert.deepEqual(f.schedules, []); assert.equal(f.dialogNode(), undefined);
    assert.equal(f.toasts.at(-1)[0], zh['contact.followUpChanged']);
  } finally { f.cleanup(); }
});

test('new reminder controls and history statuses are translated in Chinese, English and French', () => {
  for (const locale of [zh, en, fr]) for (const key of [
    'contact.followUpSetReminder', 'contact.followUpReschedule', 'contact.followUpCancelReminder',
    'contact.followUpCancelled', 'contact.followUpRecorded', 'contact.followUpUnset', 'contact.followUpChanged',
    'followUps.history', 'followUps.statusCompleted', 'followUps.statusCancelled', 'followUps.reopen',
    'followUps.reopened', 'followUps.noPending', 'followUps.noPendingHint', 'followUps.historyCount',
  ]) assert.ok(typeof locale[key] === 'string' && locale[key].trim(), `Missing translation: ${key}`);
});
