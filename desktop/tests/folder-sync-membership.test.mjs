import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  "react": "export const useMemo = fn => fn(); export const useCallback = fn => fn;",
  "zustand/react/shallow": "export const useShallow = selector => selector;",
  "@/store/appStore": "export const useAppStore = Object.assign(selector => selector(globalThis.folderSidebarState), { getState: () => globalThis.folderSidebarState });",
  "./persist": "export const persist = async () => {}; export const scheduleStatsRecompute = () => {};",
  "@/lib/storage": "export const registerChatMessageReplacements = () => {}; export const clearStoredRemoteMessages = async () => {}; export const deleteStoredMessagesByKeys = async () => {}; export const updateStoredMessageAcks = async () => {}; export const clearStoredChatMessages = async () => {}; export const getMessageFromDb = async () => null; export const searchMessagesInDb = async () => null;",
  "@/lib/mediaCache": "export const bridgeMessageMediaCacheId = (id, accountId) => accountId + ':' + id; export const cacheMediaUrl = async () => {}; export const dropMediaCache = async () => {};",
  "@/lib/composerActivity": "export const isComposerTypingBusy = () => false;",
  "@/lib/syncDebug": "export const noteMainThreadWork = () => {}; export const syncLog = () => {}; export const isSyncDebugEnabled = () => false;",
  "@/lib/aiAutoReply": "export const emitLiveInboundMessages = () => {};",
  "@/lib/inboundMessageNotify": "export const notifyInboundMessages = () => {};",
};
const built = await build({
  stdin: { contents: `export { createIngestSlice } from './src/store/ingestSlice.ts';
    export { createMessageActionsSlice } from './src/store/messageActionsSlice.ts';
    export { useSidebarData } from './src/components/layout/useSidebarData.ts';
    export { defaultSettings } from './src/store/settingsDefaults.ts';
    export { buildSidebarItems } from './src/components/layout/buildSidebarItems.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "sync-io", setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { createIngestSlice, createMessageActionsSlice, useSidebarData, defaultSettings, buildSidebarItems } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

for (const source of ["contacts", "contacts without LID chat", "live messages", "history with imported chat"]) {
  test(`${source}: resolving 16 LID identities keeps all 36 folder members and clone references`, async () => {
    const originalWindow = globalThis.window;
    globalThis.window = { setTimeout };
    try {
      const contacts = [], chats = [], items = [];
      for (let i = 0; i < 36; i++) {
        const phone = `+120255501${String(i).padStart(2, "0")}`;
        contacts.push({ id: `pn-${i}`, accountId: "wa", phone, name: `Customer ${i}`, tags: [], stage: "new" });
        chats.push({ id: `bridge-chat-pn-${i}`, contactId: `pn-${i}`, accountId: "wa", phoneId: "wa", contactName: `Customer ${i}`, unread: 0 });
        if (i >= 16) continue;
        const jid = `${7000000 + i}@lid`;
        contacts.push({ id: `lid-${i}`, accountId: "wa", channelAddress: jid, phone: "", name: `Customer ${i}`, tags: [], stage: "new" });
        if (source !== "contacts without LID chat") chats.push({ id: `bridge-chat-lid-${i}`, contactId: `lid-${i}`, accountId: "wa", phoneId: "wa", contactName: `Customer ${i}`, unread: 0 });
        if (source === "history with imported chat") chats.push({ id: `chat-lid-${i}`, contactId: `lid-${i}`, accountId: "wa", phoneId: "wa", contactName: `Customer ${i}`, unread: 0 });
        items.push({ jid, phoneE164: phone, name: `Customer ${i}`, id: `message-${i}`, body: "hello", direction: "in", sentAt: "2026-10-14T10:00:00Z" });
      }
      let state = { hydrated: true, contacts, chats, messages: [], phones: [], followUps: [], activities: [], peerPresenceByKey: {}, baileysUi: {},
        selectedChatId: "bridge-chat-pn-0", selectedContactId: "pn-0", pushToast() {},
        settings: { ...defaultSettings, waAccounts: [{ id: "wa" }], activeAccountId: "wa", liveBaileysAccountId: "wa",
          chatFolders: [{ id: "leads", name: "Leads", scope: { type: "all" }, chatIds: Array.from({ length: 36 }, (_, i) => `bridge-chat-pn-${i}`) }],
          chatFolderClones: [{ id: "clone", folderId: "leads", sourceChatId: "bridge-chat-pn-0" }] } };
      const ctx = { get: () => state, set: patch => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; } };
      Object.assign(state, createIngestSlice(ctx));
      const folderRows = () => buildSidebarItems({ listTab: "chats", archivedCount: 0, showArchived: false, isAllAccountsView: true,
        filteredChats: state.chats, contactById: new Map(state.contacts.map(c => [c.id, c])), chatFolders: state.settings.chatFolders,
        chatFolderClones: [], ungroupedCollapsed: false, query: "", folderDisplayName: f => f.name });
      assert.equal(folderRows().find(row => row.kind === "folder_header").total, 36);
      await state.ingestBridgeEvents([{ type: source.startsWith("contacts") ? "contacts.sync" : "messages.sync", deviceId: "wa",
        payload: { items, live: source === "live messages", source: source === "history with imported chat" ? "history" : undefined } }]);
      assert.equal(folderRows().find(row => row.kind === "folder_header").total, 36);
      const targetId = source === "history with imported chat" ? "chat-lid-0" : "bridge-chat-lid-0";
      assert.equal(state.settings.chatFolders[0].chatIds[0], targetId);
      assert.equal(state.settings.chatFolderClones[0].sourceChatId, targetId);
      assert.equal(state.selectedChatId, targetId);
      assert.equal(state.contacts.length, 36);
      assert.equal(state.contacts.filter(c => c.id.startsWith("pn-")).length, 20);
    } finally { globalThis.window = originalWindow; }
  });
}

for (const scenario of [
  { name: "first send on the original account", accountId: "wa-a" },
  { name: "first send on another account", accountId: "wa-b" },
  { name: "later send on another account", accountId: "wa-b", alreadyChatted: true },
  { name: "first send from a child folder", accountId: "wa-b", child: true },
  { name: "first send with a cloned folder entry", accountId: "wa-b", clone: true },
]) {
  test(`${scenario.name} keeps the customer in their folder`, () => {
    const contact = { id: "c-lead", name: "New customer", phone: "+12025550100", accountId: "wa-a" };
    const originalChat = { id: "chat-c-lead", contactId: contact.id, contactName: contact.name, accountId: "wa-a", phoneId: "wa-a",
      hasMessageHistory: !!scenario.alreadyChatted, lastMessage: scenario.alreadyChatted ? "earlier" : "", unread: 0 };
    const folder = { id: "leads", name: "Leads", scope: { type: "all" }, chatIds: scenario.clone ? [] : [originalChat.id],
      ...(scenario.child ? { parentId: "parent" } : {}) };
    let state = { contacts: [contact], chats: [originalChat], messages: [], messagesByChatId: {}, chatListFilter: "all", baileysUi: {},
      settings: { ...defaultSettings, accountViewMode: { type: "all" }, activeAccountId: "wa-a", liveBaileysAccountId: "wa-a",
        waAccounts: [{ id: "wa-a" }, { id: "wa-b" }],
        chatFolders: scenario.child ? [{ id: "parent", name: "Parent", scope: { type: "all" }, chatIds: [] }, folder] : [folder],
        chatFolderClones: scenario.clone ? [{ id: "clone", folderId: folder.id, sourceChatId: originalChat.id }] : [] },
      recomputeStats() {}, logActivity() {}, setChatListFilter() {} };
    const ctx = { get: () => state, set: patch => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; } };
    Object.assign(state, createMessageActionsSlice(ctx));
    const sidebar = () => {
      globalThis.folderSidebarState = state;
      return useSidebarData({ listTab: "chats", query: "", showArchived: false, chatSort: "recent", ungroupedCollapsed: false,
        groupFilter: "all", collapsedLeadDateIds: new Set() });
    };
    const total = () => sidebar().sidebarItems.find(row => row.kind === "folder_header" && row.folderId === folder.id).total;
    try {
      assert.equal(total(), 1);
      const chatId = state.ensureChatForContact(contact.id, scenario.accountId);
      const messageId = state.enqueueOutgoingMessage({ chatId, contactId: contact.id, accountId: scenario.accountId, body: "hello", deliveryStatus: "pending" });
      assert.equal(total(), 1, "queued first send must keep folder membership");
      state.updateMessageDelivery(messageId, { deliveryStatus: "sent" });
      assert.equal(total(), 1, "successful first send must keep folder membership");
      if (!scenario.clone) assert.ok(sidebar().sidebarItems.some(row => row.kind === "chat" && row.folderId === folder.id && row.chat.id === chatId), "the active sending thread must still appear inside the folder");
      assert.deepEqual(state.settings.chatFolders.find(f => f.id === folder.id).chatIds, folder.chatIds);
      const unrelatedEmpty = { ...originalChat, id: "unfiled-empty", accountId: "wa-c", phoneId: "wa-c", hasMessageHistory: false, lastMessage: "" };
      state = { ...state, chats: [...state.chats, unrelatedEmpty] };
      assert.ok(!sidebar().filteredChats.some(chat => chat.id === unrelatedEmpty.id), "unfiled empty siblings should still be hidden");
      assert.equal(total(), 1);
    } finally { delete globalThis.folderSidebarState; }
  });
}
