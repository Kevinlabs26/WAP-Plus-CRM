import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: "export const useState = value => globalThis.sidebarHooks.state(value); export const useRef = value => globalThis.sidebarHooks.ref(value); export const useEffect = (fn, deps) => globalThis.sidebarHooks.effect(fn, deps);",
  "react/jsx-runtime": "export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx; export const Fragment='fragment';",
  "lucide-react": "export const ArrowUpDown=()=>null, Bookmark=ArrowUpDown, Check=ArrowUpDown, ChevronDown=ArrowUpDown, MessageCircle=ArrowUpDown, MoreHorizontal=ArrowUpDown, RefreshCw=ArrowUpDown, Search=ArrowUpDown, UserPlus=ArrowUpDown, Users=ArrowUpDown, UsersRound=ArrowUpDown, CheckCheck=ArrowUpDown, Settings2=ArrowUpDown, UserRoundPlus=ArrowUpDown;",
  "@/i18n": "export const useI18n=()=>({t:key=>key,locale:'en'});",
  "@/lib/syncDebug": "export const isSyncDebugEnabled=()=>false; export const syncLog=()=>{};",
  "@/components/ui/primitives": "export const SectionLabel='header';",
};
const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/layout/SidebarListHeader.tsx", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "header-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { SidebarListHeader } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];

function fixture(overrides = {}) {
  const originalDocument = globalThis.document;
  globalThis.document = new EventTarget();
  const cells = [], effects = [], calls = [];
  let cursor = 0;
  globalThis.sidebarHooks = {
    state(initial) { const index = cursor++; cells[index] ??= { value: initial };
      return [cells[index].value, next => { cells[index].value = typeof next === "function" ? next(cells[index].value) : next; }]; },
    ref(initial) { return cells[cursor++] ??= { current: initial }; },
    effect(fn, deps) { const index = cursor++, previous = cells[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      cells[index] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { cells[index].cleanup?.(); cells[index].cleanup = fn(); }); },
  };
  const props = { listTab: "chats", groupFilter: "all", listFilter: "all", sortMode: "recent", filter: "", isBaileys: true,
    chatsCount: 4412, contactsCount: 20263, leadCount: 30, leadEnabled: true, savedActive: false, leadActive: false,
    onOpenSaved: () => calls.push("saved"), onOpenLeads: () => calls.push("leads"), onOpenLeadSettings: () => calls.push("lead-settings"),
    onGroupFilterChange: mode => calls.push(mode), getGroupFilterCounts: () => ({ all: 9, hidden: 4, only: 5, unread: 2, pinned: 1, mentions: 1 }),
    onCreateGroup: () => calls.push("create"), onBatchSaveContacts: () => calls.push("batch"), onSync: () => calls.push("sync"),
    syncDisabled: true, sortRef: { current: null }, ...overrides };
  const render = () => { cursor = 0; const tree = SidebarListHeader(props); while (effects.length) effects.shift()(); return nodes(tree); };
  return { props, calls, render,
    close() { for (const cell of cells) cell?.cleanup?.(); globalThis.document = originalDocument; delete globalThis.sidebarHooks; } };
}

test("group choices open on left click, show counts and apply the selected filter", () => {
  const ui = fixture();
  try {
    let tree = ui.render();
    tree.find(node => node.props["aria-label"] === "sidebar.groupFilterTitle").props.onClick();
    tree = ui.render();
    const option = tree.find(node => node.props.role === "menuitemradio" && node.props.children[1].props.children === 5);
    assert.ok(option, "Group-only choice must show its count");
    option.props.onClick();
    assert.deepEqual(ui.calls, ["only"]);
    assert.equal(ui.render().some(node => node.props.role === "menu"), false);
  } finally { ui.close(); }
});

test("secondary actions preserve callbacks, disabled sync, outside click and Escape dismissal", () => {
  const ui = fixture();
  const open = () => { ui.render().find(node => node.type === "button" && node.props["aria-label"] === "sidebar.actions").props.onClick(); return ui.render(); };
  try {
    let tree = open();
    assert.equal(tree.find(node => node.type === "button" && node.props["aria-label"] === "sidebar.syncChats").props.disabled, true);
    tree.find(node => node.type === "button" && node.props.children?.[1] === "sidebar.newGroup").props.onClick();
    assert.deepEqual(ui.calls, ["create"]);
    assert.equal(ui.render().some(node => node.props.id === "sidebar-actions"), false);
    open(); document.dispatchEvent(new Event("pointerdown"));
    assert.equal(ui.render().some(node => node.props.id === "sidebar-actions"), false);
    open(); const escape = new Event("keydown"); Object.defineProperty(escape, "key", { value: "Escape" }); document.dispatchEvent(escape);
    assert.equal(ui.render().some(node => node.props.id === "sidebar-actions"), false);
  } finally { ui.close(); }
});

