import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { updateMessageIndex } from "../src/store/messageIndex.ts";
import { applyMessagesAck } from "../src/store/bridgeIngestHelpers.ts";

const mocks = {
  react: "export const useRef = current => ({current}); export const useCallback = fn => fn; export const useEffect = fn => { globalThis.historyCleanup = fn(); };",
  "@/store/appStore": "export const useAppStore = { getState: () => globalThis.historyState, setState: patch => { globalThis.historyState = { ...globalThis.historyState, ...patch(globalThis.historyState) }; } };",
  "@/lib/storage": "export const loadMessagesPage = opts => globalThis.historyLoad(opts);",
  "@/lib/baileys": "export const baileysFetchMessageHistory = async (...args) => { globalThis.historyRemote.push(args); };",
  "@/lib/syncDebug": "export const syncLog = () => {};",
};
const built = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/chat/useChatHistory.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "history-io", setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path] }));
  } }],
});
const { useChatHistory } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const message = (id, extra = {}) => ({ id, chatId: "chat", accountId: "wa-a", sentAt: "2026-10-16T10:00:00Z", body: id, ...extra });
const page = (items, limit = 200) => ({ ok: true, chatId: "chat", items, limit, total: 1000 });

function setup(messages = []) {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  const listeners = new Map(), timers = new Map(), errors = [];
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: id => timers.delete(id) };
  globalThis.document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  globalThis.historyState = { messages, messagesByChatId: {}, pushToast: text => errors.push(text) };
  globalThis.historyRemote = [];
  globalThis.historyLoad = async () => page([]);
  return { listeners, timers, errors, cleanup() {
    globalThis.historyCleanup?.();
    assert.equal(listeners.size, 0);
    globalThis.window = originalWindow; globalThis.document = originalDocument;
    for (const key of ["historyState", "historyLoad", "historyRemote", "historyCleanup"]) delete globalThis[key];
  } };
}

test("opening a warm chat still checks recent disk messages and repairs a stale nonempty index", async () => {
  const existing = Array.from({ length: 200 }, (_, i) => message(`old-${i}`));
  const env = setup(existing);
  try {
    let calls = 0;
    const latest = message("latest", { sentAt: "2026-10-16T11:00:00Z" });
    globalThis.historyState.messagesByChatId.chat = [existing[0]];
    globalThis.historyLoad = async () => { calls++; return page([...existing, latest]); };
    useChatHistory("chat", "wa-a", "wa-a"); await settle();
    assert.equal(calls, 1);
    assert.equal(globalThis.historyState.messagesByChatId.chat.length, 201);
    assert.equal(globalThis.historyState.messagesByChatId.chat.at(-1), latest);
  } finally { env.cleanup(); }
});

test("a disk page already present in memory still repairs its incomplete message index", async () => {
  const existing = message("already-loaded");
  const env = setup([existing]);
  try {
    globalThis.historyLoad = async () => page([existing]);
    useChatHistory("chat", "wa-a", "wa-a"); await settle();
    assert.deepEqual(globalThis.historyState.messagesByChatId.chat, [existing]);
  } finally { env.cleanup(); }
});

test("a just-notified message appears even before its first disk save with a stale nonempty index", async () => {
  const notified = message("not-yet-saved");
  const other = message("wrong-account", { accountId: "wa-b" });
  const env = setup([other, notified]);
  try {
    globalThis.historyState.messagesByChatId.chat = [other];
    useChatHistory("chat", "wa-a", "wa-a"); await settle();
    assert.ok(globalThis.historyState.messagesByChatId.chat.includes(notified));
  } finally { env.cleanup(); }
});

test("a transient opening failure retries without switching pages; focus also reloads history", async () => {
  const env = setup();
  try {
    let calls = 0;
    globalThis.historyLoad = async () => { if (++calls === 1) throw Error("Database busy"); return page([message(`loaded-${calls}`)]); };
    useChatHistory("chat", "wa-a", "wa-a"); await settle();
    env.timers.get(1000)(); await settle();
    assert.ok(globalThis.historyState.messages.some(m => m.id === "loaded-2"));
    env.listeners.get("focus")(); await settle();
    assert.ok(globalThis.historyState.messages.some(m => m.id === "loaded-3"));
    assert.deepEqual(env.errors, []);
  } finally { env.cleanup(); }
});

