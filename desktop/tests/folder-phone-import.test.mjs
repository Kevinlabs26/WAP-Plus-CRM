import assert from "node:assert/strict";
import { createContactCreationActions } from "../src/store/contactCreationActions.ts";
import { restoreLocalContactChats } from "../src/store/localContactChats.ts";
import {
  importPhonesToFolder,
  parseFolderPhoneEntries,
} from "../src/store/importPhonesToFolder.ts";
import { pruneChatFolderRefs } from "../src/store/chatFolderCleanup.ts";
import {
  mergeImportedContactChatDuplicates,
} from "../src/store/chatDuplicateMerge.ts";
import { collapseAllAccountFolderChats } from "../src/components/layout/folderChatDisplay.ts";

assert.deepEqual(
  parseFolderPhoneEntries(
    "12025550122\n1 202 555 0123\n+1-202-555-0124\n(1) 2025550125"
  ),
  ["12025550122", "12025550123", "12025550124", "12025550125"]
);

const contacts = [
  {
    id: "c-imported",
    name: "+12025550100",
    phone: "+12025550100",
    accountId: "wa-1",
    source: "分组导入",
    tags: [],
    stage: "new",
  },
  {
    id: "bridge-contact-remote",
    name: "Remote",
    phone: "+12025550101",
    accountId: "wa-1",
    tags: [],
    stage: "new",
  },
];

const restored = restoreLocalContactChats([], contacts);
assert.equal(restored.length, 1);
assert.equal(restored[0]?.id, "chat-c-imported");
assert.equal(restored[0]?.accountId, "wa-1");

let state = { contacts: [], chats: [], phones: [{ id: "wa-1" }] };
const contactPersistModes = [];
const actions = createContactCreationActions({
  setState: (update) => {
    state = { ...state, ...update(state) };
  },
  setSelection() {},
  setActiveChats() {},
  logActivity() {},
  recomputeStats() {},
  persist(immediate) {
    contactPersistModes.push(Boolean(immediate));
  },
});
const input = {
  name: "Test",
  phone: "+12025550102",
  accountId: "wa-1",
  tags: [],
  stage: "new",
};
actions.addContact(input);
actions.addContact(input);
assert.equal(new Set(state.contacts.map((contact) => contact.id)).size, 2);
assert.equal(new Set(state.chats.map((chat) => chat.id)).size, 2);
assert.ok(state.chats.every((chat) => chat.accountId === "wa-1"));
actions.importContacts([{ ...input, phone: "+12025550103" }]);
assert.equal(contactPersistModes.at(-1), true);

let importedContacts = [];
let importedChats = [];
const folderImportPersistModes = [];
importPhonesToFolder("all", "+12025550133", {
  getFolder: () => ({
    id: "all",
    name: "Prospects",
    sort: 0,
    chatIds: [],
    scope: { type: "all" },
  }),
  getContacts: () => importedContacts,
  getChats: () => importedChats,
  defaultAccountId: () => "wa-default-send",
  selectedPhoneId: () => "wa-last-viewed",
  addContact: (contact) => {
    const saved = { ...contact, id: "c-default" };
    importedContacts.push(saved);
    importedChats.unshift({
      id: "chat-c-default",
      contactId: saved.id,
      contactName: saved.name,
      lastMessage: "",
      unread: 0,
      updatedAt: "2026-01-01",
      phoneId: saved.boundPhoneId,
      accountId: saved.accountId,
    });
  },
  prependChat: (chat) => importedChats.unshift(chat),
  moveChatToFolder() {},
  recomputeStats() {},
  persist(immediate) {
    folderImportPersistModes.push(Boolean(immediate));
  },
  pushToast() {},
});
assert.equal(importedContacts[0]?.accountId, "wa-default-send");
assert.equal(importedChats[0]?.accountId, "wa-default-send");
assert.equal(folderImportPersistModes.at(-1), true);

