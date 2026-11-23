import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const source = fileURLToPath(new URL("../src", import.meta.url));
const mocks = {
  react: `export const useState = i => globalThis.paletteHooks.state(i);
    export const useRef = i => globalThis.paletteHooks.ref(i);
    export const useEffect = (fn, deps) => globalThis.paletteHooks.effect(fn, deps);
    export const useMemo = fn => fn();`,
  "react/jsx-runtime": "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;",
  "lucide-react": ["Search", "MessageSquare", "User", "Phone", "CalendarCheck", "BarChart3", "Settings", "FileText", "Loader2", "Activity", "Megaphone"]
    .map(icon => `export const ${icon} = '${icon}';`).join("\n"),
  "@/store/appStore": "export const useAppStore = select => select(globalThis.paletteState);",
  "@/lib/utils": "export const cn = () => '';",
  "@/i18n": "const t = key => key; export const useI18n = () => ({ t });",
};
const built = await build({
  stdin: { resolveDir: source, contents: `export { CommandPalette } from './components/CommandPalette.tsx';
    export { beginDataRestore } from './store/restoreGuard.ts';` },
  alias: { "@": source }, bundle: true, write: false, format: "esm", jsx: "automatic",
  plugins: [{ name: "palette-test", setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, ({ path }) => mocks[path] ? { path, namespace: "mock" } : undefined);
    plugin.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path] }));
  } }],
});
const { CommandPalette, beginDataRestore } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

function inputOf(node) {
  if (node?.type === "input") return node;
  const children = node?.props?.children;
  return (Array.isArray(children) ? children : [children]).map(child => child && inputOf(child)).find(Boolean);
}

test("palette skips superseded disk searches and discards a result across data restore", async t => {
  const previousWindow = globalThis.window;
  const timers = new Set();
  const slots = [], effects = [];
  let index = 0;
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
  };
  globalThis.paletteHooks = {
    state(initial) { const slot = slots[index++] ?? (slots[index - 1] = { value: initial }); return [slot.value, value => { slot.value = value; }]; },
    ref(initial) { return slots[index++] ?? (slots[index - 1] = { current: initial }); },
    effect(fn, deps) {
      const i = index++;
      const old = slots[i];
      if (old && deps.every((value, n) => value === old.deps[n])) return;
      effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  const calls = [];
  globalThis.paletteState = {
    commandOpen: true, contacts: [], chats: [], messages: [], followUps: [], phones: [],
    searchMessagesGlobal(query) { return new Promise(resolve => calls.push({ query, resolve })); },
  };
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); globalThis.window = previousWindow; });
  const render = () => { index = 0; const tree = CommandPalette(); for (const effect of effects.splice(0)) effect(); return tree; };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const search = async value => {
    inputOf(render()).props.onChange({ target: { value } });
    render();
    for (const timer of timers) { timers.delete(timer); timer(); }
    await settle();
  };

  await search("first");
  await search("second");
  await search("third");
  assert.deepEqual(calls.map(item => item.query), ["first"]);
  calls[0].resolve([{ id: "old", body: "first old result" }]);
  await settle();
  assert.deepEqual(calls.map(item => item.query), ["first", "third"]);
  assert.doesNotMatch(JSON.stringify(render()), /first old result/);

  const finishRestore = beginDataRestore();
  finishRestore();
  calls[1].resolve([{ id: "restored-away", body: "third old data" }]);
  await settle();
  assert.doesNotMatch(JSON.stringify(render()), /third old data/);
  await search("current");
  calls.at(-1).resolve([{ id: "current", body: "current committed result" }]);
  await settle();
  assert.match(JSON.stringify(render()), /current committed result/);
});
