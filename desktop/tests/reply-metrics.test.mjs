import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/core.ts";

const dir = fileURLToPath(new URL("../", import.meta.url));
const mocks = {
  react: "export const useMemo = (fn) => fn(); export const useState = (initial) => [initial === 'all' ? (globalThis.__replyMetricsScope || initial) : initial, () => {}];",
  "@/store/appStore": "export const useAppStore = (selector) => selector(globalThis.__replyMetricsState);",
  "@/i18n": "export const useI18n = () => ({ t: (key) => key });",
  "@/components/ui/primitives": "export const SectionLabel = () => null;",
  "lucide-react": "export const ChevronDown = () => null; export const ChevronRight = () => null;",
};
const built = await build({
  stdin: {
    contents: `export { calcStats } from './src/store/calcStats.ts';
      export { buildPendingChatIds, buildLastMessageDirectionByChatId } from './src/features/multiWindow/lib/selectors.ts';
      export { filterAndSortSidebarChats } from './src/components/layout/chatSidebarUtils.ts';
      export { StatsView } from './src/components/views/StatsView.tsx';`,
    resolveDir: dir,
  },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  alias: { "@": fileURLToPath(new URL("../src/", import.meta.url)) },
  plugins: [{ name: "reply-metrics-view-mocks", setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.path === "react" && !args.importer.endsWith("StatsView.tsx")) return;
      return mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path] }));
  } }],
});
const { calcStats, buildPendingChatIds, buildLastMessageDirectionByChatId, filterAndSortSidebarChats, StatsView } =
  await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

const at = "2026-10-04T10:00:00Z";
const chat = (id, extra = {}) => ({ id, contactId: id, contactName: id, lastMessage: "customer message",
  lastMessageDirection: "in", updatedAt: at, unread: 0, accountId: "a", ...extra });
const chats = [
  chat("read-pending"),
  chat("handled", { unread: 2, replyHandledAt: "2026-10-04T10:01:00Z" }),
  chat("queued", { lastMessageDirection: "out", replyPendingSince: at }),
  chat("b-pending", { accountId: "b", unread: 1 }),
  chat("replied", { accountId: "b", unread: 4, lastMessageDirection: "out" }),
  chat("archived", { unread: 1, archived: true }),
  chat("local", { accountId: undefined, unread: 1, localOnly: true }),
  chat("contact-account", { accountId: undefined }),
  chat("unknown", { unread: 1, lastMessageDirection: undefined }),
  chat("cleared", { unread: 1, replyPendingSince: "" }),
];
const contacts = [{ id: "contact-account", name: "customer", phone: "+33123456789", accountId: "b", tags: [], stage: "new" }];

test("stats count awaiting replies independently per account and retain legacy unread totals", () => {
  const stats = calcStats(chats, [], contacts);
  assert.equal(stats.awaitingReplyChats, 4);
  assert.equal(stats.pendingReplyChats, 7);
  assert.equal(stats.pendingReplies, 11);
  const rows = new Map(stats.byAccount.map((row) => [row.accountId, row]));
  assert.equal(rows.get("a").awaitingReplyChats, 2);
  assert.equal(rows.get("b").awaitingReplyChats, 2);
  assert.equal(rows.get("wa-default").awaitingReplyChats, 0);
  assert.equal(stats.byAccount.reduce((sum, row) => sum + row.awaitingReplyChats, 0), stats.awaitingReplyChats);
});

test("multi-window and sidebar awaiting filters include read/queued tasks and exclude handled/archived/local tasks", () => {
  const expected = ["b-pending", "contact-account", "queued", "read-pending"];
  const pendingIds = buildPendingChatIds(chats, new Map());
  assert.deepEqual([...pendingIds].sort(), expected);
  const opts = { chats, contacts, query: "", showArchived: false, selfName: "" };
  const awaiting = filterAndSortSidebarChats({ ...opts, listFilter: "awaiting" });
  assert.deepEqual(awaiting.filteredChats.map((item) => item.id).sort(), expected);
  const unread = filterAndSortSidebarChats({ ...opts, listFilter: "unread" });
  assert.equal(unread.filteredChats.some((item) => item.id === "replied"), true);
  assert.equal(unread.filteredChats.some((item) => item.id === "read-pending"), false);
});

test("multi-window legacy previews fall back to actual message direction rather than unread state", () => {
  const legacy = [chat("in-history", { lastMessageDirection: undefined }), chat("out-history", { lastMessageDirection: undefined, unread: 2 })];
  const directions = buildLastMessageDirectionByChatId([
    { chatId: "in-history", sentAt: at, direction: "in" },
    { chatId: "out-history", sentAt: at, direction: "out" },
    { chatId: "in-history", sentAt: "2026-10-04T10:02:00Z", direction: "out", systemKind: "system" },
  ]);
  assert.deepEqual([...buildPendingChatIds(legacy, directions)], ["in-history"]);
});

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node?.props) return [];
  return [node, ...elements(node.props.children)];
}

test("stats awaiting card renders the awaiting total and navigates to the corresponding account filter", () => {
  const calls = [];
  globalThis.__replyMetricsState = {
    stats: calcStats(chats, [], contacts), contacts, messages: [],
    settings: { waAccounts: [{ id: "a", label: "1" }, { id: "b", label: "2" }] },
    setActiveNav() {}, updateSettings: (patch) => calls.push(patch), goToChats: (filter) => calls.push(filter),
  };
  try {
    const tree = elements(StatsView());
    const card = tree.find((node) => node.type === "button" && elements(node).some((child) => child.props.children === "stats.awaitingReply"));
    assert.ok(card);
    assert.equal(elements(card).some((node) => node.props.children === 4), true);
    card.props.onClick();
    assert.deepEqual(calls, [{ accountViewMode: { type: "all" } }, "awaiting"]);
    assert.equal(tree.some((node) => node.type === "th" && node.props.children === "stats.pendingReply"), true);
    calls.length = 0;
    globalThis.__replyMetricsScope = "b";
    const scopedCard = elements(StatsView()).find((node) => node.type === "button" && elements(node).some((child) => child.props.children === "stats.awaitingReply"));
    assert.equal(elements(scopedCard).some((node) => node.props.children === 2), true);
    scopedCard.props.onClick();
    assert.deepEqual(calls, [{ accountViewMode: { type: "account", accountId: "b" } }, "awaiting"]);
  } finally {
    delete globalThis.__replyMetricsState;
    delete globalThis.__replyMetricsScope;
  }
});

test("unread filter labels remain distinct from awaiting replies in every supported language", () => {
  assert.equal(translate("zh-CN", "sidebar.filterUnread", { count: 2 }), "筛选中：未读 · 2 个会话");
  assert.equal(translate("en", "sidebar.filterUnread", { count: 2 }), "Filter: unread · 2 chats");
  assert.equal(translate("fr", "sidebar.filterUnread", { count: 2 }), "Filtre : non lus · 2 discussions");
});
