import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {importPlaybooks, normalizePlaybooks, normalizePlaybookBindings, playbookBindingKey, remapPlaybookBindings, resolvePlaybook} from '../src/lib/aiPlaybooks.ts';
import {resolveAiReplyProfile} from '../src/lib/aiPromptScope.ts';
import {generateSuggestions, getSuggestionContextKey} from '../src/lib/aiSuggest.ts';

const book = (id, summary = id) => ({id, name: id, sourceName: `${id}.md`, content: `FULL SOURCE ${id}`, summary});
const config = () => ({aiPlaybooks: [book('overview'), book('stage-a'), book('stage-b')], aiPlaybookOverviewId: 'overview', aiPlaybookBindings: {}, aiSystemPrompt: 'SENDER IDENTITY', aiSystemPromptByAccountId: {}, activeAccountId: 'a', liveBaileysAccountId: 'a', chatFolders: [
  {id: 'parent', chatIds: [], scope: {type: 'account', accountId: 'a'}, aiPlaybookId: 'stage-a'},
  {id: 'child', parentId: 'parent', chatIds: ['chat'], scope: {type: 'account', accountId: 'a'}},
  {id: 'other', chatIds: ['chat'], scope: {type: 'account', accountId: 'b'}, aiPlaybookId: 'stage-b'},
]});

test('Markdown import populates actual names, keeps stable bindings and invalidates stale summaries on changed long sources', () => {
  const first = importPlaybooks([], [{name: 'first.md', text: 'Short rules'}, {name: 'long.md', text: 'x'.repeat(7000)}]);
  assert.equal(first[0].name, 'first'); assert.equal(first[0].summary, 'Short rules'); assert.equal(first[1].summary, '');
  first[1].summary = 'Reviewed long rules';
  const same = importPlaybooks(first, [{name: 'long.md', text: 'x'.repeat(7000)}]);
  assert.equal(same[1].summary, 'Reviewed long rules');
  const updated = importPlaybooks(same, [{name: 'long.md', text: 'y'.repeat(7000)}]);
  assert.equal(updated[1].id, first[1].id); assert.equal(updated[1].summary, ''); assert.equal(first[1].summary, 'Reviewed long rules');
  assert.throws(() => importPlaybooks(first, [{name:'bad.txt', text:'rules'}]));
  assert.throws(() => importPlaybooks(first, [{name:'first.md', text:'a'}, {name:'first.md', text:'b'}]));
  assert.throws(() => importPlaybooks(first, [{name:'huge.md', text:'x'.repeat(200001)}]));
});

test('normalization rejects malformed documents and bindings without repairing them to another stage', () => {
  assert.deepEqual(normalizePlaybooks([book('ok'), book('ok'), book('off'), {...book('bad'), summary:'x'.repeat(6001)}]).map(item => item.id), ['ok']);
  const key = playbookBindingKey('a','chat');
  assert.deepEqual(normalizePlaybookBindings({[key]:'missing', bad:'stage-a', '["a"]':'stage-b'}), {[key]:'missing'});
});

test('customer overrides, parent folders, account isolation, and explicit off resolve consistently', () => {
  const s = config();
  assert.equal(resolvePlaybook(s,'a','chat').id, 'stage-a');
  assert.equal(resolvePlaybook(s,'b','chat').id, 'stage-b');
  s.aiPlaybookBindings[playbookBindingKey('a','chat')] = 'stage-b';
  assert.equal(resolvePlaybook(s,'a','chat').source, 'customer');
  assert.equal(resolvePlaybook(s,'a','chat').id, 'stage-b');
  s.aiPlaybookBindings[playbookBindingKey('a','chat')] = 'off';
  assert.match(resolvePlaybook(s,'a','chat').prompt, /No Playbook is active/);
  delete s.aiPlaybookBindings[playbookBindingKey('a','chat')]; s.chatFolders[0].aiPlaybookId = 'off';
  assert.equal(resolvePlaybook(s,'a','chat').id,'off');
  s.chatFolders[0].aiPlaybookId = undefined; s.chatFolders[0].parentId = 'child';
  assert.equal(resolvePlaybook(s,'a','chat').source, 'none');
});

test('chat merges retain account-scoped bindings and conflicting stages require a fresh choice', () => {
  const original = {[playbookBindingKey('a','old')]:'stage-a', [playbookBindingKey('b','old')]:'stage-b'};
  const moved = remapPlaybookBindings(original, new Map([['old','chat']]));
  assert.equal(moved[playbookBindingKey('a','chat')],'stage-a');
  assert.equal(moved[playbookBindingKey('b','chat')],'stage-b');
  const s = config();
  s.aiPlaybookBindings = remapPlaybookBindings({...original,[playbookBindingKey('a','chat')]:'stage-b'},new Map([['old','chat']]));
  assert.match(resolvePlaybook(s,'a','chat').error,/冲突/);
  assert.deepEqual(remapPlaybookBindings(moved,new Map([['chat',null]])),{});
});

