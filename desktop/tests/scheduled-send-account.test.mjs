import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  stdin: { contents: 'export * from "./src/components/bridge/ScheduledMessageWatcher.tsx"; export * from "./src/components/bridge/SendQueueWatcher.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "watcher-boundaries", setup(b) {
    b.onResolve({ filter: /^(react|@\/store\/appStore|@\/channels)$/ }, (a) => ({ path: a.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents:
      a.path === "react" ? "export const useRef = (current) => ({current}); export const useEffect = (effect) => effect();" :
      a.path === "@/store/appStore" ? "export const useAppStore = {getState: () => globalThis.__watcherState};" :
      'export const normalizeChannelId = (id) => id; export const dispatchSendText = async (request) => { globalThis.__sentRequests.push(request); await globalThis.__waitSend?.(); return {ok:true}; };'
    }));
  } }],
});
const { ScheduledMessageWatcher, SendQueueWatcher } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function setup(accountId = "wa-a") {
  globalThis.window = { setInterval() {}, clearInterval() {} };
  globalThis.__sentRequests = [];
  globalThis.__waitSend = undefined;
  const task = { id: "task", status: "pending", accountId, dueAt: new Date(0).toISOString(), chatId: "chat", contactId: "c", text: "Hello", recipient: "+12025550100", channelId: "baileys" };
  const state = {
    settings: { scheduledMessages: [task], waAccounts: [{ id: "wa-b", status: "connected" }], liveBaileysAccountId: "wa-b", sendChannel: "baileys" },
    chats: [{ id: "chat", accountId: "wa-a" }], contacts: [{ id: "c", accountId: "wa-a" }],
    messages: [], baileysUi: { connection: "connected" }, pushToast() {},
    updateScheduledMessage(id, patch) { Object.assign(task, patch); },
    enqueueOutgoingMessage(input) { this.messages.push({ ...input, direction: "out", id: "out", sentAt: new Date().toISOString() }); return "out"; },
    listRetryableOutgoing() { return this.messages; },
    updateMessageDelivery(id, patch) { Object.assign(this.messages.find((m) => m.id === id), patch); },
  };
  globalThis.__watcherState = state;
  return state;
}

test("due task whose account was removed never switches to the online account", () => {
  const state = setup();
  ScheduledMessageWatcher();
  assert.equal(state.messages.length, 0);
  assert.equal(state.settings.scheduledMessages[0].status, "failed");
});

test("legacy task without an account fails instead of adopting the current account", () => {
  const state = setup("");
  ScheduledMessageWatcher();
  assert.equal(state.messages.length, 0);
  assert.equal(state.settings.scheduledMessages[0].status, "failed");
});

test("offline original account stays bound and waits even when another is online", async () => {
  const state = setup();
  state.settings.waAccounts.push({ id: "wa-a", status: "disconnected" });
  ScheduledMessageWatcher();
  SendQueueWatcher();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.messages[0].accountId, "wa-a");
  assert.equal(state.messages[0].deliveryStatus, "queued");
  assert.deepEqual(globalThis.__sentRequests, []);
});

test("deleting an account after enqueue also blocks dispatch", async () => {
  const state = setup();
  state.settings.waAccounts.push({ id: "wa-a", status: "connected" });
  ScheduledMessageWatcher();
  state.settings.waAccounts = state.settings.waAccounts.filter((a) => a.id !== "wa-a");
  SendQueueWatcher();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.messages[0].deliveryStatus, "failed");
  assert.deepEqual(globalThis.__sentRequests, []);
});

test("valid task reaches dispatch with its original account", async () => {
  const state = setup("wa-b");
  ScheduledMessageWatcher();
  SendQueueWatcher();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(globalThis.__sentRequests.length, 1);
  assert.equal(globalThis.__sentRequests[0].accountId, "wa-b");
  assert.equal(state.messages[0].deliveryStatus, "sent");
});

test("cancelling or deleting a later item invalidates the queue's captured batch", async () => {
  for (const action of ["cancel", "delete", "postpone"]) {
    const state = setup("wa-b");
    ScheduledMessageWatcher();
    state.messages.push({ ...state.messages[0], id: "second", body: "second" });
    let release;
    globalThis.__waitSend = () => new Promise((resolve) => { release = resolve; });
    SendQueueWatcher();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__sentRequests.length, 1);
    state.messages = state.messages.flatMap((m) => m.id !== "second" ? [m] :
      action === "delete" ? [] : [{ ...m,
        deliveryStatus: action === "cancel" ? "failed" : "queued",
        nextAttemptAt: action === "postpone" ? new Date(Date.now() + 60000).toISOString() : undefined,
      }]);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__sentRequests.length, 1, action);
  }
});
