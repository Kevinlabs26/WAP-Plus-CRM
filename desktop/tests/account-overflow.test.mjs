import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: `
    export const useMemo = fn => fn();
    export const useRef = initial => globalThis.accountHarness.useRef(initial);
    export const useEffect = () => {};
    export const useLayoutEffect = (fn, deps) => globalThis.accountHarness.useLayoutEffect(fn, deps);
    export const useState = initial => globalThis.accountHarness.useState(initial);
  `,
  "react/jsx-runtime": "export const jsx = (type, props, key) => ({type,props,key}); export const jsxs = jsx;",
  "lucide-react": "export const Check = () => null; export const ChevronDown = () => null; export const GitBranch = () => null; export const Merge = () => null; export const MessageCircle = () => null; export const Plus = () => null; export const Star = () => null;",
  "react-dom": "export const createPortal = (children, container) => ({type:'portal',props:{children},container});",
  "@/store/appStore": "export const useAppStore = selector => selector({settings:{},messagesByChatId:{}});",
  "@/i18n": "export const translateCurrent = key => key; const t = (key,args) => key === 'multiAccount.moreAccounts' ? '+' + args.count : key; export const useI18n = () => ({t});",
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
const { PersonMultiAccountPanel } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=PersonMultiAccountPanel.test-bundle.js').toString('base64'));
function elements(tree, includePortals = true) {
  if (Array.isArray(tree)) return tree.flatMap(item => elements(item, includePortals));
  if (!tree?.props) return [];
  return [tree, ...(tree.type === 'portal' && !includePortals ? [] : elements(tree.props.children, includePortals))];
}

function normalFlowText(tree) {
  if (Array.isArray(tree)) return tree.map(normalFlowText).join('');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree?.props || /(?:^|\s)absolute(?:\s|$)/.test(tree.props.className || '')) return '';
  return normalFlowText(tree.props.children);
}

function accountHarness({ count = 5, width = 440, widths = {}, focus = `wa-${count}`, onSelect = () => {} } = {}) {
  const state = [], refs = [], effects = [], observers = new Set(), buttons = new Map();
  const harness = {
    width, widths, stateChanges: [], tree: null,
    useState(initial) {
      const index = this.stateIndex++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => {
        const next = typeof value === 'function' ? value(state[index]) : value;
        this.stateChanges.push(next);
        if (!Object.is(state[index], next)) { state[index] = next; this.dirty = true; }
      }];
    },
    useRef(initial) {
      const index = this.refIndex++;
      return refs[index] ||= {current: initial};
    },
    useLayoutEffect(fn, deps) {
      const index = this.effectIndex++;
      const previous = effects[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        this.pending.push(() => {
          previous?.cleanup?.();
          effects[index] = {deps, cleanup: fn()};
        });
      }
    },
    main() {
      return elements(this.tree, false).filter(item => item.type === 'button' && item.props['data-account-id']);
    },
    visible() { return this.main().filter(item => item.props['aria-hidden'] !== true); },
    more() { return elements(this.tree, false).find(item => item.props['aria-haspopup'] === 'menu'); },
    menuWrapper() {
      return elements(this.tree, false).filter(item => item.type === 'div' && elements(item.props.children, false).includes(this.more())).at(-1);
    },
    render() {
      for (let pass = 0; pass < 10; pass++) {
        this.stateIndex = this.refIndex = this.effectIndex = 0;
        this.pending = []; this.dirty = false;
        this.tree = PersonMultiAccountPanel(this.props);
        for (const item of elements(this.tree)) {
          if (!item.props.ref) continue;
          const node = item.type === 'button' ? trigger : item.props.role === 'menu' ? popup
            : item === this.menuWrapper() ? wrapper
            : elements(item.props.children, false).some(child => child.props['data-account-id']) ? strip : row;
          node.props = item.props;
          item.props.ref.current = node;
        }
        for (const effect of this.pending) effect();
        if (!this.dirty) return this.tree;
      }
      assert.fail('account layout did not settle');
    },
    resize(nextWidth = this.width) {
      this.width = nextWidth;
      for (const observer of [...observers]) {
        if (observer.targets.has(row) || observer.targets.has(strip)) observer.callback([]);
      }
      return this.render();
    },
    resizeAccount(id, nextWidth) {
      this.widths[id] = nextWidth;
      for (const observer of [...observers]) {
        if (observer.targets.has(buttons.get(id))) observer.callback([]);
      }
      return this.render();
    },
  };
  const matches = (item, selector) => selector.includes('data-account-id') ? Boolean(item.props['data-account-id'])
    : selector.includes('aria-current') ? item.props['aria-current'] === 'true'
    : selector.includes('menuitem') ? item.props.role === 'menuitem' : item.type === 'button';
  const node = widthOf => ({
    get offsetWidth() { return widthOf(); },
    get clientWidth() { return widthOf(); },
    scrollHeight: 300,
    getAttribute(name) { return this.props?.[name] == null ? null : String(this.props[name]); },
    getBoundingClientRect: () => ({left: 100, right: 100 + widthOf(), top: 400, bottom: 430, width: widthOf(), height: 30}),
    focus() {}, scrollIntoView() {}, contains() { return false; },
    querySelectorAll(selector) {
      return elements(harness.tree).filter(item => matches(item, selector)).map(item => {
        if (item.props['aria-haspopup']) return trigger;
        const id = item.props['data-account-id'] || item.key;
        if (!buttons.has(id)) buttons.set(id, node(() => harness.widths[id] ?? 80));
        const button = buttons.get(id);
        button.dataset = {accountId: id};
        button.getAttribute = name => item.props[name];
        return button;
      });
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  });
  const moreWidth = () => 32 + 6 * normalFlowText(harness.more()).length;
  const trigger = node(moreWidth), wrapper = node(moreWidth), row = node(() => harness.width + 100);
  const strip = node(() => harness.width - (harness.menuWrapper()?.props['aria-hidden'] === true ? 0 : moreWidth() + 6));
  const popup = node(() => 288);
  Object.defineProperty(popup, 'scrollHeight', {get: () => elements(harness.tree).filter(item => item.props.role === 'menuitem').length * 34});
  strip.parentElement = row; trigger.parentElement = wrapper; wrapper.parentElement = row;
  globalThis.accountHarness = harness;
  globalThis.getComputedStyle = () => ({gap: '6px', columnGap: '6px'});
  globalThis.window = {innerWidth: 1000, innerHeight: 800, getComputedStyle, addEventListener() {}, removeEventListener() {}};
  globalThis.document = {body: {}, addEventListener() {}, removeEventListener() {}};
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { observers.delete(this); }
  };
  harness.props = {
    variant: 'banner', seed: null, contacts: [], chats: [], messages: [], focusAccountId: focus,
    waAccounts: Array.from({length: count}, (_, i) => ({id: `wa-${i + 1}`, label: `Account ${i + 1}`, status: 'connected'})),
    onOpenThread: () => assert.fail('unexpected thread'), onSelectStartAccount: onSelect,
  };
  harness.render();
  return harness;
}

