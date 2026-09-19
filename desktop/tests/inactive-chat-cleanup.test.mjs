import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/lib/inactiveChatCleanup.ts")],
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

test("inactive cleanup keeps protected chats and finds old history", () => {
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  const chats = [
    { id: "old", contactId: "c-old", lastMessage: "old", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "unread", contactId: "c-unread", lastMessage: "old", unread: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "pinned", contactId: "c-pinned", lastMessage: "old", pinned: true, updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "new", contactId: "c-new", lastMessage: "new", updatedAt: "2026-09-01T00:00:00.000Z" },
  ];

  assert.deepEqual(
    mod.findInactiveChats(chats, [{ id: "c-old" }], {
      olderThanDays: 90,
      now,
    }).map((chat) => chat.id),
    ["old"]
  );
});
