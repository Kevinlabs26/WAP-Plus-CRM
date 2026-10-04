import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let sequence = 0;
async function setup({ sqlite = false, readError = false, writeError = false, clearError = false, idbError = false, snapshot = null, fullHistory = null, fullHistoryError = false, secureReadError = false, secureWriteError = false } = {}) {
  const values = new Map();
  const calls = [];
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.indexedDB = {
    open() {
      calls.push({ cmd: "idb_open" });
      const req = {};
      queueMicrotask(() => {
        if (idbError) { req.error = new Error("IDB unavailable"); req.onerror(); return; }
        req.result = {
          transaction() {
            const tx = {
              objectStore: () => ({
                get(key) {
                  const read = {};
                  queueMicrotask(() => { read.result = structuredClone(values.get(key)); read.onsuccess(); });
                  return read;
                },
                put(value, key) {
                  values.set(key, structuredClone(value));
                  queueMicrotask(() => tx.oncomplete());
                },
              }),
            };
            return tx;
          },
        };
        req.onsuccess();
      });
      return req;
    },
  };
  globalThis.__storageTestInvoke = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "secure_save_secrets" && secureWriteError) throw new Error("DPAPI write failed");
    if (cmd === "secure_load_secrets" && secureReadError) throw new Error("DPAPI unavailable");
    if (cmd === "db_info") return { engine: sqlite ? "sqlite" : "idb" };
    if (cmd === "db_load" && readError) throw new Error("SQLite unavailable");
    if (cmd === "db_save" && writeError) throw new Error("SQLite write failed");
    if (cmd === "db_clear" && clearError) throw new Error("SQLite clear failed");
    if (cmd === "db_load_full_history" && fullHistoryError) throw new Error("Full history unavailable");
    if (cmd === "db_load_full_history") return fullHistory;
    if (cmd === "db_load") return snapshot;
    return null;
  };
  const result = await build({
    stdin: { contents: 'export * from "./src/store/persist.ts"; export * from "./src/lib/storage.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, format: "esm", platform: "browser", write: false,
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    plugins: [{ name: "storage-boundaries", setup(b) {
      b.onResolve({ filter: /^(?:@\/lib\/(bridge|composerActivity|syncDebug)|@tauri-apps\/api\/core)$/ }, (a) => ({ path: a.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents:
        a.path.endsWith("/bridge") ? `export const isTauri = () => ${sqlite};` :
        a.path.endsWith("composerActivity") ? "export const isComposerTypingBusy = () => false;" :
        a.path.endsWith("syncDebug") ? "export const noteMainThreadWork = () => {};" :
        "export const invoke = (...args) => globalThis.__storageTestInvoke(...args);"
      }));
    } }],
  });
  const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n//${sequence++}`).toString("base64")}`);
  return { api, values, calls };
}

