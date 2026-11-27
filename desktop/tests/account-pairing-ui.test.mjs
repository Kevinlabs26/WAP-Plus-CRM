import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const src = fileURLToPath(new URL("../src", import.meta.url));
const mocks = {
  react: `export const useState = value => pairingHarness.state(value), useRef = value => pairingHarness.ref(value), useEffect = effect => pairingHarness.effect(effect);`,
  "react/jsx-runtime": `export const jsx = (type,props) => ({type,props}), jsxs = jsx, Fragment = 'fragment';`,
  "@/i18n": `export const useI18n = () => ({t:(key, params)=>params ? [key, ...Object.values(params)].join(" ") : key});`,
  "@/lib/bridge": `export const isTauri = () => true;`,
  "@/lib/baileys": `export const baileysStatus = id => pairingHarness.statuses.get(id), baileysPairingCode = (...args) => pairingHarness.pair(...args); export const baileysLogout = () => {}, baileysRestart = () => {}, baileysSync = () => {}, baileysUpdateProfile = () => {};`,
  "@/store/appStore": `export const useAppStore = selector => selector(pairingHarness.store); useAppStore.getState = () => pairingHarness.store;`,
  "@/components/ui/primitives": `export const Button = 'button', Input = 'input', SectionLabel = 'section-label';`,
  "@/components/ui/Avatar": `export const Avatar = 'avatar';`,
  "@/components/crm/AccountHealthPanel": `export const AccountHealthPanel = 'account-health';`,
  "./BaileysPrivacyPanel": `export const BaileysPrivacyPanel = 'privacy';`,
};
const bundle = await build({
  stdin: {
    contents: `export { BaileysConnectCard } from "./components/settings/BaileysConnectCard";
      export { SettingsConnectionPanel } from "./components/settings/SettingsConnectionPanel";`,
    resolveDir: src,
  },
  alias: { "@": src }, bundle: true, format: "esm", write: false,
  plugins: [{ name: "pairing-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => mocks[path] ? { path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path] }));
  } }],
});
const { BaileysConnectCard, SettingsConnectionPanel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));

test("connection settings show all accounts online count and the specific reconnect target", () => {
  globalThis.pairingHarness = {
    store: {
      settings: {
        sendChannel: "baileys",
        activeAccountId: "wa-1",
        liveBaileysAccountId: "wa-5",
        waAccounts: Array.from({ length: 5 }, (_, index) => ({
          id: `wa-${index + 1}`, label: String(index + 1), status: "connected",
        })),
      },
      baileysUi: { connection: "reconnecting" },
    },
  };
  try {
    const tree = nodes(SettingsConnectionPanel());
    assert.ok(tree.some(node => node.props.children === "settingsConnection.connectedAccounts 4 5"));
    assert.ok(tree.some(node => node.props.children === "settingsConnection.accountForActions 5"));
    assert.equal(tree.find(node => node.type === BaileysConnectCard)?.props.accountId, "wa-5");
  } finally {
    delete globalThis.pairingHarness;
  }
});

test("account cards offer pairing with and without a QR code and keep requests in their own slots", async () => {
  const calls = [];
  const statuses = new Map([
    ["wa-a", { connection: "qr", qrDataUrl: "data:image/png;base64,QR" }],
    ["wa-b", { connection: "starting" }],
    ["wa-c", { connection: "connected" }],
  ]);
  globalThis.window = { setInterval: () => 1, clearInterval() {} };
  globalThis.document = { hidden: false };

  for (const [index, accountId] of [...statuses.keys()].entries()) {
    let cursor = 0;
    const slots = [];
    globalThis.pairingHarness = {
      store: { settings: { liveBaileysAccountId: "another-slot", waAccounts: [] } }, statuses,
      async pair(phone, id) { calls.push([phone, id]); return { code: `CODE${index}` }; },
      state(initial) {
        const key = cursor++;
        if (!(key in slots)) slots[key] = initial;
        return [slots[key], value => { slots[key] = typeof value === "function" ? value(slots[key]) : value; }];
      },
      ref(initial) { return slots[cursor++] ??= { current: initial }; },
      effect(effect) { if (!slots[cursor++]) { slots[cursor - 1] = true; effect(); } },
    };
    const render = () => { cursor = 0; return nodes(BaileysConnectCard({ variant: "embedded", accountId })); };
    render();
    await settle();
    const tree = render();
    const input = tree.find(node => node.type === "input" && node.props.type === "tel");
    if (accountId === "wa-c") { assert.equal(input, undefined); continue; }
    assert.ok(input);
    assert.equal(tree.some(node => node.type === "img"), accountId === "wa-a");
    input.props.onChange({ target: { value: `+1 202 555 010${index}` } });
    const button = render().find(node => node.props.children === "baileysConnect.getPairingCode");
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    await settle();
    const result = render();
    assert.ok(result.some(node => node.props.children === `CODE${index}`));
    assert.ok(result.some(node => node.props.children === "baileysConnect.pairingInstructions"));
  }
  assert.deepEqual(calls, [["+1 202 555 0100", "wa-a"], ["+1 202 555 0101", "wa-b"]]);
});
