import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const result = buildSync({
  stdin: { contents: 'export * from "./src/store/settingsActionsSlice.ts"; export * from "./src/store/broadcastSlice.ts"; export { normalizeLoadedSettings } from "./src/store/settingsDefaults.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  external: ["@tauri-apps/api/core"],
});
const { createSettingsActionsSlice, createBroadcastSlice, normalizeLoadedSettings } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function setup(tasks = []) {
  let state = { hydrated: false, settings: { scheduledMessages: tasks }, scheduledMessages: tasks, messages: [], broadcastCampaigns: [], pushToast() {} };
  const ctx = { get: () => state, set: (update) => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; } };
  state = { ...state, ...createSettingsActionsSlice(ctx), ...createBroadcastSlice(ctx) };
  return ctx;
}
const draft = { text: "Hello", dueAt: new Date(Date.now() + 3600000).toISOString(), contactName: "Example", recipient: "+12025550100", chatId: "chat", contactId: "c", channelId: "baileys", accountId: "wa-a" };

test("task 201 is rejected without removing any pending task", () => {
  const { get } = setup(Array.from({ length: 200 }, (_,i) => ({ id: `task-${i}`, status: "pending" })));
  const before = get().settings.scheduledMessages;
  assert.equal(get().scheduleMessage(draft), null);
  assert.equal(get().settings.scheduledMessages, before);
});

test("new tasks retain their sending account through settings reload", () => {
  const { get } = setup();
  const id = get().scheduleMessage(draft);
  const restored = normalizeLoadedSettings(get().settings).scheduledMessages;
  assert.equal(restored[0].id, id);
  assert.equal(restored[0].accountId, "wa-a");
  assert.equal(restored[0].status, "pending");
});

test("loading older oversized task lists does not discard pending work", () => {
  const tasks = Array.from({ length: 201 }, (_,i) => ({ ...draft, id: `task-${i}`, status: "pending" }));
  assert.equal(normalizeLoadedSettings({ scheduledMessages: tasks }).scheduledMessages.length, 201);
});

test("account deletion cancels its scheduled tasks and preserves other accounts", () => {
  const { get } = setup([{ id: "a", accountId: "wa-a", status: "pending" }, { id: "b", accountId: "wa-b", status: "pending" }]);
  get().retireAccountMessaging("wa-a");
  assert.deepEqual(get().settings.scheduledMessages.map((t) => t.status), ["cancelled", "pending"]);
  assert.equal(get().scheduledMessages, get().settings.scheduledMessages);
});

test("in-flight sends cannot be reported as successfully cancelled", () => {
  const { get, set } = setup([{ id: "a", accountId: "wa-a", status: "queued", messageId: "out" }]);
  set({ messages: [{ id: "out", deliveryStatus: "pending" }] });
  assert.equal(get().cancelScheduledMessage("a"), false);
  assert.equal(get().settings.scheduledMessages[0].status, "queued");
  assert.equal(get().messages[0].deliveryStatus, "pending");
});