test("IDB roundtrip preserves unchanged messages, edits and deletions", async () => {
  const { api } = await setup();
  await api.loadAppState();
  let state = { hydrated: true, phones: [], contacts: [{ id: "c" }], chats: [{ id: "chat" }], messages: [{ id: "old", body: "old" }, { id: "edit", body: "before" }], followUps: [], activities: [], settings: {}, broadcastCampaigns: [], scheduledMessages: [], pushToast: (message) => assert.fail(message) };
  api.persist(() => state, true);
  await api.waitForPendingSaves();
  const save = async () => {
    api.persist(() => state, false, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await api.waitForPendingSaves();
    return (await api.loadAppState()).messages;
  };
  state = { ...state, messages: [...state.messages, { id: "new", body: "new" }] };
  assert.deepEqual(await save(), state.messages);
  state = { ...state, messages: state.messages.map((m) => m.id === "edit" ? { ...m, body: "after" } : m) };
  assert.deepEqual(await save(), state.messages);
  state = { ...state, messages: state.messages.filter((m) => m.id !== "old") };
  assert.deepEqual(await save(), state.messages);
});

test("SQLite read errors reject instead of migrating a stale IDB snapshot", async () => {
  const { api, values, calls } = await setup({ sqlite: true, readError: true });
  values.set("app_state_v1", { contacts: [{ id: "stale" }] });
  await assert.rejects(api.loadAppState(), /SQLite unavailable/);
  assert.equal(calls.some((c) => c.cmd === "db_save"), false);
});

test("a genuinely empty SQLite database still starts", async () => {
  const { api } = await setup({ sqlite: true });
  assert.equal(await api.loadAppState(), null);
});

test('drafts survive IDB startup and clearing one does not clear another account', async () => {
  const { api } = await setup();
  await api.loadAppState();
  let state = { hydrated: true, phones: [], contacts: [{ id: 'c' }], chats: [{ id: 'a' }, { id: 'b' }], messages: [],
    followUps: [], activities: [], settings: {}, broadcastCampaigns: [], scheduledMessages: [],
    draftReplyByChatId: { a: '报价 A', b: 'Devis B' }, pushToast: assert.fail };
  await api.flushPersist(() => state); await api.waitForPendingSaves();
  assert.deepEqual((await api.loadAppState()).draftReplyByChatId, state.draftReplyByChatId);
  state = { ...state, draftReplyByChatId: { b: 'Devis B' } };
  await api.flushPersist(() => state); await api.waitForPendingSaves();
  assert.deepEqual((await api.loadAppState()).draftReplyByChatId, { b: 'Devis B' });
});

test('SQLite draft delta writes drafts separately from messages and settings and old snapshots stay compatible', async () => {
  const { api, calls } = await setup({ sqlite: true, snapshot: { contacts: [{ id: 'c' }], chats: [{ id: 'a' }], settings: {} } });
  assert.deepEqual((await api.loadAppState()).draftReplyByChatId, {});
  let state = { hydrated: true, phones: [], contacts: [{ id: 'c' }], chats: [{ id: 'a' }], messages: [],
    followUps: [], activities: [], settings: {}, broadcastCampaigns: [], scheduledMessages: [],
    draftReplyByChatId: {}, pushToast: assert.fail };
  api.primePersistBaseline(() => state);
  state = { ...state, draftReplyByChatId: { a: 'safe draft' } };
  await api.flushPersist(() => state); await api.waitForPendingSaves();
  const saved = calls.findLast(call => call.cmd === 'db_save').args.snapshot;
  assert.deepEqual(saved.draftReplyByChatId, state.draftReplyByChatId);
  assert.equal(saved.dirty.drafts, true); assert.equal(saved.dirty.messages, false); assert.equal(saved.dirty.settings, false);
});

for (const sqlite of [false, true]) test(`oversized drafts preserve the saved draft without blocking new business data (${sqlite ? 'SQLite' : 'IDB'})`, async () => {
  const { api, calls } = await setup({ sqlite }); await api.loadAppState();
  const notices = [];
  let state = { hydrated: true, phones: [], contacts: [{ id: 'c' }], chats: [{ id: 'a' }], messages: [],
    followUps: [], activities: [], settings: { theme: 'light' }, broadcastCampaigns: [], scheduledMessages: [],
    draftReplyByChatId: { a: 'previous saved text' }, pushToast: text => notices.push(text) };
  await api.flushPersist(() => state);
  state = { ...state, messages: [{ id: 'new', chatId: 'a', body: 'new business data' }],
    settings: { theme: 'dark' }, draftReplyByChatId: { a: 'x'.repeat(65537) } };
  await api.flushPersist(() => state); await api.waitForPendingSaves();
  const saved = sqlite ? calls.findLast(call => call.cmd === 'db_save').args.snapshot : await api.loadAppState();
  assert.equal(saved.messages[0].id, 'new'); assert.equal(saved.settings.theme, 'dark');
  if (sqlite) { assert.equal(saved.dirty.drafts, false); assert.deepEqual(saved.draftReplyByChatId, {}); }
  else assert.deepEqual(saved.draftReplyByChatId, { a: 'previous saved text' });
  assert.equal(state.draftReplyByChatId.a.length, 65537); assert.match(notices[0], /草稿未保存/);
  state = { ...state, draftReplyByChatId: { a: 'shortened draft' } };
  await api.flushPersist(() => state);
  const retry = sqlite ? calls.findLast(call => call.cmd === 'db_save').args.snapshot : await api.loadAppState();
  assert.deepEqual(retry.draftReplyByChatId, { a: 'shortened draft' });
});

test('periodic SQLite draft checkpoint writes no business rows even during active input', async () => {
  const { api, calls } = await setup({ sqlite: true }); await api.loadAppState();
  const state = { hydrated: true, phones: [], contacts: [{ id: 'c' }], chats: [{ id: 'a' }], messages: [{ id: 'm' }],
    followUps: [], activities: [], settings: {}, broadcastCampaigns: [], scheduledMessages: [],
    draftReplyByChatId: { a: 'still typing' }, pushToast: assert.fail };
  await api.persistChatDrafts(() => state);
  const saved = calls.findLast(call => call.cmd === 'db_save').args.snapshot;
  assert.deepEqual(saved.draftReplyByChatId, state.draftReplyByChatId);
  for (const key of ['contacts', 'chats', 'messages']) assert.deepEqual(saved[key], []);
  assert.equal(saved.dirty.drafts, true); assert.equal(saved.dirty.settings, false);
});

test("failed migration does not report successful hydration", async () => {
  const { api, values } = await setup({ sqlite: true, writeError: true });
  values.set("app_state_v1", { contacts: [{ id: "legacy" }] });
  await assert.rejects(api.loadAppState(), /迁移.*失败/);
  assert.equal(values.get("app_state_v1").contacts[0].id, "legacy");
});

test("IDB read failures reject instead of returning an empty workspace", async () => {
  const { api } = await setup({ idbError: true });
  await assert.rejects(api.loadAppState(), /IDB unavailable/);
});

test("SQLite deletion-only deltas reach the database without triggering the wipe guard", async () => {
  const snapshot = { phones: [], contacts: [{ id: "c" }], chats: [{ id: "chat" }], messages: Array.from({length: 100}, (_, i) => ({id: `m${i}`, body: "hello"})), followUps: [], settings: {}, activities: [], broadcastCampaigns: [] };
  const { api, calls } = await setup({ sqlite: true, snapshot });
  let state = { ...await api.loadAppState(), hydrated: true, scheduledMessages: [], pushToast: (message) => assert.fail(message) };
  api.primePersistBaseline(() => state);
  state = { ...state, messages: state.messages.slice(1) };
  const save = async () => {
    api.persist(() => state, false, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await api.waitForPendingSaves();
    return calls.filter((call) => call.cmd === "db_save");
  };
  const first = await save();
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].args.snapshot.deletedMessageIds, ["m0"]);
  assert.deepEqual(first[0].args.snapshot.messages, []);
  state = { ...state, messages: [] };
  const second = await save();
  assert.equal(second.length, 2);
  assert.equal(second[1].args.snapshot.deletedMessageIds.length, 99);
});


