import assert from "node:assert/strict";
import test from "node:test";
import { exportContactFolderBackup, importContactFolderBackup, parseContactFolderBackup } from "../src/lib/contactFolderBackup.ts";

test("folder backup preserves nesting and account scope when importing again or exporting", () => {
  const backup = parseContactFolderBackup({
    userSetting: { autoReply: true },
    userGroupData: { userSetting: {
      child: { type: "folder", name: "Child", parentId: "parent", index: 0 },
      parent: { type: "folder", name: "Parent", parentId: "top", index: 1 },
      contact: { type: "user", name: "Example", wid: "12025550100@c.us", parentId: "child" },
      hidden: { type: "user", wid: "12345@lid", parentId: "child" },
      unfiled: { type: "user", wid: "12025550101@c.us", parentId: "top" },
    } },
  });
  const contacts = [{ id: "other", accountId: "other", phone: "+12025550100" }];
  const first = importContactFolderBackup({ contacts, chats: [], chatFolders: [] }, backup, "target");
  const second = importContactFolderBackup(first, backup, "target");
  assert.equal(second.contacts.length, 2);
  assert.equal(second.chats.length, 1);
  assert.equal(second.chats[0].accountId, "target");
  assert.equal(second.assigned, 1);
  assert.equal(second.skipped, 1);
  assert.equal(second.chatFolders.length, 2);
  assert.equal(second.chatFolders[1].parentId, second.chatFolders[0].id);
  assert.deepEqual(second.chatFolders[1].chatIds, [second.chats[0].id]);
  const exported = exportContactFolderBackup(second, "target");
  assert.deepEqual(exported.userSetting, {});
  const roundTrip = parseContactFolderBackup(exported);
  assert.equal(roundTrip.folders[1].parentId, roundTrip.folders[0].id);
  assert.equal(roundTrip.members[0].parentId, roundTrip.folders[1].id);
  assert.equal(roundTrip.members[0].name, "Example");
});

test("merged import keeps existing account assignments and creates one shared folder", () => {
  const backup = parseContactFolderBackup({ userGroupData: { userSetting: {
    folder: { type: "folder", name: "Shared" },
    existing: { type: "user", wid: "12025550100@c.us", parentId: "folder" },
    fresh: { type: "user", wid: "12025550101@c.us", parentId: "folder" },
  } } });
  const contacts = ["a", "b"].map(accountId => ({ id: accountId, accountId, phone: "+12025550100" }));
  const accountFolder = { id: "own", name: "Shared", sort: 1, chatIds: ["existing-b"], scope: { type: "account", accountId: "b" } };
  const chats = [{ id: "existing-b", contactId: "b", accountId: "b" }];
  const imported = importContactFolderBackup({ contacts, chats, chatFolders: [accountFolder] }, backup, "a", ["a", "b"]);
  const repeated = importContactFolderBackup(imported, backup, "a", ["a", "b"]);
  assert.equal(repeated.contacts.length, 3);
  assert.equal(repeated.chats.length, 3);
  assert.deepEqual(repeated.chatFolders[0], accountFolder);
  assert.deepEqual(repeated.chatFolders[1].scope, { type: "all" });
  assert.deepEqual(new Set(repeated.chatFolders[1].chatIds), new Set(repeated.chats.map(chat => chat.id)));
  assert.equal(repeated.contacts.find(contact => contact.phone === "+12025550101").accountId, "a");
});

test("all-account export keeps same-name folders, account hints and secondary memberships on repeated restore", () => {
  const contacts = ["a", "b"].map(accountId => ({ id: accountId, accountId, phone: "+12025550100" }));
  const chats = ["a", "b"].map(accountId => ({ id: accountId, contactId: accountId, accountId }));
  const chatFolders = ["a", "b"].map((accountId, sort) => ({
    id: "folder-" + accountId, name: "Shared", sort, chatIds: [accountId], scope: { type: "account", accountId },
  }));
  const chatFolderClones = [{ id: "clone", folderId: "folder-b", sourceChatId: "a" }];
  const backup = parseContactFolderBackup(exportContactFolderBackup({ contacts, chats, chatFolders, chatFolderClones }, null));
  assert.equal(backup.members.length, 3);
  const first = importContactFolderBackup({ contacts, chats, chatFolders: [] }, backup, "a", ["a", "b"]);
  const second = importContactFolderBackup(first, backup, "a", ["a", "b"]);
  assert.deepEqual(second.chatFolders.map(folder => folder.chatIds), [["a"], ["b"]]);
  assert.deepEqual(second.chatFolderClones, first.chatFolderClones);
  assert.equal(second.chatFolderClones.length, 1);
  assert.equal(second.chatFolderClones[0].sourceChatId, "a");
});
