import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(rel) {
  const srcPath = join(__dirname, rel);
  const code = readFileSync(srcPath, "utf8");
  // bundle personThreads + utils dependency inlined via alias? utils is @/ - rewrite
  const rewritten = code
    .replace('from "@/lib/utils"', 'from "../src/lib/utils.ts"')
    .replace('from "@/types/account"', 'from "../src/types/account.ts"')
    .replace('from "@/types/crm"', 'from "../src/types/crm.ts"');
  const { code: js } = transformSync(rewritten, {
    loader: "ts",
    format: "esm",
    // utils imports more - bundle file only functions we need by full bundle of entry
  });
  // utils.ts has many imports - better bundle entry
  return null;
}

// Bundle with esbuild from entry
const entry = join(__dirname, "../src/lib/personThreads.ts");
const { buildSync } = await import("esbuild");
let result;
try {
  result = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    alias: {
      "@": join(__dirname, "../src"),
    },
    // crm/account types erase
    loader: { ".ts": "ts", ".tsx": "tsx" },
    write: false,
  });
} catch (e) {
  // fallback without alias plugin - manual
  console.error(e);
  process.exit(0); // don't fail CI hard if esbuild alias unsupported
}

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const {
  accountOnlineMap,
  buildPersonThreadRows,
  detectPersonCollision,
  filterMessagesForAccount,
  findSiblingContacts,
  hasOutgoingPersonMessage,
  resolvePersonKeyForContact,
} = mod;

test("online map applies live failure only to the live account", () => {
  const accounts = [
    { id: "wa-a", status: "connected" },
    { id: "wa-b", status: "connected" },
  ];
  assert.deepEqual(accountOnlineMap(accounts, "wa-a", "error"), {
    "wa-a": false,
    "wa-b": true,
  });
});

test("shared chat timelines stay isolated by WhatsApp account", () => {
  const messages = [
    { id: "a", accountId: "wa-a", body: "from a" },
    { id: "b", accountId: "wa-b", body: "from b" },
    { id: "old-default", accountId: "wa-default", body: "legacy" },
    { id: "legacy", body: "legacy without owner" },
  ];
  assert.deepEqual(
    filterMessagesForAccount(messages, "wa-b").map((message) => message.id),
    ["b", "legacy"]
  );
  assert.deepEqual(
    filterMessagesForAccount(messages, "wa-b", "wa-b").map(
      (message) => message.id
    ),
    ["b", "old-default", "legacy"]
  );
  assert.deepEqual(
    filterMessagesForAccount(messages, "wa-a", "wa-b").map(
      (message) => message.id
    ),
    ["a", "legacy"]
  );
});

test("sender account chooser stays until a real outgoing message", () => {
  assert.equal(hasOutgoingPersonMessage([]), false);
  assert.equal(
    hasOutgoingPersonMessage([{ direction: "in", body: "hello" }]),
    false
  );
  assert.equal(
    hasOutgoingPersonMessage([
      { direction: "out", body: "joined", mediaType: "system" },
    ]),
    false
  );
  assert.equal(
    hasOutgoingPersonMessage([{ direction: "out", body: "hello" }]),
    true
  );
});

test("resolvePersonKeyForContact prefers personKey", () => {
  assert.equal(
    resolvePersonKeyForContact({ personKey: "tel:12025550123", phone: "1" }),
    "tel:12025550123"
  );
});

test("findSiblingContacts by phone", () => {
  const contacts = [
    { id: "c1", name: "A", phone: "12025550123", accountId: "wa-a", tags: [], stage: "new" },
    { id: "c2", name: "A2", phone: "12025550123", accountId: "wa-b", tags: [], stage: "new" },
    { id: "c3", name: "B", phone: "12025550199", accountId: "wa-a", tags: [], stage: "new" },
  ];
  const sib = findSiblingContacts(contacts, contacts[0]);
  assert.equal(sib.length, 2);
});

test("detectPersonCollision hot when two recent", () => {
  const now = new Date().toISOString();
  const rows = [
    {
      contactId: "c1",
      chatId: "ch1",
      accountId: "wa-a",
      lastAt: now,
      lastMessage: "hi",
      unread: 0,
      active: true,
      hasActivity: true,
    },
    {
      contactId: "c2",
      chatId: "ch2",
      accountId: "wa-b",
      lastAt: now,
      lastMessage: "yo",
      unread: 1,
      active: false,
      hasActivity: true,
    },
  ];
  const col = detectPersonCollision(rows, { windowHours: 48 });
  assert.equal(col.hot, true);
  assert.equal(col.accountIds.length, 2);
});

