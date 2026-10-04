import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const mocks = {
  "@/store/appStore": "export const useAppStore = { getState: () => globalThis.flowState };",
  "@/lib/utils": "export const resolveSendTarget = () => '12025550100';",
  "@/lib/aiSuggest": "export const hasRealAiKey = () => true; export const generateSuggestions = (...args) => globalThis.generateFlow(...args);",
  "@/lib/accountConnection": "export const isWaAccountConnected = () => true;",
  "@/components/chat/sendTextMessage": "export const sendTextMessage = async (opts) => { if (opts.canSend && !opts.canSend()) { opts.updateMessageDelivery(opts.msgId, { deliveryStatus: 'failed' }); return; } globalThis.sentFlow.push(opts.text); opts.updateMessageDelivery(opts.msgId, { deliveryStatus: 'sent' }); };",
  "@/lib/desktopNotify": "export const showDesktopNotify = async (opts) => { globalThis.notificationFlow.push(opts); return true; };",
};
const built = await build({
  stdin: { contents: 'export * from "./src/lib/aiAutoReply.ts"; export * from "./src/lib/inboundMessageNotify.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  plugins: [{ name: "flow-mocks", setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }], alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { autoReplyInbound, notifyInboundMessages } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
function setup(chatId) {
  globalThis.sentFlow = [];
  const inbound = { id: chatId + "-in", chatId, contactId: "c", accountId: "wa", body: "Hello", direction: "in", sentAt: new Date().toISOString() };
  globalThis.flowState = {
    settings: { aiReplyMode: "auto", aiAutoReplyManualChatIds: [], aiAutoReplyIntervalMs: 5000, sendChannel: "baileys", liveBaileysAccountId: "wa", activeAccountId: "wa", waAccounts: [] },
    contacts: [{ id: "c", accountId: "wa", name: "Customer", phone: "12025550100" }],
    chats: [{ id: chatId, accountId: "wa", contactId: "c" }], messages: [inbound],
    baileysUi: { connection: "open" }, bridge: { connected: true }, draftReply: "my draft",
    logActivity() {}, pushToast() {}, setDraftReply(text) { this.draftReply = text; },
    enqueueOutgoingMessage(opts) { const id = chatId + "-out"; this.messages.push({ ...opts, id, direction: "out", sentAt: new Date().toISOString() }); this.draftReply = ""; return id; },
    updateMessageDelivery(id, patch) { Object.assign(globalThis.flowState.messages.find(x => x.id === id), patch); },
  };
  return inbound;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const reply = { source: "openai", suggestions: [{ text: "Hello there" }] };
test("AI completion observes current automation, takeover, provider and newest context", async () => {
  for (const mode of ["disabled", "manual-only", "manual-reply", "new-inbound", "endpoint"]) {
    const inbound = setup(mode);
    const ai = deferred(); globalThis.generateFlow = () => ai.promise;
    const running = autoReplyInbound(inbound);
    const state = globalThis.flowState;
    if (mode === "disabled") state.settings = { ...state.settings, aiReplyMode: "semi" };
    if (mode === "manual-only") state.settings = { ...state.settings, aiAutoReplyManualChatIds: [inbound.chatId] };
    if (mode === "endpoint") state.settings = { ...state.settings, customAiBaseUrl: "https://changed.invalid" };
    if (mode === "manual-reply" || mode === "new-inbound") state.messages.push({ ...inbound, id: "new", direction: mode === "manual-reply" ? "out" : "in", sentAt: new Date(Date.now() + 1).toISOString() });
    ai.resolve(reply); await running;
    assert.deepEqual(globalThis.sentFlow, [], mode);
  }
});
test("inbound arriving during generation is coalesced and receives the only reply", async () => {
  const inbound = setup("coalesced"); const first = deferred(); const contexts = [];
  globalThis.generateFlow = (_contact, thread) => { contexts.push(thread.map(x => x.id)); return contexts.length === 1 ? first.promise : Promise.resolve(reply); };
  const running = autoReplyInbound(inbound);
  const latest = { ...inbound, id: "latest", body: "How are you?", sentAt: new Date(Date.now() + 1).toISOString() };
  globalThis.flowState.messages.push(latest);
  await autoReplyInbound(latest);
  first.resolve(reply); await running;
  assert.equal(contexts.length, 2);
  assert.ok(contexts[1].includes("latest"));
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
  assert.equal(globalThis.flowState.draftReply, "my draft");
});
test("cooldown retains new inbound and rechecks automation when timer fires", async () => {
  const inbound = setup("cooldown"); globalThis.generateFlow = async () => reply;
  await autoReplyInbound(inbound);
  const latest = { ...inbound, id: "cooldown-latest", sentAt: new Date(Date.now() + 1).toISOString() };
  globalThis.flowState.messages.push(latest);
  const original = globalThis.setTimeout; let callback;
  globalThis.setTimeout = (fn, ms) => { assert.ok(ms > 0); callback = fn; return 123; };
  try { await autoReplyInbound(latest); } finally { globalThis.setTimeout = original; }
  assert.equal(typeof callback, "function");
  globalThis.flowState.settings.aiReplyMode = "semi";
  callback(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
});
test("private notifications exclude customer text, names and avatars", () => {
  globalThis.document = { hasFocus: () => false }; globalThis.notificationFlow = [];
  for (const privacy of ["name", "hidden", "full"]) {
    notifyInboundMessages([{ chatId: "chat", messageId: privacy, contactName: "Private Customer", senderName: "Private Sender", body: "secret message", avatarUrl: "private-avatar", isGroup: true }], {
      selectedChatId: null, mutedUntilByChatId: {}, enabled: true, groupMessagesEnabled: true, privacy, openChat() {},
    });
  }
  const [name, hidden, full] = globalThis.notificationFlow;
  assert.equal(name.title, "Private Customer"); assert.equal(name.body.includes("secret"), false); assert.equal(name.body.includes("Private Sender"), false);
  assert.equal(hidden.title.includes("Private"), false); assert.equal(hidden.body.includes("secret"), false); assert.equal(hidden.avatarUrl, undefined);
  assert.equal(full.body, "Private Sender：secret message");
});

test("old manual history outside the context window does not prevent a fresh reply", async () => {
  const inbound = setup("long-history");
  globalThis.flowState.messages.unshift(...Array.from({ length: 20 }, (_, index) => ({ ...inbound, id: "old-" + index, direction: index === 0 ? "out" : "in", sentAt: new Date(Date.now() - 3600000 + index).toISOString() })));
  globalThis.generateFlow = async () => reply;
  await autoReplyInbound(inbound);
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
});

test("dispatch rechecks automation after waiting behind an account send", async () => {
  const channels = await build({
    entryPoints: [fileURLToPath(new URL("../src/channels/index.ts", import.meta.url))], bundle: true, format: "esm", platform: "browser", write: false,
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    plugins: [{ name: "senders", setup(b) {
      b.onResolve({ filter: /^\.\/(baileys|androidBridge)$/ }, args => ({ path: args.path, namespace: "sender" }));
      b.onLoad({ filter: /.*/, namespace: "sender" }, args => ({ contents: "export const " + (args.path.endsWith("baileys") ? "baileysChannel" : "androidBridgeChannel") + " = { sendText: input => globalThis.gateSend(input) };" }));
    } }],
  });
  const { dispatchSendText } = await import("data:text/javascript;base64," + Buffer.from(channels.outputFiles[0].text).toString("base64"));
  const started = deferred(); const release = deferred(); let sends = 0; let allowed = true;
  globalThis.gateSend = async () => { sends++; started.resolve(); await release.promise; return { ok: true, delivered: true, status: "sent" }; };
  const input = { accountId: "wait-test", phoneE164: "12025550100", text: "hello" };
  const config = { channelId: "baileys", rateLimitEnabled: false, blockSendWhenOverheated: false };
  const first = dispatchSendText(input, config); await started.promise;
  const second = dispatchSendText(input, { ...config, canSend: () => allowed });
  allowed = false; release.resolve();
  const [, cancelled] = await Promise.all([first, second]);
  assert.equal(sends, 1); assert.equal(cancelled.error, "automation_cancelled"); assert.equal(cancelled.status, "failed");
});
