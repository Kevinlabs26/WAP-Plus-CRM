import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react:
    "export const useState=i=>globalThis.modalHooks.state(i);export const useRef=i=>globalThis.modalHooks.ref(i);export const useEffect=(fn,deps)=>globalThis.modalHooks.effect(fn,deps);export const useMemo=f=>f();",
  "react/jsx-runtime":
    "export const Fragment='fragment';export const jsx=(type,props)=>typeof type==='function'?type(props):{type,props};export const jsxs=jsx;",
  "lucide-react":
    "export const ClipboardPaste='paste',FileSpreadsheet='sheet',Sparkles='sparkles',Upload='upload',X='close';",
  "@/store/appStore": "export const useAppStore=f=>f(globalThis.modalState);",
  "@/i18n":
    "export const useI18n=()=>({t:(key,params)=>key+(params?JSON.stringify(params):'')});",
  "@/components/ui/primitives":
    "export const Button='button',Input='input',Textarea='textarea';",
  "@/lib/bridge":
    "export const savePhoneContacts=async()=>({saved:0,exists:0,failed:0});",
  "@/lib/baileys":
    "export const baileysSaveContacts=async(account,rows)=>{globalThis.modalCalls.push(['cloud',account,rows]);return {saved:rows.length,failed:0};};",
};

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  entryPoints: [root + "src/components/settings/ContactImportModal.tsx"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  alias: { "@": root + "src" },
  plugins: [
    {
      name: "contact-import-modal-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: mocks[args.path],
        }));
      },
    },
  ],
});

const { ContactImportModal } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

const collectNodes = (tree) =>
  Array.isArray(tree)
    ? tree.flatMap(collectNodes)
    : tree?.props
      ? [tree, ...collectNodes(tree.props.children)]
      : [];
const collectText = (tree) =>
  Array.isArray(tree)
    ? tree.map(collectText).join("")
    : tree?.props
      ? collectText(tree.props.children)
      : typeof tree === "string" || typeof tree === "number"
        ? String(tree)
        : "";

test("ContactImportModal shows formatted account name, exposes duplicate rows, and supports updating unnamed duplicates + WhatsApp cloud sync", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const cells = [];
  const effects = [];
  let cursor = 0;
  globalThis.modalCalls = [];
  globalThis.modalHooks = {
    state(initial) {
      const index = cursor++;
      if (!(index in cells)) {
        cells[index] = typeof initial === "function" ? initial() : initial;
      }
      return [
        cells[index],
        (next) => {
          cells[index] = typeof next === "function" ? next(cells[index]) : next;
        },
      ];
    },
    ref(initial) {
      return (cells[cursor++] ??= { current: initial });
    },
    effect(fn, deps) {
      const index = cursor++;
      const prev = cells[index];
      if (prev && deps.every((val, idx) => Object.is(val, prev.deps[idx]))) return;
      cells[index] = { deps, cleanup: prev?.cleanup };
      effects.push(() => {
        cells[index].cleanup?.();
        cells[index].cleanup = fn();
      });
    },
  };

  globalThis.modalState = {
    contacts: [
      { id: "c-grp", accountId: "wa-mtuino4o", name: "群成员", phone: "+243972816141" },
      { id: "c-vip", accountId: "wa-mtuino4o", name: "VIP Sabrina", phone: "+237656136816" },
    ],
    settings: {
      sendChannel: "baileys",
      liveBaileysAccountId: "wa-1",
      waAccounts: [
        { id: "wa-1", label: "1", userName: "Primary", status: "connected", sort: 0 },
        { id: "wa-mtuino4o", label: "2", userName: "Alex", status: "connected", sort: 1 },
      ],
    },
    baileysUi: { connection: "connected" },
    phones: [],
    selectedPhoneId: null,
    bridge: { connected: false, deviceId: null },
    importContacts: (rows) => {
      globalThis.modalCalls.push(["create", rows]);
      return rows.length;
    },
    batchUpdateContacts: (ids, patch) => {
      globalThis.modalCalls.push(["update", ids, patch]);
      return ids.length;
    },
    pushToast: (...args) => globalThis.modalCalls.push(["toast", ...args]),
  };

  const props = { open: true, onClose: () => {}, accountId: "wa-mtuino4o" };
  const render = () => {
    let tree;
    for (let pass = 0; pass < 2; pass++) {
      cursor = 0;
      tree = ContactImportModal(props);
      while (effects.length) effects.shift()();
    }
    return collectNodes(tree);
  };

  try {
    let tree = render();
    assert.ok(
      tree.some((node) => node.type === "p" && collectText(node).includes("2: Alex")),
      "Header must show formatted account display label instead of raw account ID"
    );

    tree
      .find((node) => node.type === "textarea")
      .props.onChange({
        target: {
          value: "apot Israël\t243972816141\nHélène\t237656136816\ntossarock4\t22959274995",
        },
      });
    tree = render();

    // Default mode treats all unique pasted numbers as importable (0 duplicates unless repeated in paste)
    assert.ok(tree.some((node) => node.type === "button" && collectText(node) === "contactImport.importable 3"));
    assert.ok(tree.some((node) => node.type === "button" && collectText(node) === "contactImport.duplicates 0"));

    const submitButton = tree.find(
      (node) =>
        node.type === "button" &&
        collectText(node).startsWith("contactImport.saveAndSync")
    );
    assert.ok(submitButton);
    await submitButton.props.onClick();

    const created = globalThis.modalCalls.find((call) => call[0] === "create")[1];
    assert.equal(created.length, 1);
    assert.equal(created[0].phone, "+22959274995");

    const updated = globalThis.modalCalls.filter((call) => call[0] === "update");
    assert.equal(updated.length, 2);
    assert.deepEqual(updated[0][1], ["c-grp"]);
    assert.equal(updated[0][2].name, "apot Israël");
    assert.deepEqual(updated[1][1], ["c-vip"]);
    assert.equal(updated[1][2].name, "Hélène");

    const cloud = globalThis.modalCalls.find((call) => call[0] === "cloud");
    assert.equal(cloud[1], "wa-mtuino4o");
    assert.equal(cloud[2].length, 3);
  } finally {
    for (const cell of cells) cell?.cleanup?.();
    globalThis.window = originalWindow;
  }
});