test('five accounts use available space, including the exact all-fit boundary', () => {
  const harness = accountHarness({width: 424});
  assert.equal(harness.visible().length, 5);
  assert.equal(harness.more().props.tabIndex, -1);
  assert.equal(harness.menuWrapper().props['aria-hidden'], true);
});

test('resizing preserves the current account and keeps folded buttons out of keyboard navigation', () => {
  const harness = accountHarness();
  harness.resize(320);
  assert.deepEqual(harness.visible().map(item => item.key), ['wa-1', 'wa-2', 'wa-5']);
  const folded = harness.main().filter(item => item.props['aria-hidden'] === true);
  assert.equal(folded.length, 2);
  for (const item of folded) {
    assert.match(item.props.className, /invisible/);
    assert.equal(item.props.tabIndex, -1);
  }
  assert.equal(harness.more().props.tabIndex, undefined);
  harness.resize(500);
  assert.equal(harness.visible().length, 5);
  assert.equal(harness.menuWrapper().props['aria-hidden'], true);
});

test('the current account actual width participates in fitting and button resize is remeasured', () => {
  const harness = accountHarness({width: 350});
  assert.equal(harness.visible().length, 3);
  harness.resizeAccount('wa-5', 176);
  assert.deepEqual(harness.visible().map(item => item.key), ['wa-1', 'wa-5']);
  harness.resize(100);
  assert.deepEqual(harness.visible().map(item => item.key), ['wa-5']);
});

test('overflow accounts render in a scrollable portal and selection closes the menu', () => {
  let selected;
  const harness = accountHarness({count: 20, width: 400, onSelect: id => { selected = id; }});
  harness.more().props.onClick();
  harness.render();
  const main = harness.visible();
  assert.equal(main.length, 4);
  assert.equal(main.find(item => item.props['aria-current'] === 'true').key, 'wa-20');
  const portal = elements(harness.tree).find(item => item.type === 'portal');
  assert.equal(portal.container, document.body);
  const menu = portal.props.children;
  assert.equal(menu.props.role, 'menu');
  assert.match(menu.props.className, /fixed.*overflow-y-auto/);
  const items = elements(menu).filter(item => item.props.role === 'menuitem');
  assert.equal(items.length, 16);
  assert.equal(new Set([...main, ...items].map(item => item.key)).size, 20);
  assert.equal(harness.more().props['aria-expanded'], true);
  harness.resize(1100);
  const resizedMenu = elements(harness.tree).find(item => item.props.role === 'menu');
  assert.ok(resizedMenu.props.style.top > menu.props.style.top, 'a shorter menu should be repositioned above its anchor');
  elements(resizedMenu).filter(item => item.props.role === 'menuitem').at(-1).props.onClick();
  assert.equal(selected, 'wa-19');
  assert.equal(harness.stateChanges.at(-1), false);
  harness.render();
  assert.equal(harness.more().props['aria-expanded'], false);
});

test('showing all accounts closes the menu and later shrinking does not reopen it', () => {
  const harness = accountHarness({width: 320});
  harness.more().props.onClick();
  harness.render();
  assert.equal(harness.more().props['aria-expanded'], true);
  harness.resize(500);
  assert.equal(harness.visible().length, 5);
  assert.equal(harness.more().props['aria-expanded'], false);
  assert.equal(elements(harness.tree).some(item => item.type === 'portal'), false);
  harness.resize(320);
  assert.equal(harness.more().props['aria-expanded'], false);
});

test('the more button keeps a stable width across overflow digit changes and repeated resize observations', () => {
  const widths = Object.fromEntries(Array.from({length: 13}, (_, i) => [`wa-${i + 1}`, i === 0 ? 80 : i === 1 ? 180 : 35]));
  const harness = accountHarness({count: 13, width: 316, widths, focus: 'wa-1'});
  const expected = ['wa-1', 'wa-3', 'wa-4', 'wa-5', 'wa-6'];
  assert.deepEqual(harness.visible().map(item => item.key), expected);
  assert.equal(harness.more().props.ref.current.offsetWidth, 50);
  for (let pass = 0; pass < 6; pass++) {
    harness.resize();
    assert.deepEqual(harness.visible().map(item => item.key), expected, `observation ${pass + 1} should preserve the fitted accounts`);
    assert.equal(harness.more().props.ref.current.offsetWidth, 50);
  }
});
