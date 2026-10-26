import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/store/contactMergeActions.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "merge-io", setup(b) {
    b.onResolve({ filter: /^\.\/persist$/ }, () => ({ path: "persist", namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const persist=()=>{};export const scheduleStatsRecompute=()=>{};" }));
  } }],
});
const { createContactMergeActions } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));

test("sharing a customer profile preserves every account identity, chat and cold-history reference", () => {
  let state = { contacts: [
    { id: "a", accountId: "wa-a", channelAddress: "111@lid", phone: "+12025550100", name: "Customer", tags: ["a"], notes: "notes" },
    { id: "b", accountId: "wa-b", boundPhoneId: "wa-b", channelAddress: "222@lid", phone: "+12025550100", name: "Other name", tags: ["b"], timeZone: "America/New_York" },
  ], chats: [{ id: "bridge-chat-a", contactId: "a", accountId: "wa-a" }, { id: "bridge-chat-b", contactId: "b", accountId: "wa-b" }],
  messages: [], followUps: [{ id: "f", contactId: "b", contactName: "Other name" }], activities: [],
  selectedChatId: "bridge-chat-b", settings: { chatFolders: [{ id: "folder", chatIds: ["bridge-chat-b"] }] } };
  const { chats, messages, settings } = state;
  const actions = createContactMergeActions({ get: () => state, set: patch => { state = { ...state, ...patch }; } });
  assert.equal(actions.mergeContacts("a", ["b"]), true);
  assert.equal(state.contacts.length, 2);
  assert.equal(state.contacts[1].accountId, "wa-b");
  assert.equal(state.contacts[1].channelAddress, "222@lid");
  assert.equal(state.contacts[1].boundPhoneId, "wa-b");
  assert.equal(state.contacts[1].name, "Customer");
  assert.equal(state.contacts[1].notes, "notes");
  assert.ok(state.contacts.every(contact => contact.timeZone === "America/New_York"));
  assert.deepEqual(state.contacts[1].tags, ["a", "b"]);
  assert.equal(state.chats.length, 2);
  assert.deepEqual(state.chats.map(c => [c.id, c.accountId, c.contactId]), chats.map(c => [c.id, c.accountId, c.contactId]));
  assert.equal(state.messages, messages);
  assert.equal(state.settings, settings);
  assert.equal(state.selectedChatId, "bridge-chat-b");
  assert.equal(state.followUps[0].contactId, "b");
  assert.equal(state.followUps[0].contactName, "Customer");
});