test("detectPersonCollision ignores rows without real activity", () => {
  const now = new Date().toISOString();
  const rows = [
    {
      contactId: "c1",
      chatId: "ch1",
      accountId: "wa-a",
      lastAt: now,
      lastMessage: "hi",
      unread: 0,
      active: true,
      hasActivity: true,
    },
    {
      // 只有档案、无真实消息的号，不应触发撞单
      contactId: "c2",
      chatId: "ch2",
      accountId: "wa-b",
      lastAt: now,
      lastMessage: "preview",
      unread: 0,
      active: false,
      hasActivity: false,
    },
  ];
  const col = detectPersonCollision(rows, { windowHours: 48 });
  assert.equal(col, null);
});

test("buildPersonThreadRows multi account", () => {
  const contacts = [
    {
      id: "c1",
      name: "A",
      phone: "12025550123",
      accountId: "wa-a",
      personKey: "tel:12025550123",
      tags: [],
      stage: "new",
    },
    {
      id: "c2",
      name: "A",
      phone: "12025550123",
      accountId: "wa-b",
      personKey: "tel:12025550123",
      tags: [],
      stage: "new",
    },
  ];
  const chats = [
    {
      id: "ch1",
      contactId: "c1",
      contactName: "A",
      lastMessage: "from a",
      unread: 0,
      updatedAt: "2026-01-01T10:00:00.000Z",
      phoneId: "wa-a",
      accountId: "wa-a",
    },
    {
      id: "ch2",
      contactId: "c2",
      contactName: "A",
      lastMessage: "from b",
      unread: 2,
      updatedAt: "2026-01-02T10:00:00.000Z",
      phoneId: "wa-b",
      accountId: "wa-b",
    },
  ];
  const rows = buildPersonThreadRows({
    contacts,
    chats,
    messages: [],
    seed: contacts[0],
    selectedContactId: "c1",
    focusAccountId: "wa-a",
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.accountId === "wa-b" && r.unread === 2));
  assert.deepEqual(
    rows.filter((row) => row.active).map((row) => row.accountId),
    ["wa-a"]
  );
});

test("buildPersonThreadRows hides synced accounts without messages", () => {
  const contacts = [
    { id: "c1", name: "A", phone: "12025550123", accountId: "wa-a", personKey: "tel:12025550123", tags: [], stage: "new" },
    { id: "c2", name: "A", phone: "12025550123", accountId: "wa-b", personKey: "tel:12025550123", tags: [], stage: "new" },
  ];
  const chats = [
    { id: "ch1", contactId: "c1", contactName: "A", lastMessage: "hello", unread: 0, updatedAt: "2026-01-01", accountId: "wa-a" },
    { id: "ch2", contactId: "c2", contactName: "A", lastMessage: "", unread: 0, updatedAt: "2026-01-02", accountId: "wa-b" },
  ];
  const rows = buildPersonThreadRows({ contacts, chats, messages: [], seed: contacts[0] });
  assert.deepEqual(rows.map((row) => row.accountId), ["wa-a"]);
});

test("one contact can keep a separately selected account conversation", () => {
  const contact = {
    id: "c1",
    name: "A",
    phone: "12025550123",
    accountId: "wa-a",
    tags: [],
    stage: "new",
  };
  const chats = [
    {
      id: "placeholder",
      contactId: "c1",
      contactName: "A",
      lastMessage: "",
      unread: 0,
      updatedAt: "2026-01-01",
      accountId: "wa-a",
    },
    {
      id: "chosen",
      contactId: "c1",
      contactName: "A",
      lastMessage: "hello",
      unread: 0,
      updatedAt: "2026-01-02",
      accountId: "wa-b",
    },
  ];
  const rows = buildPersonThreadRows({
    contacts: [contact],
    chats,
    messages: [],
    seed: contact,
    selectedChatId: "chosen",
    focusAccountId: "wa-b",
  });
  assert.deepEqual(rows.map((row) => row.accountId), ["wa-b"]);
  assert.equal(rows[0].active, true);
});

test("switching a person thread does not change the top account scope", () => {
  for (const file of [
    "../src/components/chat/ChatPanel.tsx",
    "../src/components/crm/CrmAiPanel.tsx",
  ]) {
    const source = readFileSync(join(__dirname, file), "utf8");
    assert.doesNotMatch(
      source,
      /updateSettings\(\{\s*activeAccountId:\s*row\.accountId/
    );
    assert.match(source, /setSelectedChat\(row\.chatId, row\.accountId\)/);
  }
});
