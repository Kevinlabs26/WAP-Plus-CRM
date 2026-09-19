import assert from "node:assert/strict";
import { createChatFolderActions } from "../src/store/chatFolderActions.ts";

let settings = {
  chatFolders: [
    { id: "parent", name: "Parent", sort: 0, chatIds: ["chat-1", "chat-2"] },
    { id: "child", parentId: "parent", name: "Child", sort: 1, chatIds: ["chat-3"] },
  ],
  chatFolderClones: [
    { id: "clone-1", folderId: "parent", sourceChatId: "chat-4" },
    { id: "clone-2", folderId: "child", sourceChatId: "chat-5" },
  ],
};

const actions = createChatFolderActions({
  getSettings: () => settings,
  updateSettings: (patch) => {
    settings = { ...settings, ...patch };
  },
  pushToast() {},
});

actions.clearChatFolder("parent");

assert.deepEqual(settings.chatFolders[0].chatIds, []);
assert.deepEqual(settings.chatFolders[1].chatIds, ["chat-3"]);
assert.deepEqual(settings.chatFolderClones, [
  { id: "clone-2", folderId: "child", sourceChatId: "chat-5" },
]);

console.log("chat-folder-actions.test.mjs ok");
