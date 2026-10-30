import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import zh from "../src/i18n/locales/zh-CN.ts";

const panels = ["Connection", "Messaging", "Ai", "AutoReply", "QuickReplies", "Data", "Blocklist", "Appearance", "Speech", "Notifications", "ScheduledMessages", "Update"];
const mocks = {
  "./SettingsGoogleSheets": "export const SettingsGoogleSheets=()=>null;",
  react: "export const memo=fn=>fn; export const useState=initial=>globalThis.settingsHookState?globalThis.settingsHookState(initial):[typeof initial==='function'?initial():initial,()=>{}]; export const useRef=value=>globalThis.settingsHookRef?globalThis.settingsHookRef(value):({current:null}); export const useEffect=fn=>globalThis.settingsEffects.push(fn);",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;",
  "lucide-react": "export const AudioLines=()=>null, Bell=AudioLines, TableProperties=AudioLines, Bot=AudioLines, Clock3=AudioLines, Database=AudioLines, Info=AudioLines, MessageSquareText=AudioLines, Palette=AudioLines, Radio=AudioLines, ShieldBan=AudioLines, Workflow=AudioLines, X=AudioLines, Zap=AudioLines, Activity=AudioLines, AlertTriangle=AudioLines, CheckCircle2=AudioLines, Flame=AudioLines;",
  "@/store/appStore": "export const useAppStore=selector=>selector(globalThis.settingsState);",
  "@/i18n": "export const useI18n=()=>({t:globalThis.settingsTranslate});",
  ...Object.fromEntries(panels.map(name => [`./Settings${name}Panel`, `export const Settings${name}Panel=()=>null;`])),
};
const result = await build({
  stdin: { contents: "export { SettingsModal } from './src/components/settings/SettingsModal.tsx'; export { AccountHealthCard } from './src/components/crm/AccountHealthCard.tsx'; export { ConfirmHost } from './src/components/ui/ConfirmHost.tsx';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "settings-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { SettingsModal, AccountHealthCard, ConfirmHost } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join("") : tree?.props ? text(tree.props.children) : typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
const translate = (key, params = {}) => String(zh[key] || key).replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`);
const health = { accountId: "wa-a", level: "green", score: 100, sentLastHour: 0, sentLastDay: 0, newChatsLastDay: 0, caps: { perHour: 100, perDaySoft: 800 } };

test("unsaved sheet settings guard close, keep editing, failed save and successful save", async () => {
  const cells=[],changes=[];let index=0;
  globalThis.settingsHookState=initial=>{const n=index++;cells[n]??={value:typeof initial==='function'?initial():initial};return[cells[n].value,next=>cells[n].value=typeof next==='function'?next(cells[n].value):next];};
  globalThis.settingsHookRef=value=>cells[index++]??={current:value};
  globalThis.settingsTranslate=translate;globalThis.settingsEffects=[];
  globalThis.settingsState={settingsOpen:true,settingsCategory:'google-sheets',setSettingsCategory:()=>{},setSettingsOpen:value=>changes.push(value)};
  const render=()=>{index=0;return SettingsModal();};
  const find=(tree,key)=>nodes(tree).find(node=>node.type==='button'&&text(node)===zh[key]);
  const register=guard=>{const tree=render();nodes(tree).find(node=>node.props.onCloseGuardChange).props.onCloseGuardChange(guard);};
  try {
    register({dirty:true,busy:false,canSave:true,save:async()=>false});
    let tree=render();tree.props.onClick();tree=render();
    assert.ok(nodes(tree).some(node=>node.props.role==='alertdialog'));assert.deepEqual(changes,[]);
    find(tree,'settings.keepEditing').props.onClick();tree=render();
    assert.ok(!nodes(tree).some(node=>node.props.role==='alertdialog'));
    tree.props.onClick();tree=render();await find(tree,'settings.saveClose').props.onClick();
    assert.deepEqual(changes,[], 'a failed save keeps settings open');
    register({dirty:true,busy:true,canSave:true,save:async()=>true});tree=render();tree.props.onClick();tree=render();
    assert.equal(find(tree,'settings.discardClose').props.disabled,true);
    register({dirty:true,busy:false,canSave:true,save:async()=>true});tree=render();
    assert.equal(find(tree,'settings.discardClose').props.disabled,false, 'buttons recover after background work completes');
    await find(tree,'settings.saveClose').props.onClick();assert.deepEqual(changes,[false]);
    changes.length=0;tree=render();find(tree,'settings.discardClose').props.onClick();assert.deepEqual(changes,[false]);
  } finally {for(const key of ['settingsHookState','settingsHookRef','settingsTranslate','settingsEffects','settingsState'])delete globalThis[key];}
});

test("Google Sheets has its own settings category and opens its dedicated panel", () => {
  const selected = [];
  globalThis.settingsTranslate = translate;
  globalThis.settingsEffects = [];
  globalThis.settingsState = { settingsOpen: true, settingsCategory: "google-sheets", setSettingsCategory: value => selected.push(value) };
  try {
    const all = nodes(SettingsModal());
    const categories = all.filter(node => node.type === "button" && text(node).includes(zh["settings.googleSheetsDesc"]));
    assert.equal(categories.length, 1);
    assert.equal(categories[0].props["aria-current"], "page");
    categories[0].props.onClick();
    assert.deepEqual(selected, ["google-sheets"]);
    assert.ok(all.some(node => node.props.active === true && node.props.Panel?.name === "SettingsGoogleSheets"));
  } finally {
    for (const key of ["settingsTranslate", "settingsEffects", "settingsState"]) delete globalThis[key];
  }
});

test("disconnected, pairing, reconnecting and idle accounts have no misleading health score", () => {
  globalThis.settingsTranslate = translate;
  try {
    for (const connection of ["disconnected", "connecting", "qr", "reconnecting", "connected"]) {
      const tree = AccountHealthCard({ health, connection });
      assert.equal(text(tree).includes("良好"), false, connection);
      assert.equal(nodes(tree).some(node => node.props.children === 100), false, connection);
      assert.equal(text(tree).includes("可正常经营"), false, connection);
    }
    const active = AccountHealthCard({ health: { ...health, sentLastDay: 2 }, connection: "connected" });
    assert.equal(text(active).includes("良好"), true);
    assert.equal(nodes(active).some(node => node.props.children === 100), true);
    const offline = AccountHealthCard({ health: { ...health, level: "red", score: 10, sentLastHour: 150, sentLastDay: 900 }, connection: "disconnected" });
    assert.equal(text(offline).includes("未连接"), true);
    assert.equal(text(offline).includes("达到/超过"), true, "Offline history must retain rate warnings");
  } finally { delete globalThis.settingsTranslate; }
});

test("settings wrap keyboard focus, dismiss on Escape, restore the trigger and leave nested dialogs alone", () => {
  const originalDocument = globalThis.document, originalElement = globalThis.HTMLElement;
  class Control {
    isConnected = true; tabIndex = 0;
    focus() { document.activeElement = this; }
    getClientRects() { return [{}]; }
  }
  const trigger = new Control(), first = new Control(), last = new Control(), hidden = new Control();
  hidden.getClientRects = () => [];
  const changes = [];
  globalThis.HTMLElement = Control;
  globalThis.document = { activeElement: trigger };
  globalThis.settingsTranslate = translate;
  globalThis.settingsEffects = [];
  globalThis.settingsState = { settingsOpen: true, settingsCategory: "connection", setSettingsOpen: value => changes.push(value) };
  let cleanup;
  try {
    const tree = SettingsModal(), all = nodes(tree), dialog = all.find(node => node.props.role === "dialog");
    all.find(node => node.props.ref).props.ref.current = first;
    const content = { scrollTop: 500 };
    all.find(node => node.type === "main").props.ref.current = content;
    settingsEffects[1](); assert.equal(content.scrollTop, 0);
    cleanup = settingsEffects[0]();
    assert.equal(document.activeElement, first);
    const element = { querySelectorAll: () => [first, last, hidden] };
    const event = (key, extra = {}) => ({ key, currentTarget: element, target: { closest: () => element }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });
    dialog.props.onKeyDown(event("Tab", { shiftKey: true })); assert.equal(document.activeElement, last);
    dialog.props.onKeyDown(event("Tab")); assert.equal(document.activeElement, first);
    dialog.props.onKeyDown(event("Escape", { target: { closest: () => ({}) } })); assert.deepEqual(changes, []);
    dialog.props.onKeyDown(event("Escape", { defaultPrevented: true })); assert.deepEqual(changes, []);
    dialog.props.onKeyDown(event("Escape")); assert.deepEqual(changes, [false]);
    cleanup(); cleanup = null; assert.equal(document.activeElement, trigger);
  } finally {
    cleanup?.(); globalThis.document = originalDocument; globalThis.HTMLElement = originalElement;
    for (const key of ["settingsTranslate", "settingsEffects", "settingsState"]) delete globalThis[key];
  }
});

test("cancelling a global confirmation returns focus to the control inside settings", () => {
  const originalDocument = globalThis.document, originalElement = globalThis.HTMLElement, originalWindow = globalThis.window;
  class Control { isConnected = true; focus() { document.activeElement = this; } }
  const trigger = new Control(), cancel = new Control(), changes = [];
  globalThis.HTMLElement = Control; globalThis.document = { activeElement: trigger }; globalThis.window = new EventTarget();
  globalThis.settingsTranslate = translate; globalThis.settingsEffects = [];
  globalThis.settingsState = { confirmDialog: { id: "confirmation", title: "Clear?", tone: "danger" }, resolveConfirm: value => changes.push(value) };
  let cleanup;
  try {
    const buttons = nodes(ConfirmHost()).filter(node => node.type === "button");
    buttons[0].props.ref.current = cancel; buttons[1].props.ref.current = new Control();
    cleanup = settingsEffects[0](); assert.equal(document.activeElement, cancel);
    const event = new Event("keydown"); Object.defineProperty(event, "key", { value: "Escape" }); window.dispatchEvent(event);
    assert.deepEqual(changes, [false]); cleanup(); cleanup = null; assert.equal(document.activeElement, trigger);
  } finally {
    cleanup?.(); globalThis.document = originalDocument; globalThis.HTMLElement = originalElement; globalThis.window = originalWindow;
    for (const key of ["settingsTranslate", "settingsEffects", "settingsState"]) delete globalThis[key];
  }
});
