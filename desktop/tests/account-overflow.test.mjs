import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: "export const useMemo = fn => fn(); export const useRef = () => ({current:null}); export const useEffect = () => {}; export const useLayoutEffect = () => {}; export const useState = initial => [initial === false ? globalThis.accountMenuOpen : initial, value => globalThis.accountStateChanges.push(value)];",
  "react/jsx-runtime": "export const jsx = (type, props, key) => ({type,props,key}); export const jsxs = jsx;",
  "lucide-react": "export const Check = () => null; export const ChevronDown = () => null; export const GitBranch = () => null; export const Merge = () => null; export const MessageCircle = () => null; export const Plus = () => null; export const Star = () => null;",
  "react-dom": "export const createPortal = (children, container) => ({type:'portal',props:{children},container});",
  "@/store/appStore": "export const useAppStore = selector => selector({settings:{},messagesByChatId:{}});",
  "@/i18n": "export const translateCurrent = key => key; export const useI18n = () => ({t:(key,args) => key === 'multiAccount.moreAccounts' ? '+' + args.count : key});",
  "@/components/ui/Avatar": "export const Avatar = () => null;",
  "@/components/ui/primitives": "export const SectionLabel = () => null;",
};
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/crm/PersonMultiAccountPanel.tsx', import.meta.url))],
  bundle: true, format: 'esm', platform: 'browser', write: false,
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  plugins: [{name:'account-ui-boundaries', setup(b) {
    b.onResolve({filter:/.*/}, args => mocks[args.path] ? {path:args.path,namespace:'mock'} : undefined);
    b.onLoad({filter:/.*/,namespace:'mock'}, args => ({contents:mocks[args.path]}));
  }}],
});
const { PersonMultiAccountPanel } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
function elements(tree, includePortals = true) {
  if (Array.isArray(tree)) return tree.flatMap(item => elements(item, includePortals));
  if (!tree?.props) return [];
  return [tree, ...(tree.type === 'portal' && !includePortals ? [] : elements(tree.props.children, includePortals))];
}

test('overflow accounts render in a scrollable portal and selection closes the menu', () => {
  globalThis.accountMenuOpen = true;
  globalThis.accountStateChanges = [];
  globalThis.document = {body:{}};
  const accounts = Array.from({length:20}, (_,i) => ({id:'wa-' + (i+1),label:'Account ' + (i+1),status:'connected'}));
  let selected;
  const tree = PersonMultiAccountPanel({variant:'banner',seed:null,contacts:[],chats:[],messages:[],focusAccountId:'wa-20',waAccounts:accounts,onOpenThread:()=>assert.fail('unexpected thread'),onSelectStartAccount:id=>{selected=id;}});
  const main = elements(tree, false).filter(item => item.type === 'button' && item.key?.startsWith('wa-'));
  assert.equal(main.length, 4);
  assert.equal(main.find(item => item.props['aria-current'] === 'true').key, 'wa-20');
  const portal = elements(tree).find(item => item.type === 'portal');
  assert.equal(portal.container, document.body);
  const menu = portal.props.children;
  assert.equal(menu.props.role, 'menu');
  assert.match(menu.props.className, /fixed.*overflow-y-auto/);
  const items = elements(menu).filter(item => item.props.role === 'menuitem');
  assert.equal(items.length, 16);
  assert.equal(new Set([...main, ...items].map(item => item.key)).size, 20);
  const more = elements(tree).find(item => item.props['aria-haspopup'] === 'menu');
  assert.equal(more.props['aria-expanded'], true);
  items.at(-1).props.onClick();
  assert.equal(selected, 'wa-19');
  assert.deepEqual(accountStateChanges, [false]);
});
