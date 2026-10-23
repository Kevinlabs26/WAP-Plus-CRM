import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/core.ts";

const icons = ["Search", "Users", "Smartphone", "RefreshCw", "ChevronDown", "Coffee", "Settings", "AlertTriangle", "CalendarCheck", "CheckCircle2", "Clock", "LayoutGrid", "List", "Radio", "Send"];
const mocks = {
  react: "export const useMemo=fn=>fn(); export const useState=value=>globalThis.onboardingHooks.state(value); export const useRef=value=>globalThis.onboardingHooks.ref(value); export const useEffect=()=>{};",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;",
  "lucide-react": icons.map(name => `export const ${name}=()=>null;`).join(""),
  "@/store/appStore": "export const useAppStore=selector=>selector(globalThis.onboardingState); useAppStore.getState=()=>globalThis.onboardingState;",
  "@/i18n": "export const useI18n=()=>({t:(key,params)=>globalThis.onboardingTranslate(key,params)});",
  "@/components/ui/primitives": "export const Button='button', Badge='badge', SectionLabel='label';",
  "@/components/ui/Avatar": "export const Avatar=()=>null;",
  "@/components/brand/WapPlusMark": "export const WapPlusMark=()=>null;",
  "@/components/DonateModal": "export const DonateModal=()=>null;",
  "./AccountSwitcherMenu": "export const AccountSwitcherMenu=()=>null;",
  "./MessageInbox": "export const MessageInbox=()=>null;",
  "@/components/crm/FollowUpWorkRow": "export const FollowUpWorkRow=()=>null; export const buildContactWorkCard=()=>({});",
  "./FollowUpsView": "export const FollowUpsView=()=>null;",
  "./MultiWindowWorkspace": "export const MultiWindowWorkspace=()=>null;",
  "@/lib/syncDebug": "export const syncLog=()=>{};",
};
const result = await build({
  stdin: { contents: "export { ChatWelcome } from './src/components/chat/ChatWelcome.tsx'; export { TopBar } from './src/components/layout/TopBar.tsx'; export { TodayView } from './src/components/views/TodayView.tsx';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "onboarding-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { ChatWelcome, TopBar, TodayView } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join("") : tree?.props ? text(tree.props.children) : typeof tree === "string" || typeof tree === "number" ? String(tree) : "";

function fixture({ settings = {}, ...overrides } = {}) {
  const calls = [], cells = [];
  let cursor = 0;
  globalThis.onboardingHooks = {
    state(initial) { const index = cursor++; cells[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [cells[index].value, next => { cells[index].value = typeof next === "function" ? next(cells[index].value) : next; }]; },
    ref(value) { return cells[cursor++] ??= { current: value }; },
  };
  globalThis.onboardingTranslate = (key, params) => translate("zh-CN", key, params);
  globalThis.onboardingState = {
    activeNav: "chats", chats: [], contacts: [], messages: [], followUps: [], bridge: { connected: false },
    baileysUi: { connection: "connected" }, stats: { followUpsToday: 0, awaitingReplyChats: 0 },
    settings: { sendChannel: "baileys", liveBaileysAccountId: "wa-a", activeAccountId: "wa-a", accountViewMode: { type: "all" },
      waAccounts: [{ id: "wa-a", status: "connected", label: "A" }, { id: "wa-b", status: "disconnected", label: "B" }], ...settings },
    setSettingsOpen: (...args) => calls.push(["settings", ...args]), setBaileysLoginOpen: value => calls.push(["login", value]),
    setActiveNav: value => calls.push(["nav", value]), setCommandOpen: value => calls.push(["search", value]),
    goToChats: value => calls.push(["chats", value]), ...overrides,
  };
  return { calls, render(Component) { cursor = 0; return Component(); },
    close() { for (const key of ["onboardingHooks", "onboardingTranslate", "onboardingState"]) delete globalThis[key]; } };
}
const primary = tree => nodes(tree).find(node => node.type === "button" && node.props.variant === "primary");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);

test("offline selected accounts lead to login even when another account is connected", () => {
  const ui = fixture({ settings: { accountViewMode: { type: "account", accountId: "wa-b" } }, chats: [{ id: "old", accountId: "wa-b" }] });
  try {
    const tree = ui.render(ChatWelcome);
    assert.ok(text(tree).includes("连接 WhatsApp，开始沟通"));
    primary(tree).props.onClick(); assert.deepEqual(ui.calls, [["login", true]]);
    button(tree, "客户与跟进").props.onClick(); assert.deepEqual(ui.calls.at(-1), ["nav", "crm"]);
  } finally { ui.close(); }
});

test("saved messages and other accounts do not count as synced conversations", () => {
  const ui = fixture({ settings: { accountViewMode: { type: "account", accountId: "wa-a" } },
    chats: [{ id: "bridge-chat-saved-messages" }, { id: "other", accountId: "wa-b" }] });
  try {
    const tree = ui.render(ChatWelcome); assert.ok(text(tree).includes("接下来同步会话"));
    primary(tree).props.onClick(); assert.deepEqual(ui.calls, [["settings", true, "connection"]]);
  } finally { ui.close(); }
});

test("synced conversations offer working search without an inactive AI entry", () => {
  const ui = fixture({ chats: [{ id: "chat", accountId: "wa-a" }] });
  try {
    const tree = ui.render(ChatWelcome); assert.ok(text(tree).includes("选择一个会话"));
    assert.equal(text(tree).includes("AI"), false);
    primary(tree).props.onClick(); assert.deepEqual(ui.calls, [["search", true]]);
  } finally { ui.close(); }
});

test("Android onboarding uses connection settings and waits for notifications instead of promising history sync", () => {
  const ui = fixture({ settings: { sendChannel: "android_bridge" } });
  try {
    primary(ui.render(ChatWelcome)).props.onClick(); assert.deepEqual(ui.calls, [["settings", true, "connection"]]);
    onboardingState.bridge.connected = true;
    const tree = ui.render(ChatWelcome); assert.ok(text(tree).includes("等待新消息"));
    primary(tree).props.onClick(); assert.deepEqual(ui.calls.at(-1), ["nav", "crm"]);
  } finally { ui.close(); }
});

test("empty offline workbenches do not claim that all work is cleared", () => {
  const ui = fixture({ baileysUi: { connection: "disconnected" }, settings: { waAccounts: [] } });
  try {
    const tree = ui.render(TodayView); assert.ok(text(tree).includes("先连接账号"));
    primary(tree).props.onClick(); assert.deepEqual(ui.calls, [["login", true]]);
  } finally { ui.close(); }
});

test("connected Android workbenches use the bridge status rather than WhatsApp account counts", () => {
  const ui = fixture({ settings: { sendChannel: "android_bridge", waAccounts: [] }, bridge: { connected: true } });
  try { const tree = ui.render(TodayView); assert.ok(text(tree).includes("当前没有待办")); assert.equal(text(tree).includes("先连接账号"), false); }
  finally { ui.close(); }
});

test("broadcast has a direct navigation entry and supporting pages remain available", () => {
  const ui = fixture();
  try {
    let tree = ui.render(TopBar); assert.ok(text(tree).includes("Ctrl+K"));
    const support = button(tree, "支持作者"); assert.ok(support, "Support must be available before opening More");
    support.props.onClick(); tree = ui.render(TopBar);
    const donation = nodes(tree).find(node => typeof node.props.onClose === "function"); assert.ok(donation);
    donation.props.onClose(); tree = ui.render(TopBar);
    button(tree, "群发").props.onClick(); assert.deepEqual(ui.calls, [["nav", "broadcast"]]);
    nodes(tree).find(node => node.props["aria-controls"] === "topbar-more-nav").props.onClick(); tree = ui.render(TopBar);
    for (const label of ["星标", "统计", "监测", "设备"]) assert.ok(button(tree, label), label);
    assert.equal(button(nodes(tree).find(node => node.props.id === "topbar-more-nav"), "支持作者"), undefined);
    assert.equal(nodes(tree).filter(node => node.type === "button" && text(node) === "群发").length, 1);
    button(tree, "监测").props.onClick(); assert.deepEqual(ui.calls.at(-1), ["nav", "monitor"]);
  } finally { ui.close(); }
});

test("saved-message placeholders have no unfilled interpolation tokens in any locale", () => {
  for (const locale of ["zh-CN", "en", "fr"]) assert.equal(/\{\w+\}/.test(translate(locale, "chat.selfDraft")), false);
});
