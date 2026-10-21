import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatFolderActions } from '../src/store/chatFolderActions.ts';
import { importPhonesToFolder } from '../src/store/importPhonesToFolder.ts';

function fixture({ contacts = [], chats = [], folders, clones = [] }) {
  let settings = { chatFolders: folders, chatFolderClones: clones };
  const persists = [];
  const actions = createChatFolderActions({
    getSettings: () => settings,
    updateSettings: patch => { settings = { ...settings, ...patch }; },
    pushToast() {},
  });
  const deps = {
    getFolder: id => settings.chatFolders.find(f => f.id === id),
    getContacts: () => contacts, getChats: () => chats,
    defaultAccountId: () => 'wa-a', selectedPhoneId: () => 'wa-a',
    addContact: input => {
      const contact = { ...input, id: `new-${contacts.length}` };
      contacts.push(contact);
      chats.push({ id: `chat-${contact.id}`, contactId: contact.id, accountId: input.accountId, unread: 0 });
    },
    prependChat: chat => chats.unshift(chat),
    moveChatToFolder: actions.moveChatToFolder,
    recomputeStats() {}, persist: immediate => persists.push(immediate), pushToast() {},
  };
  return { deps, actions, contacts, chats, persists, settings: () => settings };
}
const person = (n, account = 'wa-a', suffix = '') => ({
  id: `c-${n}${suffix}`, name: `User ${n}`, phone: `+1202555${String(n).padStart(4, '0')}`,
  accountId: account, tags: [], stage: 'new',
});
const chat = (c, suffix = '') => ({ id: `chat-${c.id}${suffix}`, contactId: c.id, accountId: c.accountId, unread: 0 });
const folder = (id, chatIds = [], scope = { type: 'all' }) => ({ id, name: id, sort: 0, chatIds, scope });

test('import 1-10 into A moves existing users 3-8 out of B without duplicating people or losing history', () => {
  const contacts = Array.from({ length: 11 }, (_, i) => person(i + 1));
  const chats = contacts.map(c => ({ ...chat(c), lastMessage: 'existing history', unread: 2 }));
  const before = structuredClone(chats);
  const f = fixture({ contacts, chats, folders: [folder('B', chats.slice(2, 8).map(c => c.id)), folder('A', [chats[0].id]), folder('other', [chats[10].id])] });
  const result = importPhonesToFolder('A', contacts.slice(0, 10).map(c => c.phone).join('\n'), f.deps);
  assert.deepEqual(result, { matched: 10, created: 0, skipped: 0 });
  assert.deepEqual(new Set(f.settings().chatFolders.find(x => x.id === 'A').chatIds), new Set(chats.slice(0, 10).map(c => c.id)));
  assert.deepEqual(f.settings().chatFolders.find(x => x.id === 'B').chatIds, []);
  assert.deepEqual(f.settings().chatFolders.find(x => x.id === 'other').chatIds, [chats[10].id]);
  assert.deepEqual(chats, before);
  assert.equal(contacts.length, 11);
  assert.equal(f.persists.at(-1), true);
});

test('move all placeholder/live/account sibling chats and remove old clone memberships', () => {
  const c = person(3), sibling = person(3, 'wa-b', '-b'), other = person(11);
  const chats = [chat(c), chat(c, '-live'), chat(sibling), chat(other)];
  const f = fixture({ contacts: [c, sibling, other], chats,
    folders: [folder('B', [chats[1].id, chats[2].id]), folder('A')],
    clones: [{ id: 'old', folderId: 'B', sourceChatId: chats[0].id }, { id: 'target', folderId: 'A', sourceChatId: chats[2].id }, { id: 'unrelated', folderId: 'B', sourceChatId: chats[3].id }],
  });
  importPhonesToFolder('A', c.phone, f.deps);
  assert.deepEqual(new Set(f.settings().chatFolders[1].chatIds), new Set(chats.slice(0, 3).map(c => c.id)));
  assert.deepEqual(f.settings().chatFolders[0].chatIds, []);
  assert.deepEqual(f.settings().chatFolderClones.map(c => c.id), ['unrelated']);
  const snapshot = structuredClone(f.settings());
  importPhonesToFolder('A', `${c.phone}\n${c.phone}`, f.deps);
  assert.deepEqual(f.settings(), snapshot, 'repeat imports must not duplicate folder members');
});

test('account-scoped import does not move another account chat sharing the contact', () => {
  const c = person(3), a = chat(c), b = { ...chat(c, '-other'), accountId: 'wa-b', phoneId: 'wa-b' };
  const f = fixture({ contacts: [c], chats: [b, a], folders: [folder('B', [a.id, b.id]), folder('A', [], { type: 'account', accountId: 'wa-a' })] });
  importPhonesToFolder('A', c.phone, f.deps);
  assert.deepEqual(f.settings().chatFolders[0].chatIds, [b.id]);
  assert.deepEqual(f.settings().chatFolders[1].chatIds, [a.id]);
});

test('new contacts and existing contacts without chats get target membership', () => {
  const c = person(3);
  const f = fixture({ contacts: [c], folders: [folder('A')] });
  const result = importPhonesToFolder('A', `${c.phone}\n+12025550004\ninvalid`, f.deps);
  assert.deepEqual(result, { matched: 1, created: 1, skipped: 0 });
  assert.equal(f.settings().chatFolders[0].chatIds.length, 2);
  assert.equal(f.contacts.length, 2);
});

test('normal manual moves preserve explicit clones; invalid targets preserve all memberships', () => {
  const f = fixture({ folders: [folder('B', ['chat']), folder('A')], clones: [{ id: 'copy', folderId: 'B', sourceChatId: 'chat' }] });
  const before = structuredClone(f.settings());
  f.actions.moveChatToFolder('chat', 'missing', { removeClones: true });
  assert.deepEqual(f.settings(), before);
  f.actions.moveChatToFolder('chat', 'A');
  assert.equal(f.settings().chatFolderClones.length, 1);
  assert.deepEqual(f.settings().chatFolders[1].chatIds, ['chat']);
});
