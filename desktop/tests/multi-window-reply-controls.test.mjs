import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { multiWindowReplyStatus } from '../src/features/multiWindow/lib/replyStatus.ts';
import { translate } from '../src/i18n/core.ts';

const now = new Date(2026, 9, 29, 12).getTime();
const chat = { id: 'chat-a', accountId: 'account-a' };
const contact = { id: 'contact-a' };
const settings = () => ({ aiReplyMode: 'auto', aiProvider: 'openai', openaiKey: 'fixture',
  aiAutoReplyPolicy: { activeStart: '', activeEnd: '', takeoverMinutes: 30, allowPricing: false },
  waAccounts: [{ id: 'account-a', label: '测试账号 1', phoneE164: '+12025550101' }] });
const message = (direction, minutes, body = 'hello', extra = {}) => ({ chatId: chat.id, direction, body,
  sentAt: new Date(now - minutes * 60000).toISOString(), ...extra });
const status = (config = settings(), messages = [], connected = true, time = now, selectedChat = chat) =>
  multiWindowReplyStatus(config, selectedChat, contact, messages, 'account-a', connected, time);

test('reply status follows folder, personal override and global pause precedence', () => {
  const config = { ...settings(), chatFolders: [{ id: 'folder', name: '售后', chatIds: [chat.id], autoReplyMode: 'manual' }] };
  assert.equal(status(config).status, 'manual');
  assert.equal(status(config).scope.folderName, '售后');
  config.aiAutoReplyModeByChatId = { [chat.id]: 'auto' };
  assert.equal(status(config).status, 'auto');
  assert.equal(status(config).scope.source, 'chat');
  config.aiAutoReplyPaused = true;
  assert.equal(status(config).status, 'paused');
  assert.equal(status(config).scope.source, 'paused');
});

test('automatic mode exposes missing connection, AI, contact and unsupported chat types', () => {
  assert.equal(status(settings(), [], false).status, 'offline');
  assert.equal(status({ ...settings(), aiProvider: 'mock' }).status, 'ai');
  assert.equal(multiWindowReplyStatus(settings(), chat, undefined, [], 'account-a', true, now).status, 'unavailable');
  for (const flag of ['isGroup', 'localOnly']) assert.equal(status(settings(), [], true, now, { ...chat, [flag]: true }).status, 'manual');
});

test('takeover expires with time and AI replies do not count as manual takeover', () => {
  const messages = [message('in', 2), message('out', 1)];
  assert.equal(status(settings(), messages).status, 'takeover');
  assert.equal(status(settings(), messages, true, now + 30 * 60000).status, 'auto');
  assert.equal(status(settings(), [messages[0], { ...messages[1], systemKind: 'ai_auto_reply' }]).status, 'auto');
  assert.equal(status(settings(), [messages[0], { ...messages[1], systemKind: 'scheduled_message' }]).status, 'auto');
  assert.equal(status(settings(), [{ ...messages[1], chatId: 'other-chat' }]).status, 'auto');
});

test('runtime status belongs to the latest incoming message and respects manual and account boundaries',()=>{
 const incoming=message('in',1,'hello',{id:'latest'});
 for(const phase of ['waiting','transcribing','generating','retry','human']){
  const runtime={phase,inboundId:'latest',accountId:'account-a'};
  const check=(config=settings(),event=incoming,state=runtime)=>multiWindowReplyStatus(config,chat,contact,[event],'account-a',true,now,state).status;
  assert.equal(check(),phase);assert.equal(check({...settings(),aiReplyMode:'semi'}),'manual');
  assert.equal(check(settings(),incoming,{...runtime,inboundId:'old'}),'auto');assert.equal(check(settings(),incoming,{...runtime,accountId:'account-b'}),'auto');
 }
});

test('account hours and risk restrictions use the same safety policy as automatic sending', () => {
  const config = { ...settings(), aiAutoReplyPolicyByAccountId: { 'account-a': { activeStart: '13:00', activeEnd: '18:00' } } };
  assert.equal(status(config).status, 'hours');
  config.aiAutoReplyPolicyByAccountId = {};
  const pricing = message('in', 1, '多少钱？');
  assert.equal(status(config, [pricing]).status, 'risk');
  config.aiAutoReplyPolicy.allowPricing = true;
  assert.equal(status(config, [pricing]).status, 'risk');
  assert.equal(status(config, [message('in', 2, '退款'), message('out', 1, 'handled', { systemKind: 'ai_auto_reply' })]).status, 'auto');
});

