import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/lib/chatTranscript.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  alias: { "@": join(dir, "../src") },
  write: false,
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("chat transcript escapes content and labels both sides", () => {
  const html = mod.buildChatTranscriptHtml({
    title: "Alice & Bob",
    messages: [
      { id: "1", chatId: "c", direction: "in", body: "<hello>", sentAt: "2026-08-12T10:00:00Z" },
      { id: "2", chatId: "c", direction: "out", body: "ok", sentAt: "2026-08-12T10:01:00Z" },
    ],
  });
  assert.match(html, /Alice &amp; Bob/);
  assert.match(html, /&lt;hello&gt;/);
  assert.match(html, /<strong>我<\/strong>/);
});
