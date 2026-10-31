import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAiReplyProfile, resolveFolderAiProfile } from '../src/lib/aiPromptScope.ts';
import { generateSuggestions, getSuggestionContextKey } from '../src/lib/aiSuggest.ts';

const folder = (id, prompt, chatIds = [], scope = { type: 'account', accountId: 'a' }, parentId) =>
  ({ id, name: id, sort: 0, aiSystemPrompt: prompt, chatIds, scope, parentId });
const base = () => ({ aiSystemPrompt: 'GLOBAL ROLE', aiSystemPromptByAccountId: { a: 'ACCOUNT A', b: 'ACCOUNT B' },
  activeAccountId: 'a', chatFolders: [folder('parent', 'PARENT ROLE'), folder('child', '', ['chat'], undefined, 'parent')] });
const contact = { id: 'person', accountId: 'a', tags: [] };
const history = [{ id: 'incoming', chatId: 'chat', accountId: 'a', direction: 'in', body: 'Hello', sentAt: '2026-01-01T00:00:00Z' }];

test('folder identity inherits nearest parent, then account and global; empty values inherit', () => {
  const s = base();
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').folderId, 'parent');
  s.chatFolders[1].aiSystemPrompt = ' CHILD ROLE ';
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').prompt, 'CHILD ROLE');
  s.chatFolders[1].aiSystemPrompt = ' '; s.chatFolders[0].aiSystemPrompt = '';
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').source, 'account');
  delete s.aiSystemPromptByAccountId.a;
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').source, 'global');
  s.aiSystemPrompt = '';
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').source, 'default');
});

test('account primary precedes cross-account primary; clones, browsing view and other accounts cannot change identity', () => {
  const s = base();
  s.chatFolders.unshift(folder('all', 'ALL ROLE', ['chat'], { type: 'all' }), folder('b', 'WRONG ACCOUNT', ['chat'], { type: 'account', accountId: 'b' }));
  s.chatFolderClones = [{ sourceChatId: 'chat', folderId: 'b' }];
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').prompt, 'PARENT ROLE');
  s.accountViewMode = { type: 'account', accountId: 'b' };
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').prompt, 'PARENT ROLE');
  s.chatFolders.find(f => f.id === 'parent').aiSystemPrompt = '';
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').prompt, 'ALL ROLE');
  s.chatFolders.find(f => f.id === 'all').chatIds = [];
  assert.equal(resolveAiReplyProfile(s, 'a', 'chat').prompt, 'ACCOUNT A');
  assert.equal(resolveAiReplyProfile(s, 'b', 'chat').prompt, 'WRONG ACCOUNT');
});

test('folder preview stops cycles and rejects inheritance across account boundaries', () => {
  const s = base(); s.chatFolders[0].parentId = 'child'; s.chatFolders[0].aiSystemPrompt = '';
  assert.equal(resolveFolderAiProfile(s, 'child', 'a').prompt, 'ACCOUNT A');
  s.chatFolders[0].aiSystemPrompt = 'OTHER ACCOUNT';
  s.chatFolders[0].scope.accountId = 'b';
  assert.equal(resolveFolderAiProfile(s, 'child', 'a').prompt, 'ACCOUNT A');
  s.chatFolders[1].scope = undefined;
  s.chatFolders[0].scope.accountId = 'a';
  assert.equal(resolveFolderAiProfile(s, 'child', 'a').prompt, 'OTHER ACCOUNT', 'legacy scope follows the existing account fallback');
});

test('editing, moving or deleting folder identities invalidates request and send-context keys', () => {
  const s = { ...base(), aiProvider: 'custom' };
  const key = () => getSuggestionContextKey(contact, history, s, 'a', { auto: true });
  const original = key();
  s.chatFolders[0].aiSystemPrompt = 'EDITED ROLE'; assert.notEqual(key(), original);
  s.chatFolders[0].aiSystemPrompt = 'PARENT ROLE'; assert.equal(key(), original);
  s.chatFolderClones = [{ sourceChatId: 'chat', folderId: 'elsewhere' }]; assert.equal(key(), original);
  s.chatFolders[1].id = 'sibling'; assert.notEqual(key(), original, 'moving between siblings invalidates cached replies even with the same inherited role');
  s.chatFolders = [folder('different', 'PARENT ROLE', ['chat'])]; assert.notEqual(key(), original, 'same text in a different folder is still a new identity source');
  s.chatFolders = []; assert.notEqual(key(), original);
  const emptyKey = getSuggestionContextKey(contact, [], base(), 'a', { chatId: 'chat' });
  assert.ok(emptyKey.includes('PARENT ROLE'), 'empty conversations use their explicit chat id');
});

test('all provider paths and manual/selected/automatic replies use one folder profile without mixing identities', async t => {
  let system;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    const body = JSON.parse(opts.body);
    system = body.systemInstruction?.parts[0].text || body.messages?.[0].content;
    const text = '[{"text":"Hello there"}]';
    return Response.json({ choices: [{ message: { content: text } }], candidates: [{ content: { parts: [{ text }] } }], message: { content: text } });
  });
  for (const aiProvider of ['custom', 'gemini', 'ollama']) for (const opts of [{}, { auto: true }, { replyTo: history[0] }]) {
    const s = { ...base(), aiProvider, aiModel: 'test-model', customAiBaseUrl: 'https://example.invalid', customAiModel: 'test', customAiKey: 'test', geminiKey: 'test', ollamaUrl: 'http://localhost:11434' };
    const result = await generateSuggestions(contact, history, s, { accountId: 'a', ...opts });
    assert.equal(result.fallback, false);
    assert.ok(system.includes('PARENT ROLE'));
    assert.ok(!system.includes('GLOBAL ROLE') && !system.includes('ACCOUNT A'));
    assert.ok(system.includes('no-invention rules'), 'folder prompts retain the existing safety rules');
  }
});
