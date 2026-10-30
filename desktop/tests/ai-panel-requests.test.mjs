import { resolveAutoReplyScope } from "../src/lib/autoReplyScope.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { getSuggestionContextKey } from "../src/lib/aiSuggest.ts";
import { createSuggestionCache, isManualSuggestionContext, markManualSuggestionContext } from "../src/lib/aiSuggestionCache.ts";

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
      slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
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
  const requests = []; const timers = new Map(); let timerId = 0; let contextReads = 0;
  globalThis.window = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const store = selector => selector(state); store.setState = patch => Object.assign(state, patch);
  globalThis.panelHooks = hooks;
  globalThis.panelBindings = {
    useAppStore: store, hasRealAiKey: () => true,
    resolveAutoReplyScope, createSuggestionCache, isManualSuggestionContext,
    getSuggestionContextKey: (...args) => { contextReads++; return getSuggestionContextKey(...args); },
    generateSuggestions: (...args) => new Promise(resolve => requests.push({ args, resolve })),
    useI18n: () => ({ t: key => key }), getQuickReplyCategories: () => [], filterQuickReplies: () => [],
    filterMessagesForAccount: messages => messages, cn: () => "", isWaAccountConnected: () => false,
  };
  return { state, requests, get contextReads() { return contextReads; },
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

test("streamed candidates appear while loading and cannot leak across conversations or unmount", async () => {
  const h = harness(); await h.mount(); h.fireTimers();
  const progressA = h.requests[0].args[3].onProgress;
  progressA(reply("First completed A candidate"));
  assert.equal(h.state.aiSuggestions[0].text, "First completed A candidate");
  assert.ok(JSON.stringify(h.render()).includes("First completed A candidate"), "candidate is visible before completion");
  Object.assign(h.state, { selectedContactId: "b", selectedChatId: "b" }); h.render(); h.fireTimers();
  progressA(reply("STALE A progress"));
  assert.deepEqual(h.state.aiSuggestions, []);
  Object.assign(h.state, { selectedContactId: "a", selectedChatId: "a" }); h.render(); h.fireTimers();
  assert.equal(h.requests.length, 2, "returning reuses the pending A request");
  assert.equal(h.state.aiSuggestions[0].text, "STALE A progress", "progress is replayed only into its own conversation");
  h.unmount(); progressA(reply("AFTER UNMOUNT"));
  assert.notEqual(h.state.aiSuggestions[0].text, "AFTER UNMOUNT");
  h.requests[0].resolve(reply("done A")); h.requests[1].resolve(reply("done B")); await settle();
});

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

test("sending stops automatic suggestions; manual refresh still works with the current model and context", async () => {
  const h = harness(); await h.mount(); h.fireTimers();
  h.requests[0].resolve(reply("first")); await settle(); h.render();
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: h.state.messagesByChatId.a.map(m => ({ ...m, deliveryStatus: "read" })) };
  h.render(); h.fireTimers(); assert.equal(h.requests.length, 1);
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: [...h.state.messagesByChatId.a, { id: "a-out", chatId: "a", direction: "out", body: "Already answered.", deliveryStatus: "sent", sentAt: "2026-01-01T00:01:00Z" }] };
  h.render(); h.fireTimers(); assert.equal(h.requests.length, 1);
  assert.deepEqual(h.state.aiSuggestions, [], "do not offer a reply to an already answered message");
  h.state.settings = { ...h.state.settings, customAiModel: "two" }; h.render(); h.fireTimers();
  assert.equal(h.requests.length, 1);
  h.refresh(); assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].args[2].customAiModel, "two");
  assert.equal(h.requests[1].args[1].at(-1).body, "Already answered.");
  h.requests[1].resolve(reply("new model")); await settle(); h.render();
  assert.equal(h.state.aiSuggestions[0].text, "new model");
  h.refresh(); assert.equal(h.requests.length, 3); h.unmount();
  h.requests[2].resolve(reply("AFTER UNMOUNT")); await settle();
  assert.equal(h.state.aiSuggestions[0].text, "new model");
});

test("switching away preserves pending and completed results; returning never duplicates a request", async () => {
  for (const finishWhileAway of [false, true]) {
    const h = harness(); await h.mount(); h.fireTimers();
    Object.assign(h.state, { selectedContactId: "b", selectedChatId: "b" }); h.render(); h.fireTimers();
    if (finishWhileAway) { h.requests[0].resolve(reply("A cached")); await settle(); }
    Object.assign(h.state, { selectedContactId: "a", selectedChatId: "a" }); h.render(); h.fireTimers();
    assert.equal(h.requests.length, 2, "reuse A's original request");
    if (!finishWhileAway) { h.requests[0].resolve(reply("A cached")); await settle(); }
    assert.equal(h.state.aiSuggestions[0].text, "A cached");
    h.requests[1].resolve(reply("B cached")); await settle();
    assert.equal(h.state.aiSuggestions[0].text, "A cached", "B cannot overwrite A");
    Object.assign(h.state, { selectedContactId: "b", selectedChatId: "b" }); h.render(); h.fireTimers();
    assert.equal(h.requests.length, 2);
    assert.equal(h.state.aiSuggestions[0].text, "B cached");
    h.unmount();
  }
});

