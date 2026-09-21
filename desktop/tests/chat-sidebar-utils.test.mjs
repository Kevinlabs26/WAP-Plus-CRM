import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/components/layout/chatSidebarUtils.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  alias: { "@": join(dir, "../src") },
  loader: { ".ts": "ts", ".tsx": "tsx" },
  write: false,
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("sidebar chat filtering reuses the supplied contact index", () => {
  const contact = {
    id: "c1",
    name: "Alice",
    phone: "+237600000001",
    tags: [],
    stage: "new",
    accountId: "wa-a",
  };
  const contacts = new Proxy([contact], {
    get(target, key, receiver) {
      if (key === "map" || key === Symbol.iterator) {
        throw new Error("contacts index was rebuilt");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const result = mod.filterAndSortSidebarChats({
    chats: [
      {
        id: "chat-1",
        contactId: "c1",
        contactName: "Alice",
        lastMessage: "hello",
        unread: 0,
        updatedAt: "2026-08-12T12:00:00.000Z",
        accountId: "wa-a",
      },
    ],
    contacts,
    contactById: new Map([[contact.id, contact]]),
    query: "",
    showArchived: false,
    selfName: "",
    accountView: { type: "account", accountId: "wa-a" },
    fallbackAccountId: "wa-a",
    liveAccountId: "wa-a",
  });

  assert.equal(result.filteredChats.length, 1);
  assert.equal(result.filteredChats[0].id, "chat-1");
});

test("sidebar preview uses the newest indexed message instead of stale chat preview", () => {
  const result = mod.filterAndSortSidebarChats({
    chats: [
      {
        id: "chat-1",
        contactId: "c1",
        contactName: "Alice",
        lastMessage: "old preview",
        unread: 0,
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
    ],
    contacts: [{ id: "c1", name: "Alice", phone: "" }],
    query: "",
    showArchived: false,
    selfName: "",
    messages: [
      {
        id: "m-1",
        chatId: "chat-1",
        body: "new message",
        sentAt: "2026-08-15T12:00:00.000Z",
        direction: "in",
      },
    ],
  });

  assert.equal(result.lastBodyByChat.get("chat-1"), "new message");
});

test("unread chats sort ahead of read chats", () => {
  const result = mod.filterAndSortSidebarChats({
    chats: [
      {
        id: "read-newer",
        contactId: "c-read",
        contactName: "Read newer",
        lastMessage: "new",
        unread: 0,
        updatedAt: "2026-09-02T12:00:00.000Z",
      },
      {
        id: "unread-older",
        contactId: "c-unread",
        contactName: "Unread older",
        lastMessage: "old",
        unread: 2,
        updatedAt: "2026-09-02T10:00:00.000Z",
      },
    ],
    contacts: [
      { id: "c-read", name: "Read newer", phone: "" },
      { id: "c-unread", name: "Unread older", phone: "" },
    ],
    query: "",
    showArchived: false,
    selfName: "",
    sortMode: "unread",
  });

  assert.deepEqual(
    result.filteredChats.map((chat) => chat.id),
    ["unread-older", "read-newer"]
  );
});

test("folder chats with messages stay ahead of empty chats", async () => {
  const built = buildSync({
    entryPoints: [join(dir, "../src/components/layout/buildSidebarItems.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    alias: { "@": join(dir, "../src") },
    loader: { ".ts": "ts", ".tsx": "tsx" },
    write: false,
  });
  const folderMod = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );
  const items = folderMod.buildSidebarItems({
    listTab: "chats",
    archivedCount: 0,
    showArchived: false,
    isAllAccountsView: false,
    filteredChats: [
      { id: "empty", contactId: "c-empty", lastMessage: "", unread: 0 },
      { id: "active", contactId: "c-active", lastMessage: "有消息", unread: 0 },
    ],
    chatFolders: [
      {
        id: "folder",
        name: "新人",
        chatIds: ["empty", "active"],
        collapsed: false,
      },
    ],
    chatFolderClones: [],
    contactById: new Map(),
    ungroupedCollapsed: false,
    query: "",
    folderDisplayName: (folder) => folder.name,
  });
  assert.deepEqual(
    items.filter((item) => item.kind === "chat").map((item) => item.chat.id),
    ["active", "empty"]
  );
});

test("search only renders folders that contain matching chats", async () => {
  const built = buildSync({
    entryPoints: [join(dir, "../src/components/layout/buildSidebarItems.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    alias: { "@": join(dir, "../src") },
    loader: { ".ts": "ts", ".tsx": "tsx" },
    write: false,
  });
  const folderMod = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );
  const items = folderMod.buildSidebarItems({
    listTab: "chats",
    archivedCount: 0,
    showArchived: false,
    isAllAccountsView: false,
    filteredChats: [
      { id: "match", contactId: "c-match", lastMessage: "命中", unread: 0 },
    ],
    chatFolders: [
      { id: "hit-folder", name: "命中分组", chatIds: ["match"], collapsed: true },
      { id: "empty-folder", name: "无关分组", chatIds: ["other"], collapsed: false },
    ],
    chatFolderClones: [],
    contactById: new Map(),
    ungroupedCollapsed: false,
    query: "命中",
    folderDisplayName: (folder) => folder.name,
  });

  assert.deepEqual(
    items.filter((item) => item.kind === "folder_header").map((item) => item.name),
    ["命中分组"]
  );
  assert.deepEqual(
    items.filter((item) => item.kind === "chat").map((item) => item.chat.id),
    ["match"]
  );
  assert.equal(items.some((item) => item.kind === "new_folder"), false);
});

test("all-account ungrouped chats collapse by contact phone", async () => {
  const built = buildSync({
    entryPoints: [join(dir, "../src/components/layout/buildSidebarItems.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    alias: { "@": join(dir, "../src") },
    loader: { ".ts": "ts", ".tsx": "tsx" },
    write: false,
  });
  const folderMod = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );
  const items = folderMod.buildSidebarItems({
    listTab: "chats",
    archivedCount: 0,
    showArchived: false,
    isAllAccountsView: true,
    filteredChats: [
      { id: "chat-a", contactId: "contact-a", accountId: "account-a", lastMessage: "A", unread: 0 },
      { id: "chat-b", contactId: "contact-b", accountId: "account-b", lastMessage: "B", unread: 1 },
    ],
    chatFolders: [{ id: "folder", name: "工作", chatIds: [], collapsed: false }],
    chatFolderClones: [],
    contactById: new Map([
      ["contact-a", { id: "contact-a", name: "同一客户", phone: "+33123456789" }],
      ["contact-b", { id: "contact-b", name: "同一客户", phone: "+33123456789" }],
    ]),
    ungroupedCollapsed: false,
    query: "",
    folderDisplayName: (folder) => folder.name,
  });

  const chats = items.filter((item) => item.kind === "chat");
  assert.equal(chats.length, 1);
  assert.deepEqual(chats[0].memberChatIds, ["chat-a", "chat-b"]);
  assert.equal(chats[0].accountCount, 2);
});

test("incoming lead date headers expose batch ids and hide collapsed dates", async () => {
  const built = buildSync({
    entryPoints: [join(dir, "../src/components/layout/buildSidebarItems.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    alias: { "@": join(dir, "../src") },
    loader: { ".ts": "ts", ".tsx": "tsx" },
    write: false,
  });
  const folderMod = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );
  const items = folderMod.buildSidebarItems({
    listTab: "chats",
    archivedCount: 0,
    showArchived: false,
    isAllAccountsView: true,
    filteredChats: [
      { id: "chat-a", contactId: "contact-a", accountId: "account-a", lastMessage: "A" },
      { id: "chat-b", contactId: "contact-b", accountId: "account-b", lastMessage: "B" },
      { id: "chat-c", contactId: "contact-c", accountId: "account-a", lastMessage: "C" },
    ],
    chatFolders: [],
    chatFolderClones: [],
    contactById: new Map([
      ["contact-a", { id: "contact-a", phone: "+33123456789" }],
      ["contact-b", { id: "contact-b", phone: "+33 1 23 45 67 89" }],
      ["contact-c", { id: "contact-c", phone: "+33987654321" }],
    ]),
    ungroupedCollapsed: false,
    query: "",
    folderDisplayName: (folder) => folder.name,
    leadView: true,
    leadMergeAccounts: true,
    leadDateGroupByChatId: new Map([
      ["chat-a", { id: "2026-09-21", label: "9月21日" }],
      ["chat-b", { id: "2026-09-21", label: "9月21日" }],
      ["chat-c", { id: "2026-09-20", label: "9月20日" }],
    ]),
    collapsedLeadDateIds: new Set(["2026-09-21"]),
  });

  const headers = items.filter((item) => item.kind === "lead_date_header");
  assert.equal(headers.length, 2);
  assert.deepEqual(headers[0].chatIds, ["chat-a", "chat-b"]);
  assert.equal(headers[0].total, 1);
  assert.equal(headers[0].collapsed, true);
  assert.deepEqual(
    items.filter((item) => item.kind === "chat").map((item) => item.chat.id),
    ["chat-c"]
  );
});

test("all-account contacts keep one folder assignment across accounts", async () => {
  const built = buildSync({
    entryPoints: [join(dir, "../src/components/layout/buildSidebarItems.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    alias: { "@": join(dir, "../src") },
    loader: { ".ts": "ts", ".tsx": "tsx" },
    write: false,
  });
  const folderMod = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
  );
  const items = folderMod.buildSidebarItems({
    listTab: "chats",
    archivedCount: 0,
    showArchived: false,
    isAllAccountsView: true,
    filteredChats: [
      { id: "chat-a", contactId: "contact-a", accountId: "account-a", lastMessage: "A", unread: 0 },
      { id: "chat-b", contactId: "contact-b", accountId: "account-b", lastMessage: "B", unread: 1 },
    ],
    chatFolders: [
      { id: "folder-a", name: "A", chatIds: ["chat-a"], collapsed: false },
      { id: "folder-b", name: "B", chatIds: ["chat-b"], collapsed: false },
    ],
    chatFolderClones: [],
    contactById: new Map([
      ["contact-a", { id: "contact-a", name: "同一客户", phone: "+33123456789" }],
      ["contact-b", { id: "contact-b", name: "同一客户", phone: "+33 1 23 45 67 89" }],
    ]),
    ungroupedCollapsed: false,
    query: "",
    folderDisplayName: (folder) => folder.name,
  });

  const chats = items.filter((item) => item.kind === "chat");
  assert.equal(chats.length, 1);
  assert.equal(chats[0].folderId, "folder-a");
  assert.deepEqual(chats[0].memberChatIds, ["chat-a", "chat-b"]);
  assert.equal(chats[0].accountCount, 2);
});

test("group filters keep private chats and search results discoverable", () => {
  const direct = { id: "direct", contactId: "c1", contactName: "Alice" };
  const group = {
    id: "group",
    contactId: "g1",
    contactName: "Project group",
    isGroup: true,
    unread: 2,
    pinned: true,
  };
  const contactById = new Map([
    ["c1", { id: "c1", isGroup: false }],
    ["g1", { id: "g1", isGroup: true }],
  ]);

  const hidden = mod.filterGroupChats(
    [direct, group],
    contactById,
    "hidden",
    ""
  );
  assert.deepEqual(hidden.chats.map((chat) => chat.id), ["direct"]);
  assert.equal(hidden.hiddenCount, 1);

  const onlyGroups = mod.filterGroupChats(
    [direct, group],
    contactById,
    "only",
    ""
  );
  assert.deepEqual(onlyGroups.chats.map((chat) => chat.id), ["group"]);
  assert.equal(onlyGroups.hiddenCount, 1);

  for (const mode of ["unread", "pinned", "mentions"]) {
    const filtered = mod.filterGroupChats(
      [direct, group],
      contactById,
      mode,
      "",
      new Set(["group"])
    );
    assert.deepEqual(filtered.chats.map((chat) => chat.id), ["direct", "group"]);
  }

  const searching = mod.filterGroupChats(
    [direct, group],
    contactById,
    "hidden",
    "project"
  );
  assert.equal(searching.chats.length, 2);
  assert.equal(searching.hiddenCount, 0);

  assert.deepEqual(
    mod.countGroupChats([direct, group], contactById, new Set(["group"])),
    { all: 1, hidden: 1, only: 1, unread: 1, pinned: 1, mentions: 1 }
  );
});

test("mention filter only keeps chats with unread messages that mention me", () => {
  const chats = [
    { id: "mentioned", unread: 2 },
    { id: "old-mention", unread: 1 },
    { id: "read", unread: 0 },
  ];
  const incoming = (mentionedMe) => ({ direction: "in", mentionedMe });
  const ids = mod.findUnreadMentionedChatIds(chats, {
    mentioned: [incoming(false), incoming(true)],
    "old-mention": [incoming(true), incoming(false)],
    read: [incoming(true)],
  });

  assert.deepEqual([...ids], ["mentioned"]);
});