test('missing material and unreviewed summaries block generation; whole sources never enter prompts', () => {
  const s = config();
  let result = resolveAiReplyProfile(s, 'a', 'chat');
  assert.match(result.prompt, /SENDER IDENTITY/); assert.match(result.prompt, /stage-a/); assert.match(result.prompt, /overview/);
  assert.doesNotMatch(result.prompt, /stage-b|FULL SOURCE/);
  s.aiPlaybooks = s.aiPlaybooks.filter(item => item.id !== 'stage-a');
  assert.ok(resolveAiReplyProfile(s,'a','chat').error);
  s.aiPlaybooks.push(book('stage-a', ''));
  assert.match(resolveAiReplyProfile(s,'a','chat').error, /精简/);
  s.aiPlaybooks.find(item => item.id === 'stage-a').summary = 'valid'; s.aiPlaybookOverviewId = 'deleted';
  assert.ok(resolveAiReplyProfile(s,'a','chat').error);
});

test('actual AI requests contain only the selected concise material and updates invalidate cached suggestions', async t => {
  const s = {...config(), aiProvider:'custom', customAiKey:'test', customAiBaseUrl:'https://example.invalid/v1', customAiModel:'model'};
  const contact = {id:'person',accountId:'a',name:'Customer',tags:[]};
  const messages = [{id:'message',chatId:'chat',accountId:'a',direction:'in',body:'Hello',sentAt:'2026-11-10T00:00:00Z'}];
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {body=JSON.parse(init.body);return Response.json({choices:[{message:{content:'[{"text":"Hello"}]'}}]});});
  assert.equal((await generateSuggestions(contact,messages,s,{accountId:'a',chatId:'chat',count:1})).fallback,false);
  assert.match(body.messages[0].content,/stage-a/); assert.doesNotMatch(body.messages[0].content,/stage-b|FULL SOURCE/);
  const before = getSuggestionContextKey(contact,messages,s,'a',{chatId:'chat'});
  s.aiPlaybooks.find(item=>item.id==='stage-a').summary = 'UPDATED RULES';
  assert.notEqual(getSuggestionContextKey(contact,messages,s,'a',{chatId:'chat'}),before);
});

const src=fileURLToPath(new URL('../src',import.meta.url));
const built=await build({stdin:{contents:`export {defaultSettings, normalizeLoadedSettings} from './store/settingsDefaults'; export {buildSettingsSafe, parseBackupJson} from './lib/exportData';`,resolveDir:src},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':src}});
const {defaultSettings,normalizeLoadedSettings,buildSettingsSafe,parseBackupJson}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('long base identities survive reload and inherit without a Playbook', () => {
  const prompt = 'Base rule. '.repeat(1000).trim();
  const restored = normalizeLoadedSettings({ ...defaultSettings, aiSystemPrompt: prompt, aiSystemPromptByAccountId: { a: prompt } });
  assert.equal(restored.aiSystemPromptByAccountId.a, prompt);
  assert.equal(resolveAiReplyProfile(restored, 'a', 'unbound').prompt, prompt);
  assert.equal(resolveAiReplyProfile(restored, 'other', 'unbound').prompt, prompt);
});
test('library and account-scoped bindings survive settings reload and backup restoration', () => {
  const settings = {...defaultSettings, ...config(), aiPlaybookBindings:{[playbookBindingKey('a','chat')]:'stage-b'}};
  const safe = buildSettingsSafe(settings);
  const parsed = parseBackupJson({version:2, contacts:[{id:'person',name:'Customer',phone:'+15551234567',tags:[]}], settingsSafe:safe});
  const restored = normalizeLoadedSettings(parsed.settingsSafe);
  assert.equal(restored.aiPlaybooks.length,3);
  assert.equal(restored.aiPlaybookOverviewId,'overview');
  assert.equal(restored.aiPlaybookBindings[playbookBindingKey('a','chat')],'stage-b');
  assert.equal(restored.chatFolders.find(folder=>folder.id==='parent').aiPlaybookId,'stage-a');
});

test('conversation plans and folder schedules survive normalization and backup restore',()=>{
 const schedule={planId:'plan',startDate:'2026-11-11',timeZone:'Europe/Paris',switchTime:'09:00'};
 const settings=normalizeLoadedSettings({...defaultSettings,aiPlaybookPlans:[{id:'plan',name:'Welcome',days:['one','two']}],chatFolders:[{id:'f',name:'F',sort:0,chatIds:[],scope:{type:'all'},aiPlaybookSchedule:schedule}]});
 const restored=normalizeLoadedSettings(parseBackupJson({version:2,settingsSafe:buildSettingsSafe(settings),contacts:[{id:"person",name:"Customer",phone:"+15551234567",tags:[]}],chats:[],messages:[]}).settingsSafe);
 assert.deepEqual(restored.aiPlaybookPlans,settings.aiPlaybookPlans);assert.deepEqual(restored.chatFolders[0].aiPlaybookSchedule,schedule);
});
