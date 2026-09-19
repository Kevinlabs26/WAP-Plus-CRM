import assert from "node:assert/strict";
import { copyImageToClipboard } from "../src/components/chat/messageMediaUtils.ts";

const originalFetch = globalThis.fetch;
const originalClipboard = navigator.clipboard;
const originalClipboardItem = globalThis.ClipboardItem;
let written;

globalThis.fetch = async () =>
  new Response(new Blob(["png"], { type: "image/png" }), { status: 200 });
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { write: async (items) => { written = items; } },
});
globalThis.ClipboardItem = class {
  constructor(data) {
    this.data = data;
  }
};

await copyImageToClipboard("data:image/png;base64,cG5n");
assert.equal(written.length, 1);
assert.equal(written[0].data["image/png"].type, "image/png");

globalThis.fetch = originalFetch;
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: originalClipboard,
});
globalThis.ClipboardItem = originalClipboardItem;

console.log("mediaClipboard ok");
