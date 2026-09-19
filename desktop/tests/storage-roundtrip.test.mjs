import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let sequence = 0;
async function setup({ sqlite = false, readError = false, writeError = false, idbError = false, snapshot = null } = {}) {
  const values = new Map();
  const calls = [];
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.indexedDB = {
    open() {
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
    if (cmd === "db_info") return { engine: sqlite ? "sqlite" : "idb" };
    if (cmd === "db_load" && readError) throw new Error("SQLite unavailable");
    if (cmd === "db_save" && writeError) throw new Error("SQLite write failed");
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
