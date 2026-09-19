import test from "node:test";
import assert from "node:assert/strict";
import { extractChatLinks } from "../src/lib/chatLinks.ts";

test("chat links are deduplicated, newest first, and trim punctuation", () => {
  const messages = [
    { id: "old", chatId: "c", direction: "in", sentAt: "2026-01-01", body: "https://example.com/a" },
    { id: "new", chatId: "c", direction: "out", sentAt: "2026-01-02", body: "看 https://openai.com/docs，和 https://example.com/a。" },
  ];
  assert.deepEqual(extractChatLinks(messages).map((link) => link.url), [
    "https://openai.com/docs",
    "https://example.com/a",
  ]);
});