const collapsed = collapseAllAccountFolderChats(
  [
    { id: "chat-a", contactId: "contact-a", contactName: "A", lastMessage: "old", unread: 1, updatedAt: "2026-01-01", phoneId: "wa-1", accountId: "wa-1" },
    { id: "chat-b", contactId: "contact-b", contactName: "B", lastMessage: "new", unread: 2, updatedAt: "2026-01-02", phoneId: "wa-2", accountId: "wa-2" },
  ],
  new Map([
    ["contact-a", { id: "contact-a", name: "A", phone: "+243994155710", tags: [], stage: "new" }],
    ["contact-b", { id: "contact-b", name: "B", phone: "+243 994 155 710", tags: [], stage: "new" }],
  ])
);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0]?.accountCount, 2);
assert.equal(collapsed[0]?.chat.id, "chat-b");
assert.equal(collapsed[0]?.chat.unread, 3);

const collapsedWithSyncedPlaceholder = collapseAllAccountFolderChats(
  [
    { id: "chat-active", contactId: "contact-a", contactName: "A", lastMessage: "hello", unread: 0, updatedAt: "2026-01-01", accountId: "wa-1" },
    { id: "chat-placeholder", contactId: "contact-b", contactName: "A", lastMessage: "", unread: 0, updatedAt: "2026-01-02", accountId: "wa-2" },
  ],
  new Map([
    ["contact-a", { id: "contact-a", name: "A", phone: "+243994155710", tags: [], stage: "new" }],
    ["contact-b", { id: "contact-b", name: "A", phone: "+243 994 155 710", tags: [], stage: "new" }],
  ])
);
assert.equal(collapsedWithSyncedPlaceholder[0]?.accountCount, 1);
assert.equal(collapsedWithSyncedPlaceholder[0]?.chat.id, "chat-active");

const cleaned = pruneChatFolderRefs(
  [{ id: "f", name: "F", sort: 0, chatIds: ["ok", "stale", "ok"] }],
  [{ id: "clone", folderId: "missing", sourceChatId: "ok" }],
  new Set(["ok"])
);
assert.deepEqual(cleaned.folders[0]?.chatIds, ["ok"]);
assert.equal(cleaned.clones.length, 0);
assert.equal(cleaned.changed, true);

const remappedRefs = pruneChatFolderRefs(
  [
    {
      id: "f",
      name: "F",
      sort: 0,
      chatIds: ["bridge-chat-c-new"],
    },
  ],
  [
    {
      id: "clone",
      folderId: "f",
      sourceChatId: "bridge-chat-c-new",
    },
  ],
  new Set(["chat-c-new"]),
  new Map([["bridge-chat-c-new", "chat-c-new"]])
);
assert.deepEqual(remappedRefs.folders[0]?.chatIds, ["chat-c-new"]);
assert.equal(remappedRefs.clones[0]?.sourceChatId, "chat-c-new");
assert.equal(remappedRefs.changed, true);

const mergedChats = mergeImportedContactChatDuplicates(
  [
    {
      id: "chat-c-new",
      contactId: "c-new",
      contactName: "New",
      lastMessage: "",
      unread: 0,
      updatedAt: "2026-01-01",
      phoneId: "wa-1",
      accountId: "wa-1",
    },
    {
      id: "bridge-chat-c-new",
      contactId: "c-new",
      contactName: "New",
      lastMessage: "sent",
      unread: 0,
      updatedAt: "2026-01-02",
      phoneId: "wa-1",
      accountId: "wa-1",
      hasOutgoingHistory: true,
    },
  ],
  [
    {
      id: "m1",
      chatId: "bridge-chat-c-new",
      contactId: "c-new",
      direction: "out",
      body: "sent",
      sentAt: "2026-01-02",
    },
  ],
  "bridge-chat-c-new"
);
assert.equal(mergedChats.chats.length, 1);
assert.equal(mergedChats.chats[0]?.id, "chat-c-new");
assert.equal(mergedChats.chats[0]?.lastMessage, "sent");
assert.equal(mergedChats.chats[0]?.hasOutgoingHistory, true);
assert.equal(mergedChats.messages[0]?.chatId, "chat-c-new");
assert.equal(mergedChats.selectedChatId, "chat-c-new");

console.log("folderPhoneImport ok");