test("Android contact lists keep bulk save and sync without WhatsApp group or lead controls", () => {
  const ui = fixture({ isBaileys: false, listTab: "contacts", syncDisabled: false });
  try {
    ui.render().find(node => node.type === "button" && node.props["aria-label"] === "sidebar.actions").props.onClick();
    const actions = ui.render().find(node => node.props.id === "sidebar-actions").props.children;
    assert.deepEqual(actions.map(n=>n.props["aria-label"]), ["sidebar.saved", "sidebar.syncChats", "sidebar.batchSaveContacts"]);
    const sync = ui.render().find(node => node.type === "button" && node.props["aria-label"] === "sidebar.syncChats");
    assert.equal(sync.props.disabled, false);
    sync.props.onClick();
    assert.deepEqual(ui.calls, ["sync"]);
  } finally { ui.close(); }
});

test("header tabs stay text-only and show only the current list's exact count",()=>{
  const ui=fixture();try{
    let tree=ui.render();
    assert.ok(tree.some(n=>n.type==="span"&&n.props.children==="4,412"));
    assert.ok(!tree.some(n=>n.type==="span"&&n.props.children==="20,263"));
    const chats=tree.find(n=>n.type==="button"&&n.props.children==="sidebar.chats");
    const contacts=tree.find(n=>n.type==="button"&&n.props.children==="sidebar.contacts");
    assert.equal(chats.props["aria-pressed"],true);assert.equal(contacts.props["aria-pressed"],false);
    assert.match(contacts.props.className,/whitespace-nowrap/);
    ui.props.onTabChange=tab=>ui.props.listTab=tab;
    ui.render().find(n=>n.type==="button"&&n.props.children==="sidebar.contacts").props.onClick();
    tree=ui.render();assert.ok(tree.some(n=>n.type==="span"&&n.props.children==="20,263"));
    assert.ok(!tree.some(n=>n.type==="span"&&n.props.children==="4,412"));
  }finally{ui.close();}
});

test("saved items and leads move into more without losing callbacks, active state or exact lead counts",()=>{
  const ui=fixture({savedActive:true,leadCount:1234});try{
    let tree=ui.render();assert.ok(!tree.some(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.saved"));
    assert.ok(tree.some(n=>n.props["aria-label"]==="leadInbox.filterActive"&&n.props.children==="99+"));
    const open=()=>{ui.render().find(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.actions").props.onClick();return ui.render()};
    tree=open();const saved=tree.find(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.saved");
    assert.equal(saved.props["aria-pressed"],true);saved.props.onClick();assert.deepEqual(ui.calls,["saved"]);
    tree=open();const leads=tree.find(n=>n.type==="button"&&n.props["aria-label"]==="leadInbox.title");
    assert.ok(nodes(leads).some(n=>n.props.children==="1,234"));leads.props.onClick();
    assert.deepEqual(ui.calls,["saved","leads"]);assert.ok(!ui.render().some(n=>n.props.id==="sidebar-actions"));
  }finally{ui.close();}
});

test("sync remains disabled when unavailable and progress is exposed while the menu is closed",()=>{
  const ui=fixture({syncDisabled:false});try{
    const open=()=>{ui.render().find(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.actions").props.onClick();return ui.render()};
    open().find(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.syncChats").props.onClick();assert.deepEqual(ui.calls,["sync"]);
    ui.props.syncing=true;ui.props.syncDisabled=true;
    const tree=ui.render();assert.ok(tree.some(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.actions"&&n.props["aria-busy"]));
    assert.ok(tree.some(n=>n.props["aria-label"]==="sidebar.syncing"));
    assert.equal(open().find(n=>n.type==="button"&&n.props["aria-label"]==="sidebar.syncing").props.disabled,true);
  }finally{ui.close();}
});