globalThis.replyControlTranslate = translate;
const mocks = {
  react: 'export const useState=v=>[v,()=>{}];export const useEffect=()=>{};',
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/store/appStore': 'export const useAppStore=fn=>fn(globalThis.replyControlState);useAppStore.getState=()=>globalThis.replyControlState;',
  '@/lib/autoReplyRuntime': 'export const useAutoReplyRuntime=fn=>fn({byChat:globalThis.replyRuntime||{}});',
  '@/i18n': 'export const useI18n=()=>({t:(...a)=>globalThis.replyControlTranslate("zh-CN",...a)});',
  '@/lib/utils': 'export const cn=(...a)=>a.filter(Boolean).join(" ");',
};
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/features/multiWindow/components/MultiWindowReplyControls.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  plugins: [{ name: 'boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: mocks[a.path] }));
  } }] });
const { MultiWindowReplyControls } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const render = (props = {}, config = {}) => {
  const state = { settings: { ...settings(), ...config }, bridge: { connected: false }, updateSettings(patch) { this.settings = { ...this.settings, ...patch }; } };
  globalThis.replyControlState = state;
  return nodes(MultiWindowReplyControls({ chat, contact, messages: [], accountId: 'account-a', connected: true, ...props }));
};

test('reply mode controls reflect scope and persist a per-chat manual/auto choice', () => {
  const tree = render({}, { chatFolders: [{ id: 'folder', name: '售后', chatIds: [chat.id], autoReplyMode: 'manual' }] });
  const group = tree.find(n => n.props.role === 'group');
  const toggles = tree.filter(n => n.props['aria-pressed'] !== undefined);
  assert.equal(tree.some(n => n.type === 'select'), false);
  assert.equal(tree.some(n => n.props.children === '测试账号 1'), false);
  assert.deepEqual(toggles.map(n => n.props.children), ['人工', '自动']);
  assert.equal(toggles[0].props['aria-pressed'], true);
  assert.match(group.props.title, /售后/);
  toggles[1].props.onClick();
  assert.equal(globalThis.replyControlState.settings.aiAutoReplyModeByChatId[chat.id], 'auto');
  assert.deepEqual(globalThis.replyControlState.settings.aiAutoReplyManualChatIds, []);
  toggles[0].props.onClick();
  assert.equal(globalThis.replyControlState.settings.aiAutoReplyModeByChatId[chat.id], 'manual');
});

test('account identity is omitted from the row and unsupported chats stay manual', () => {
  const tree = render({ accountOptions: [{ id: 'chat-a', label: '测试账号 1' }, { id: 'chat-b', label: '测试账号 2' }] });
  assert.equal(tree.some(n => n.type === 'select'), false);
  assert.equal(tree.some(n => n.props.children === '测试账号 1'), false);
  const group = render({ chat: { ...chat, isGroup: true } }).find(n => n.props.role === 'group');
  const toggles = nodes(group).filter(n => n.props['aria-pressed'] !== undefined);
  assert.equal(toggles[0].props['aria-pressed'], true);
  assert.equal(toggles.every(n => n.props.disabled), true);
});

test('the mode group tooltip keeps account scope and work status details', () => {
  const tree = render({ workStatus: 'waiting', children: 'complete-action' }, { aiReplyMode: 'semi' });
  const group = tree.find(n => n.props.role === 'group');
  assert.match(group.props.title, /等客户回复/);
  assert.equal(tree.find(n => n.props.children === '人工').props['aria-pressed'], true);
  assert.equal(tree.find(n => n.props.role === 'status').props.children, '等客户回复');
  assert.equal(tree.some(n => n.props.children === '回复账号'), false);
});

test('cards expose runtime labels and retry details without showing another message or accounts progress',()=>{
 const incoming=message('in',1,'hello',{id:'in-runtime'});
 try{
  for(const [phase,label]of [['transcribing','正在转写'],['generating','正在生成'],['retry','等待重试'],['human','需人工处理']]){
   globalThis.replyRuntime={[chat.id]:{phase,inboundId:incoming.id,accountId:'account-a',reason:'controlled reason',retryAt:now+10000}};
   const group=render({messages:[incoming]}).find(n=>n.props.role==='group');assert.match(group.props.title,new RegExp(label));assert.match(group.props.title,/controlled reason/);assert.match(group.props.title,/重试时间/);
   assert.equal(render({messages:[{...incoming,id:'newer'}]}).find(n=>n.props['aria-pressed']===true).props.children,'自动');
   assert.equal(render({messages:[incoming]},{aiReplyMode:'semi'}).find(n=>n.props['aria-pressed']===true).props.children,'人工');
   globalThis.replyRuntime[chat.id].accountId='other';assert.equal(render({messages:[incoming]}).find(n=>n.props['aria-pressed']===true).props.children,'自动');
  }
 }finally{delete globalThis.replyRuntime;}
});