test("failed SQLite clear stops before deleting browser data and leaves the queue usable", async () => {
  const { api, calls } = await setup({ sqlite: true, clearError: true });
  await assert.rejects(api.clearAppState(), /清空.*失败/);
  assert.equal(calls.some((call) => call.cmd === "idb_open"), false);
  await api.saveAppState({ phones: [], contacts: [], chats: [], messages: [], followUps: [], settings: {} }, { force: true });
  assert.equal(calls.filter((call) => call.cmd === "db_save").length, 1);
});

test("blocked snapshots reject and the next persist resends unsaved message rows", async () => {
  const snapshot = { phones: [], contacts: Array.from({ length: 20 }, (_, i) => ({ id: 'c' + i })), chats: Array.from({ length: 20 }, (_, i) => ({ id: 'chat' + i })), messages: Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, body: 'hello' })), followUps: [], activities: [], settings: {}, broadcastCampaigns: [] };
  const { api, calls } = await setup({ sqlite: true, snapshot });
  const toasts = [];
  let state = { ...await api.loadAppState(), hydrated: true, scheduledMessages: [], pushToast: (text) => toasts.push(text) };
  api.primePersistBaseline(() => state);
  await assert.rejects(api.saveAppState({ ...snapshot, phones: [], contacts: [], chats: [], messages: [] }), /拦截/);
  state = { ...state, contacts: [], chats: [], messages: state.messages.slice(0, 1) };
  await assert.rejects(api.persist(() => state, true), /拦截/);
  assert.equal(calls.some((call) => call.cmd === "db_save"), false);
  assert.equal(toasts.length, 1);
  state = { ...state, contacts: snapshot.contacts, chats: snapshot.chats };
  await api.persist(() => state, true);
  const saved = calls.find((call) => call.cmd === "db_save").args.snapshot;
  assert.equal(saved.dirty.messages, true);
  assert.equal(saved.messages.length, 1);
});

