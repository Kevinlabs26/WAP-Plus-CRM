import assert from "node:assert/strict";
import { copyImageToClipboard } from "../src/components/chat/messageMediaUtils.ts";

const originalFetch = globalThis.fetch;
const originalClipboard = navigator.clipboard;
const originalClipboardItem = globalThis.ClipboardItem;
const originalWindow = globalThis.window;
const originalFileReader = globalThis.FileReader;
const originalImage = globalThis.Image;
const originalDocument = globalThis.document;
let written;
let sourceUrl;
let loadError = false;
let width = 1;
let height = 1;

globalThis.fetch = async () => { throw new TypeError("Failed to fetch: CSP connect-src"); };
globalThis.Image = class {
  get naturalWidth() { return width; }
  get naturalHeight() { return height; }
  set src(url) {
    sourceUrl = url;
    queueMicrotask(() => loadError ? this.onerror() : this.onload());
  }
  removeAttribute() {}
};
globalThis.document = {
  createElement: (tag) => {
    assert.equal(tag, "canvas");
    return {
      getContext: () => ({ drawImage: (source) => {
        assert.equal(source.crossOrigin, "anonymous");
      } }),
      toBlob: (callback, mime) => callback(new Blob(["png"], { type: mime })),
    };
  },
};
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
assert.equal(sourceUrl, "data:image/png;base64,cG5n");
await copyImageToClipboard("blob:cached-image");
assert.equal(sourceUrl, "blob:cached-image");

let nativeCopy;
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => { nativeCopy = { command, args }; },
  },
};
globalThis.FileReader = class {
  async readAsDataURL(blob) {
    this.result = `data:image/png;base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    this.onload();
  }
};
await copyImageToClipboard("data:image/png;base64,cG5n");
assert.equal(nativeCopy.command, "clipboard_write_image");
assert.equal(nativeCopy.args.pngBase64, Buffer.from("png").toString("base64"));

loadError = true;
await assert.rejects(copyImageToClipboard("data:image/png;base64,broken"), /图片读取失败/);
loadError = false;
width = 4001;
height = 4000;
await assert.rejects(copyImageToClipboard("blob:oversized-image"), /1600 万像素/);

globalThis.fetch = originalFetch;
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: originalClipboard,
});
globalThis.ClipboardItem = originalClipboardItem;
if (originalWindow === undefined) delete globalThis.window;
else globalThis.window = originalWindow;
globalThis.FileReader = originalFileReader;
if (originalImage === undefined) delete globalThis.Image;
else globalThis.Image = originalImage;
if (originalDocument === undefined) delete globalThis.document;
else globalThis.document = originalDocument;

console.log("mediaClipboard ok");