test("late disk responses cannot replace a conversation after leaving it", async () => {
  const env = setup();
  try {
    let resolve;
    globalThis.historyLoad = () => new Promise(done => { resolve = done; });
    useChatHistory("chat", "wa-a", "wa-a");
    globalThis.historyCleanup();
    resolve(page([message("stale")])); await settle();
    assert.deepEqual(globalThis.historyState.messages, []);
  } finally { env.cleanup(); }
});

test("paging crosses duplicate aliases and another account using the disk cursor", async () => {
  const existing = message("local", { waMessageId: "protocol-1" });
  const other = message("other-account", { accountId: "wa-b", sentAt: "2026-10-16T09:00:00Z" });
  const env = setup([other, existing]);
  try {
    const loadOlder = useChatHistory("chat", "wa-a", "wa-a"); await settle();
    const cursors = [], pages = [page([message("disk-alias", { waMessageId: "protocol-1" })], 1), page([other], 1),
      page([message("older", { sentAt: "2026-10-16T08:00:00Z" })], 80)];
    globalThis.historyLoad = async opts => { cursors.push(opts.beforeId); return pages.shift(); };
    const result = await loadOlder("chat", { beforeId: "local", beforeSentAt: existing.sentAt });
    assert.deepEqual(cursors, ["local", "disk-alias", "other-account"]);
    assert.equal(result.cursor.beforeId, "older");
    assert.equal(result.hasMore, false);
    assert.ok(globalThis.historyState.messages.some(m => m.id === "older"));
  } finally { env.cleanup(); }
});

test("browser history requests still run without SQLite; page errors stay retryable", async () => {
  const env = setup([message("remote", { waKey: { id: "protocol-remote", remoteJid: "12025550100@s.whatsapp.net" } })]);
  try {
    globalThis.historyLoad = async () => null;
    const loadOlder = useChatHistory("chat", "wa-a", "wa-a"); await settle();
    assert.equal(globalThis.historyRemote.length, 1);
    globalThis.historyLoad = async () => { throw Error("Disk failed"); };
    await assert.rejects(loadOlder("chat", null), /Disk failed/);
  } finally { env.cleanup(); }
});

test("opening, focus and visibility history refreshes cannot move an outgoing message below its later reply", async () => {
  for (const diskHasDuplicates of [false, true]) {
    const outgoing = message("out", { direction: "out", sentAt: "2026-10-27T11:27:09.181Z", waMessageId: "wa-out", deliveryStatus: "sent" });
    const incoming = message("reply", { direction: "in", sentAt: "2026-10-27T11:27:25.000Z" });
    const liveArrivalOrder = [incoming, outgoing];
    const env = setup(liveArrivalOrder);
    try {
      const chronological = [outgoing, incoming];
      globalThis.historyState.messagesByChatId.chat = chronological;
      globalThis.historyLoad = async () => page(diskHasDuplicates ? [outgoing, incoming] : []);
      useChatHistory("chat", "wa-a", "wa-a"); await settle();
      assert.deepEqual(globalThis.historyState.messagesByChatId.chat, chronological);
      assert.equal(globalThis.historyState.messagesByChatId.chat, chronological, "keep the already correct visible bucket");
      for (const event of ["focus", "visibilitychange"]) {
        env.listeners.get(event)(); await settle();
        assert.deepEqual(globalThis.historyState.messagesByChatId.chat.map(m => m.id), ["out", "reply"]);
      }
      const state = globalThis.historyState;
      const acked = applyMessagesAck(state.messages, [{ id: "wa-out", ack: "read" }], undefined, "wa-a");
      const index = updateMessageIndex(acked, state.messagesByChatId);
      assert.deepEqual(index.chat.map(m => m.id), ["out", "reply"]);
      assert.equal(index.chat[0].sentAt, outgoing.sentAt);
      assert.equal(index.chat[1], incoming);
    } finally { env.cleanup(); }
  }
});