test("chunked SQLite saves send metadata and deletions only in the final transaction", async () => {
  const { api, calls } = await setup({ sqlite: true });
  const snapshot = { phones: [{ id: 'phone' }], contacts: [{ id: 'contact' }], chats: [{ id: 'chat' }], messages: Array.from({ length: 3001 }, (_, i) => ({ id: 'm' + i })), followUps: [{ id: 'followup' }], activities: [{ id: 'activity' }], settings: { theme: 'light' }, broadcastCampaigns: [{ id: 'campaign' }], deletedMessageIds: ['removed'] };
  await api.saveAppState(snapshot, { force: true });
  const chunks = calls.filter((call) => call.cmd === "db_save").map((call) => call.args.snapshot);
  assert.deepEqual(chunks.map((chunk) => chunk.messages.length), [1500, 1500, 1]);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.messages), snapshot.messages);
  for (const chunk of chunks.slice(0, -1)) {
    for (const key of ['phones', 'contacts', 'chats', 'followUps', 'activities', 'broadcastCampaigns', 'deletedMessageIds']) assert.deepEqual(chunk[key], []);
    assert.deepEqual(chunk.settings, {});
    assert.equal(chunk.dirty.messages, true);
    assert.equal(chunk.dirty.chats, false);
  }
  const last = chunks.at(-1);
  for (const key of ['phones', 'contacts', 'chats', 'followUps', 'activities', 'broadcastCampaigns', 'deletedMessageIds']) assert.deepEqual(last[key], snapshot[key]);
  // Final transaction must also clean messages belonging to deleted chats.
  assert.equal(last.dirty, undefined);
  assert.deepEqual(last.settings.__broadcastCampaigns, snapshot.broadcastCampaigns);

  calls.length = 0;
  await api.saveAppState({ ...snapshot, dirty: { settings: true } }, { force: true });
  const settingsOnly = calls.filter((call) => call.cmd === "db_save");
  assert.equal(settingsOnly.length, 1);
  assert.deepEqual(settingsOnly[0].args.snapshot.messages, []);

  calls.length = 0;
  await api.saveAppState({ ...snapshot, replaceMessages: true }, { force: true });
  const replacement = calls.filter((call) => call.cmd === "db_save");
  assert.equal(replacement.length, 1);
  assert.equal(replacement[0].args.snapshot.replaceMessages, true);
  assert.deepEqual(replacement[0].args.snapshot.messages, snapshot.messages);
});

test("save guards stop on database read failure instead of assuming an empty database", async () => {
  const { api, calls } = await setup({ sqlite: true, readError: true });
  await assert.rejects(api.saveAppState({ phones: [], contacts: [], chats: [], messages: [], followUps: [], settings: {} }), /SQLite unavailable/);
  assert.equal(calls.some((call) => call.cmd === "db_save"), false);
});

test("complete backup reads fail closed instead of exporting only hot history", async () => {
  const broken = await setup({ sqlite: true, fullHistoryError: true });
  await assert.rejects(broken.api.loadFullHistory(), /Full history unavailable/);
  const invalid = await setup({ sqlite: true });
  await assert.rejects(invalid.api.loadFullHistory(), /完整历史/);
  const full = { messages: [{ id: "cold" }], activities: [] };
  const valid = await setup({ sqlite: true, fullHistory: full });
  assert.deepEqual(await valid.api.loadFullHistory(), full);
  const browser = await setup();
  assert.equal(await browser.api.loadFullHistory(), null);
});


test("all shared save paths strip credentials without mutating runtime settings", async () => {
  for (const sqlite of [false, true]) {
    const { api, calls } = await setup({ sqlite });
    const settings = { theme: "dark", customAiKey: "secret", bridgeToken: "token", openaiKey: "key" };
    await api.saveAppState({ phones: [], contacts: [], chats: [], messages: [], followUps: [], settings }, { force: true });
    const saved = sqlite ? calls.find(call => call.cmd === "db_save").args.snapshot : await api.loadAppState();
    for (const key of ["customAiKey", "bridgeToken", "openaiKey"]) assert.equal(saved.settings[key], undefined);
    assert.equal(saved.settings.theme, "dark");
    assert.equal(settings.customAiKey, "secret");
  }
});

test("encrypted secret read errors propagate instead of looking like missing keys", async () => {
  const broken = await setup({ sqlite: true, secureReadError: true });
  await assert.rejects(broken.api.loadSecureSecrets(), /DPAPI unavailable/);
  const empty = await setup({ sqlite: true });
  assert.equal(await empty.api.loadSecureSecrets(), null);
  const browser = await setup({ secureReadError: true });
  assert.equal(await browser.api.loadSecureSecrets(), null);
});


test("legacy IDB credentials migrate before plaintext copies are removed", async () => {
  const legacy = { phones: [], contacts: [{ id: "c" }], chats: [], messages: [], followUps: [], settings: { customAiKey: "legacy-key", bridgeToken: "legacy-token", theme: "light" } };
  const { api, values, calls } = await setup({ sqlite: true });
  values.set("app_state_v1", legacy);
  const loaded = await api.loadAppState();
  assert.equal(loaded.settings.customAiKey, "legacy-key");
  assert.equal(calls.find(call => call.cmd === "secure_save_secrets").args.secrets.custom_ai_key, "legacy-key");
  assert.equal(values.get("app_state_v1").settings.customAiKey, undefined);
  assert.equal(calls.find(call => call.cmd === "db_save").args.snapshot.settings.customAiKey, undefined);
  const failed = await setup({ sqlite: true, secureWriteError: true });
  failed.values.set("app_state_v1", structuredClone(legacy));
  await assert.rejects(failed.api.loadAppState(), /安全迁移失败/);
  assert.equal(failed.values.get("app_state_v1").settings.customAiKey, "legacy-key");
  assert.equal(failed.calls.some(call => call.cmd === "db_save"), false);
});