test("message bursts settle once, manual clicks share pending work, and hidden panels do no automatic work", async () => {
  const h = harness(); await h.mount();
  const addIncoming = id => {
    h.state.messagesByChatId = { ...h.state.messagesByChatId, a: [...h.state.messagesByChatId.a, {
      id, chatId: "a", direction: "in", body: id, sentAt: `2026-01-01T00:0${id}:00Z`,
    }] }; h.render();
  };
  addIncoming("1"); addIncoming("2"); h.fireTimers();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].args[1].length, 3);
  h.refresh(); h.refresh(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(reply("combined")); await settle(); h.render();
  h.state.crmPanelTab = "quick-replies"; h.render(); addIncoming("3"); h.fireTimers();
  assert.equal(h.requests.length, 1);
  h.state.crmPanelTab = "customer"; h.render(); h.fireTimers(); assert.equal(h.requests.length, 2);
  h.state.crmPanelCollapsed = true; h.render();
  h.requests[1].resolve(reply("while collapsed")); await settle();
  h.state.crmPanelCollapsed = false; h.render(); h.fireTimers();
  assert.equal(h.requests.length, 2);
  assert.equal(h.state.aiSuggestions[0].text, "while collapsed");
  h.unmount();
});

test("failed requests are retryable and changed incoming text, identity, model and account cannot reuse old suggestions", async () => {
  const h = harness(); await h.mount(); h.fireTimers();
  h.requests[0].resolve({ ...reply("fallback"), fallback: true }); await settle(); h.render();
  Object.assign(h.state, { selectedContactId: "b", selectedChatId: "b" }); h.render();
  Object.assign(h.state, { selectedContactId: "a", selectedChatId: "a" }); h.render(); h.fireTimers();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(reply("real")); await settle(); h.render();
  for (const change of [
    () => { h.state.messagesByChatId = { ...h.state.messagesByChatId, a: h.state.messagesByChatId.a.map(m => ({ ...m, body: "edited", transcript: "new transcript" })) }; },
    () => { h.state.settings = { ...h.state.settings, aiSystemPrompt: "different identity" }; },
    () => { h.state.settings = { ...h.state.settings, customAiModel: "two" }; },
    () => { h.state.selectedThreadAccount = { chatId: "a", accountId: "b" }; },
  ]) {
    const before = h.requests.length; change(); h.render(); h.fireTimers();
    assert.equal(h.requests.length, before + 1);
    h.requests.at(-1).resolve(reply(`revision ${before}`)); await settle(); h.render();
  }
  h.unmount();
});

test("queued replies suspend generation and late old-context results cannot reappear after sending", async () => {
  const h = harness(); await h.mount(); h.fireTimers();
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: [...h.state.messagesByChatId.a, {
    id: "queued", chatId: "a", direction: "out", body: "My answer", deliveryStatus: "queued", sentAt: "2026-01-01T00:01:00Z",
  }] }; h.render(); h.fireTimers();
  h.requests[0].resolve(reply("old unanswered context")); await settle();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.state.aiSuggestions, []);
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: h.state.messagesByChatId.a.map(m => m.id === "queued" ? { ...m, deliveryStatus: "failed" } : m) };
  h.render(); h.fireTimers();
  assert.equal(h.requests.length, 1, "failed reply restores the cached unanswered context");
  assert.equal(h.state.aiSuggestions[0].text, "old unanswered context");
  h.unmount();
});

test("another conversation receiving messages does not rebuild the selected conversation's AI context", async () => {
  const h = harness(); await h.mount(); h.fireTimers();
  h.requests[0].resolve(reply("keep")); await settle(); h.render();
  const before = h.contextReads;
  h.state.messagesByChatId = { ...h.state.messagesByChatId, b: [...h.state.messagesByChatId.b, {
    id: "unrelated", chatId: "b", direction: "in", body: "Other account", sentAt: "2026-01-01T00:01:00Z",
  }] }; h.render(); h.fireTimers();
  assert.equal(h.contextReads, before);
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.aiSuggestions[0].text, "keep");
  h.unmount();
});

test("manual drafting prevents an unstarted automatic request, while explicit refresh and genuinely new context still work", async () => {
  const h = harness(); await h.mount();
  markManualSuggestionContext(getSuggestionContextKey(h.state.contacts[0], h.state.messagesByChatId.a, h.state.settings, "a"));
  h.fireTimers(); assert.equal(h.requests.length, 0);
  h.refresh(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(reply("explicit refresh")); await settle(); h.render();
  h.state.messagesByChatId = { ...h.state.messagesByChatId, a: [...h.state.messagesByChatId.a, {
    id: "new-turn", chatId: "a", accountId: "a", direction: "in", body: "New question", sentAt: "2026-01-01T01:00:00Z",
  }] }; h.render(); h.fireTimers(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(reply("new turn")); await settle(); h.unmount();
});

test("conversation reply mode saves explicit overrides and can return to folder inheritance",async()=>{
 const h=harness();h.state.settings.aiReplyMode="semi";h.state.settings.chatFolders=[{id:"f",name:"F",chatIds:["a"],autoReplyMode:"auto"}];
 h.state.updateSettings=patch=>Object.assign(h.state.settings,patch);await h.mount();
 const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.props?[t,...nodes(t.props.children)]:[];
 const selector=()=>nodes(h.render()).find(node=>node.type==="select"&&node.props.title==="autoReplyScope.chatHint");
 assert.equal(selector().props.value,"inherit");selector().props.onChange({target:{value:"manual"}});assert.equal(h.state.settings.aiAutoReplyModeByChatId.a,"manual");
 assert.equal(selector().props.value,"manual");selector().props.onChange({target:{value:"auto"}});assert.equal(resolveAutoReplyScope(h.state.settings,"a").source,"chat");
 selector().props.onChange({target:{value:"inherit"}});assert.equal(h.state.settings.aiAutoReplyModeByChatId.a,undefined);assert.equal(resolveAutoReplyScope(h.state.settings,"a").source,"folder");
 h.unmount();
});
