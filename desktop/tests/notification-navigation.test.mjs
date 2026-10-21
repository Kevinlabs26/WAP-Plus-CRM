import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  "./persist": "export const persist = async () => {}; export const scheduleStatsRecompute = () => {};",
  "@/lib/storage": "export const registerChatMessageReplacements = () => {}; export const clearStoredRemoteMessages = async () => {}; export const deleteStoredMessagesByKeys = async () => {}; export const updateStoredMessageAcks = async () => {};",
  "@/lib/mediaCache": "export const bridgeMessageMediaCacheId = (id, accountId) => accountId + ':' + id; export const cacheMediaUrl = async () => {};",
  "@/lib/composerActivity": "export const isComposerTypingBusy = () => false;",
  "@/lib/syncDebug": "export const noteMainThreadWork = () => {}; export const syncLog = () => {}; export const isSyncDebugEnabled = () => false;",
  "@/lib/aiAutoReply": "export const emitLiveInboundMessages = () => {};",
  "@/lib/desktopNotify": "export const showDesktopNotify = async opts => { globalThis.navigationNotifications.push(opts); return true; };",
};
const built = await build({
  stdin: { contents: `export { createIngestSlice } from './src/store/ingestSlice.ts';
    export { createUiSlice } from './src/store/uiSlice.ts';
    export { createContactWorkspaceActions } from './src/store/contactWorkspaceActions.ts';
    export { defaultSettings } from './src/store/settingsDefaults.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "navigation-io", setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path] }));
  } }],
});
const { createIngestSlice, createUiSlice, createContactWorkspaceActions, defaultSettings } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

for (const mergeBeforeClick of [false, true]) {
  test(`notification opens the message's actual thread${mergeBeforeClick ? " after a sync merge" : " instead of an empty imported thread"}`, async () => {
    const originalWindow = globalThis.window, originalDocument = globalThis.document;
    globalThis.window = { setTimeout };
    globalThis.document = { hidden: true, hasFocus: () => false };
    globalThis.navigationNotifications = [];
    try {
      let state = { hydrated: true, activeNav: "crm", phones: [], messages: [], followUps: [], activities: [], peerPresenceByKey: {}, baileysUi: {},
        contacts: [{ id: "c-import", accountId: "wa-b", boundPhoneId: "wa-b", name: "Customer", phone: "+12025550100", tags: [], stage: "new" }],
        chats: [{ id: mergeBeforeClick ? "chat-c-import" : "legacy-import-chat", contactId: "c-import", accountId: "wa-b", phoneId: "wa-b", contactName: "Customer", lastMessage: "", unread: 0 }],
        settings: { ...defaultSettings, activeAccountId: "wa-a", liveBaileysAccountId: "wa-a", waAccounts: [{ id: "wa-a" }, { id: "wa-b" }] },
        draftReplyByChatId: {}, recomputeStats() {}, pushToast() {} };
      const ctx = { get: () => state, set: patch => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; } };
      Object.assign(state, createUiSlice(ctx), createIngestSlice(ctx), createContactWorkspaceActions({
        getState: ctx.get, setState: ctx.set, scheduleStatsRecompute() {}, persist() {},
      }));
      await state.ingestBridgeEvents([{ type: "messages.sync", deviceId: "wa-b", payload: { live: true, items: [{
        id: mergeBeforeClick ? "notify-after-merge" : "notify-new", jid: "12025550100@s.whatsapp.net", phoneE164: "+12025550100",
        body: "new inbound", direction: "in", sentAt: "2026-10-16T10:00:00Z",
      }] } }]);
      assert.equal(globalThis.navigationNotifications.length, 1);
      if (mergeBeforeClick) await state.ingestBridgeEvents([{ type: "messages.sync", deviceId: "wa-b", payload: { source: "history", live: false, items: [] } }]);
      globalThis.navigationNotifications[0].onClick();
      assert.equal(state.activeNav, "chats");
      assert.equal(state.selectedThreadAccount.accountId, "wa-b");
      assert.ok(state.messages.some(m => m.chatId === state.selectedChatId && m.body === "new inbound"), "notification selection must contain the notified message immediately");
      assert.equal(state.focusMessageId, state.messages.find(m => m.body === "new inbound").id);
    } finally {
      globalThis.window = originalWindow; globalThis.document = originalDocument; delete globalThis.navigationNotifications;
    }
  });
}
