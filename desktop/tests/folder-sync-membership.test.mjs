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
    export { mergeImportedContactChatDuplicates, protectedGroupChatIds } from './src/store/chatDuplicateMerge.ts';
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
const { createIngestSlice, createMessageActionsSlice, mergeImportedContactChatDuplicates, protectedGroupChatIds, useSidebarData, defaultSettings, buildSidebarItems } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

function groupStore(contacts=[],chats=[],messages=[]) {
  let state={hydrated:true,contacts,chats,messages,phones:[],followUps:[],activities:[],peerPresenceByKey:{},baileysUi:{},
    selectedChatId:null,selectedContactId:null,draftReplyByChatId:{},settings:{...defaultSettings,waAccounts:[{id:'a'},{id:'b'}]},
    recomputeStats(){},pushToast(){}};
  const ctx={get:()=>state,set:patch=>{state={...state,...(typeof patch==='function'?patch(state):patch)};}};
  Object.assign(state,createIngestSlice(ctx),createMessageActionsSlice(ctx));return {get state(){return state;}};
}
const groupContact=(id,owner,jid='12345@g.us')=>({id,name:'Same group name',accountId:owner,boundPhoneId:owner,channelAddress:jid,isGroup:true,phone:'',tags:[],stage:'new'});
const groupChat=(contact,extra={})=>({id:`bridge-chat-${contact.id}`,contactId:contact.id,contactName:contact.name,accountId:contact.accountId,phoneId:contact.accountId,isGroup:true,unread:0,lastMessage:'',...extra});

test('incoming leads check hidden accounts before applying the current sidebar view', () => {
  const contact = {id:'known-a', name:'Returning contact', phone:'+12025550100', accountId:'a'};
  const other = {...contact, id:'known-b', accountId:'b'};
  const old = {id:'old', contactId:contact.id, contactName:contact.name, accountId:'a', phoneId:'a', unread:0,
    firstConversationMessage:{at:'2026-08-01T10:00:00.000Z',direction:'out'}, hasOutgoingHistory:true};
  const recent = {id:'recent', contactId:other.id, contactName:other.name, accountId:'b', phoneId:'b', unread:1, updatedAt:'2026-11-09T10:00:00.000Z',lastMessage:'Hello again'};
  const state = {contacts:[contact,other],chats:[old,recent],chatListFilter:'leads',baileysUi:{},messagesByChatId:{recent:[{id:'in',chatId:recent.id,accountId:'b',direction:'in',body:'Hello again',sentAt:recent.updatedAt}]},
    settings:{...defaultSettings,accountViewMode:{type:'account',accountId:'b'},activeAccountId:'b',liveBaileysAccountId:'b',waAccounts:[{id:'a'},{id:'b'}]},setChatListFilter(){}};
  globalThis.folderSidebarState = state;
  try {
    const sidebar = useSidebarData({listTab:'chats',query:'',showArchived:false,chatSort:'recent',ungroupedCollapsed:false,groupFilter:'all',collapsedLeadDateIds:new Set()});
    assert.equal(sidebar.leadCount,0);
    assert.equal(sidebar.filteredChats.length,0);
  } finally { delete globalThis.folderSidebarState; }
});

test('invited group uses the incoming-sync chat ID so the filed thread receives messages',async()=>{
  const originalWindow=globalThis.window;globalThis.window={setTimeout};
  try{
    const h=groupStore();await h.state.ingestBridgeEvents([{type:'contacts.sync',accountId:'a',payload:{items:[{jid:'12345@g.us',isGroup:true,displayName:'Invited group'}]}}]);
    const contact=h.state.contacts[0],chatId=h.state.ensureChatForContact(contact.id,'a');
    assert.equal(chatId,`bridge-chat-${contact.id}`);assert.equal(h.state.chats[0].isGroup,true);
    h.state.settings={...h.state.settings,chatFolders:[{id:'folder',name:'Group folder',chatIds:[chatId]}]};
    await h.state.ingestBridgeEvents([{type:'messages.sync',accountId:'a',payload:{source:'snapshot',live:false,items:[{jid:'12345@g.us',isGroup:true,id:'incoming',body:'hello',direction:'in',sentAt:'2026-11-02T09:00:00Z'}]}}]);
    assert.equal(h.state.chats.length,1);assert.equal(h.state.messages[0].chatId,chatId);assert.equal(h.state.chats[0].lastMessage,'hello');assert.deepEqual(h.state.settings.chatFolders[0].chatIds,[chatId]);
  }finally{globalThis.window=originalWindow;}
});

test('group account switching uses the matching group contact and never creates a foreign-account shell',()=>{
  const a=groupContact('group-a','a'),b=groupContact('group-b','b');
  const real=groupChat(b),ghost=groupChat(b,{id:`bridge-chat-${b.id}-b`});
  const h=groupStore([a,b],[ghost,real]);
  assert.equal(h.state.ensureChatForContact(a.id,'b'),real.id);assert.equal(h.state.chats.length,2);
  assert.equal(h.state.ensureChatForContact(a.id,'not-joined'),null);assert.equal(h.state.chats.length,2);
  const legacy=groupStore([a],[groupChat(a,{accountId:undefined})]);
  assert.equal(legacy.state.ensureChatForContact(a.id,'a'),legacy.state.chats[0].id);
});

