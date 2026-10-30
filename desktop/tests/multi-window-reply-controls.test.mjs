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
  assert.equal(status(config, [pricing]).status, 'auto');
  assert.equal(status(config, [message('in', 2, '退款'), message('out', 1, 'handled', { systemKind: 'ai_auto_reply' })]).status, 'auto');
});

globalThis.replyControlTranslate = translate;
const mocks = {
  react: 'export const useState=v=>[v,()=>{}];export const useEffect=()=>{};',
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/store/appStore': 'export const useAppStore=fn=>fn(globalThis.replyControlState);',
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
  globalThis.replyControlState = { settings: { ...settings(), ...config }, phones: [{ id: 'phone-a', name: '工作手机' }], bridge: { connected: false } };
  return nodes(MultiWindowReplyControls({ chat, contact, messages: [], accountId: 'account-a', connected: true, ...props }));
};

test('single-account cards always show sender identity and the effective rule source', () => {
  const tree = render({}, { chatFolders: [{ id: 'folder', name: '售后', chatIds: [chat.id], autoReplyMode: 'manual' }] });
  assert.equal(tree.some(n => n.type === 'select'), false);
  const sender = tree.find(n => n.props.children === '测试账号 1');
  assert.match(sender.props.title, /测试账号 1.*12025550101/);
  const badge = tree.find(n => n.props.role === 'status');
  assert.equal(badge.props.children, '人工');
  assert.match(badge.props.title, /售后/);
  assert.equal(badge.props['aria-label'], badge.props.title);
});

test('multi-account selection keeps chat routing and Android cards show the sending device', () => {
  let selected;
  const tree = render({ accountOptions: [{ id: 'chat-a', label: '测试账号 1' }, { id: 'chat-b', label: '测试账号 2' }], onSelectAccount: id => selected = id });
  const select = tree.find(n => n.type === 'select');
  assert.equal(select.props.value, chat.id);
  select.props.onChange({ target: { value: 'chat-b' } });
  assert.equal(selected, 'chat-b');
  const android = render({ chat: { ...chat, phoneId: 'phone-a' } }, { sendChannel: 'android_bridge' });
  assert.ok(android.find(n => n.props.children === '工作手机'));
  assert.equal(android.find(n => n.props.role === 'status').props.children, '自动 待连接');
});

test('the compact row keeps account count in its tooltip and combines mode with work status', () => {
  const tree = render({ workStatus: 'waiting', accountCount: 2, children: 'complete-action' }, { aiReplyMode: 'semi' });
  const sender = tree.find(n => n.props.children === '测试账号 1');
  assert.match(sender.props.title, /2 个账号/);
  assert.equal(tree.find(n => n.props.role === 'status').props.children, '人工 · 等客户回复');
  assert.equal(tree.some(n => n.props.children === '回复账号'), false);
});

test('cards expose runtime labels and retry details without showing another message or accounts progress',()=>{
 const incoming=message('in',1,'hello',{id:'in-runtime'});
 try{
  for(const [phase,label]of [['transcribing','正在转写'],['generating','正在生成'],['retry','等待重试'],['human','需人工处理']]){
   globalThis.replyRuntime={[chat.id]:{phase,inboundId:incoming.id,accountId:'account-a',reason:'controlled reason',retryAt:now+10000}};
   const badge=render({messages:[incoming]}).find(n=>n.props.role==='status');assert.equal(badge.props.children,label);assert.match(badge.props.title,/controlled reason/);assert.match(badge.props.title,/重试时间/);
   assert.equal(render({messages:[{...incoming,id:'newer'}]}).find(n=>n.props.role==='status').props.children,'自动');
   assert.equal(render({messages:[incoming]},{aiReplyMode:'semi'}).find(n=>n.props.role==='status').props.children,'人工');
   globalThis.replyRuntime[chat.id].accountId='other';assert.equal(render({messages:[incoming]}).find(n=>n.props.role==='status').props.children,'自动');
  }
 }finally{delete globalThis.replyRuntime;}
});
