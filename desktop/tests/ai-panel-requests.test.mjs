import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { getSuggestionContextKey } from "../src/lib/aiSuggest.ts";

const entry = fileURLToPath(new URL("../src/components/crm/CrmAiPanel.tsx", import.meta.url));
const source = await readFile(entry, "utf8");
// Render the real panel with only its external UI/store boundaries stubbed.
const exportsByModule = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)]
  .map(([, names, module]) => [module, names.split(",").map(name => name.trim()).filter(name => name && !name.startsWith("type "))]));
const built = await build({
  entryPoints: [entry], bundle: true, format: "esm", platform: "browser", write: false, jsx: "automatic",
  plugins: [{ name: "panel-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, args => args.kind === "entry-point" ? undefined : ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: args.path === "react/jsx-runtime"
      ? "export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';"
      : args.path === "react"
        ? "export const {useEffect,useLayoutEffect,useMemo,useRef,useState} = globalThis.panelHooks;"
        : (exportsByModule.get(args.path) || []).map(name => `export const ${name} = globalThis.panelBindings[${JSON.stringify(name)}] || (() => null);`).join("\n") }));
  } }],
});

function harness() {
  const slots = []; let cursor = 0; let pending = []; let tree;
  const changed = (a, b) => !a || a.length !== b.length || a.some((item, i) => !Object.is(item, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      slots[i] ||= { value: initial };
      return [slots[i].value, value => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) {
        pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const contacts = ["a", "b"].map(id => ({ id, name: id, accountId: id, phone: "12025550100", tags: [] }));
  const state = {
    contacts, chats: contacts.map(c => ({ id: c.id, contactId: c.id, accountId: c.id })),
    messagesByChatId: Object.fromEntries(contacts.map(c => [c.id, [{ id: c.id + "-in", chatId: c.id, accountId: c.id, direction: "in", body: "Hello", sentAt: "2026-01-01T00:00:00Z" }]])),
    selectedContactId: "a", selectedChatId: "a", selectedThreadAccount: null,
    crmPanelCollapsed: false, crmPanelTab: "customer", aiSuggestions: [], followUps: [],
    settings: { aiProvider: "custom", customAiModel: "one", waAccounts: [], aiAutoReplyManualChatIds: [], quickReplies: [], sendChannel: "android" },
    baileysUi: { labelsByAccountId: {} }, pushToast() {},
  };
  const requests = []; const timers = new Map(); let timerId = 0;
  globalThis.window = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const store = selector => selector(state); store.setState = patch => Object.assign(state, patch);
  globalThis.panelHooks = hooks;
  globalThis.panelBindings = {
    useAppStore: store, hasRealAiKey: () => true, getSuggestionContextKey,
    generateSuggestions: (...args) => new Promise(resolve => requests.push({ args, resolve })),
    useI18n: () => ({ t: key => key }), getQuickReplyCategories: () => [], filterQuickReplies: () => [],
    filterMessagesForAccount: messages => messages, cn: () => "", isWaAccountConnected: () => false,
  };
  return { state, requests,
    async mount() {
      const { CrmAiPanel } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#${Math.random()}`);
      this.render = () => {
        for (let pass = 0; pass < 2; pass++) {
          cursor = 0; tree = CrmAiPanel(); const effects = pending; pending = []; effects.forEach(fn => fn());
        }
        return tree;
      };
      this.render();
    },
    fireTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    refresh() {
      const find = node => {
        if (!node || typeof node !== "object") return;
        const children = [node.props?.children].flat(Infinity);
        if (node.props?.onClick && children.some(child => typeof child === "string" && /crmPanel\.(generateReply|regenerate|generating)/.test(child))) return node;
        for (const child of children) { const found = find(child); if (found) return found; }
      };
      const button = find(tree); assert.ok(button, "refresh button exists"); button.props.onClick();
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = text => ({ source: "custom", suggestions: [{ id: text, text }] });

test("manual and automatic requests cannot put an old contact's suggestion into a new conversation", async () => {
  for (const manual of [false, true]) {
    const h = harness(); await h.mount();
    if (manual) h.refresh(); else h.fireTimers();
    assert.equal(h.requests.length, 1);
    Object.assign(h.state, { selectedContactId: "b", selectedChatId: "b" }); h.render(); h.fireTimers();
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve(reply("B reply")); await settle();
    h.requests[0].resolve(reply("STALE A reply")); await settle();
    assert.equal(h.state.aiSuggestions[0].text, "B reply");
    h.unmount();
  }
});

test("sent replies and model changes refresh suggestions, receipts do not; unmount invalidates pending manual requests", async () => {
  const h = harness(); await h.mount(); h.fireTimers();
  h.requests[0].resolve(reply("first")); await settle(); h.render();
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: h.state.messagesByChatId.a.map(m => ({ ...m, deliveryStatus: "read" })) };
  h.render(); h.fireTimers(); assert.equal(h.requests.length, 1);
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: [...h.state.messagesByChatId.a, { id: "a-out", chatId: "a", direction: "out", body: "Already answered.", deliveryStatus: "sent", sentAt: "2026-01-01T00:01:00Z" }] };
  h.render(); h.fireTimers(); assert.equal(h.requests.length, 2);
  h.state.settings = { ...h.state.settings, customAiModel: "two" }; h.render(); h.fireTimers();
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve(reply("new model")); h.requests[1].resolve(reply("old model")); await settle(); h.render();
  assert.equal(h.state.aiSuggestions[0].text, "new model");
  h.refresh(); assert.equal(h.requests.length, 4); h.unmount();
  h.requests[3].resolve(reply("AFTER UNMOUNT")); await settle();
  assert.equal(h.state.aiSuggestions[0].text, "new model");
});