test('snapshot repairs empty invite shells by JID and sending account, including folder and clone references',async()=>{
  const originalWindow=globalThis.window;globalThis.window={setTimeout};
  try{
    const a=groupContact('group-a','a'),b=groupContact('group-b','b'),other=groupContact('other-group','a','67890@g.us');
    const realA=groupChat(a,{lastMessage:'History A',hasMessageHistory:true,updatedAt:'2026-11-01'}),realB=groupChat(b,{lastMessage:'History B',hasMessageHistory:true,updatedAt:'2026-11-01'});
    const ghostB=groupChat(b,{id:'bridge-chat-group-b-b',hasMessageHistory:false,updatedAt:'2026-11-02'});
    const wrongAccount=groupChat(b,{id:'bridge-chat-group-b-a',accountId:'a',phoneId:'a',hasMessageHistory:false});
    const messages=[{id:'a-msg',chatId:realA.id,accountId:'a',body:'History A',direction:'in',sentAt:'2026-11-01'},{id:'b-msg',chatId:realB.id,accountId:'b',body:'History B',direction:'in',sentAt:'2026-11-01'}];
    const h=groupStore([a,b,other],[ghostB,wrongAccount,realA,realB,groupChat(other)],messages);
    h.state.selectedChatId=ghostB.id;h.state.selectedContactId=b.id;h.state.selectedThreadAccount={chatId:ghostB.id,accountId:'b'};
    h.state.settings={...h.state.settings,chatFolders:[{id:'f',chatIds:[ghostB.id,wrongAccount.id]}],chatFolderClones:[{id:'clone',folderId:'f',sourceChatId:ghostB.id}]};
    await h.state.ingestBridgeEvents([{type:'messages.sync',accountId:'a',payload:{source:'snapshot',live:false,items:[]}}]);
    assert.equal(h.state.chats.length,3);assert.equal(h.state.selectedChatId,realB.id);assert.deepEqual(h.state.selectedThreadAccount,{chatId:realB.id,accountId:'b'});
    assert.deepEqual(h.state.settings.chatFolders[0].chatIds,[realB.id,realA.id]);assert.equal(h.state.settings.chatFolderClones[0].sourceChatId,realB.id);
    assert.deepEqual(h.state.messages,messages);assert.equal(h.state.chats.find(c=>c.id===realB.id).updatedAt,realB.updatedAt);
    assert.ok(h.state.chats.some(c=>c.contactId===other.id),'same names with different group IDs stay separate');
    h.state.chats=[wrongAccount,...h.state.chats];h.state.selectedChatId=wrongAccount.id;h.state.selectedContactId=b.id;
    h.state.selectedThreadAccount={chatId:wrongAccount.id,accountId:'a'};
    await h.state.ingestBridgeEvents([{type:'messages.sync',accountId:'a',payload:{source:'snapshot',live:false,items:[]}}]);
    assert.equal(h.state.selectedChatId,realA.id);assert.equal(h.state.selectedContactId,a.id);
    assert.deepEqual(h.state.selectedThreadAccount,{chatId:realA.id,accountId:'a'});assert.deepEqual(h.state.messages,messages);
  }finally{globalThis.window=originalWindow;}
});

test('automatic invite repair preserves drafts, automation references and any populated or unverified duplicate',()=>{
  const contact=groupContact('group','a'),real=groupChat(contact),ghost=groupChat(contact,{id:'bridge-chat-group-a',hasMessageHistory:false});
  const cases=[
    {drafts:{[ghost.id]:'unsent draft'}},
    {settings:{aiAutoReplyModeByChatId:{[ghost.id]:'manual'}}},
    {settings:{aiAutoReplyManualChatIds:[ghost.id]}},
    {settings:{leadInbox:{dismissedChatIds:[ghost.id]}}},
    {settings:{scheduledMessages:[{chatId:ghost.id}]}},
    {settings:{scheduledPlans:[{items:[{chatId:ghost.id}]}]}},
    {chat:{hasMessageHistory:true}},
    {messages:[{id:'local',chatId:ghost.id,body:'keep',accountId:'a'}]},
  ];
  for(const scenario of cases){
    const merged=mergeImportedContactChatDuplicates([real,{...ghost,...scenario.chat}],scenario.messages||[],ghost.id,{contacts:[contact],protectedIds:protectedGroupChatIds({...defaultSettings,...scenario.settings},scenario.drafts)});
    assert.equal(merged.changed,false);assert.equal(merged.chats.length,2);
  }
  const otherOwner=groupChat(contact,{accountId:'b',phoneId:'b'});
  assert.equal(mergeImportedContactChatDuplicates([otherOwner,ghost],[],null,{contacts:[contact],protectedIds:new Set()}).changed,false);
});

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
