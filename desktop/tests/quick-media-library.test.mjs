import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { emitQuickReplyMedia, onQuickReplyMedia, quickReplyMediaToFile } from "../src/lib/quickReplyMedia.ts";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/quickMediaLibrary.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "storage", setup(build) {
    build.onResolve({ filter: /^\.\/idb$/ }, () => ({ path: "db", namespace: "mock" }));
    build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: `
      const db = new Map();
      export const idbGet = async key => db.get(key);
      export const idbEntriesPrefix = async prefix => [...db].filter(([key]) => key.startsWith(prefix));
      export const idbSet = async (key, value, related) => { db.set(key,value); for(const row of related) db.set(row.key,row.value); };
      export const idbDel = async (key, related) => { db.delete(key); for(const entry of related) db.delete(entry); };
      export const idbDelPrefix = async prefix => { for (const key of db.keys()) if (key.startsWith(prefix)) db.delete(key); };
    ` }));
  } }],
});
const media = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

test("media shelf stores original audio once and deletes its entry and file", async () => {
  const window = new EventTarget();
  const previous = { window: globalThis.window, document: globalThis.document, HTMLVideoElement: globalThis.HTMLVideoElement };
  globalThis.window = window;
  globalThis.HTMLVideoElement = class {};
  globalThis.document = { createElement: () => ({
    duration: 25,
    set src(_) { queueMicrotask(() => this.onloadedmetadata?.()); },
    removeAttribute() {}, load() {},
  }) };
  try {
    const file = new File(["original audio"], "voice.ogg", { type: "audio/ogg" });
    assert.equal(await media.addQuickMedia(file), true);
    assert.equal(await media.addQuickMedia(new File([file], "duplicate.ogg", { type: "audio/ogg" })), false);
    const [item] = await media.listQuickMedia();
    assert.equal(item.kind, "audio");
    assert.equal(item.duration, 25);
    assert.equal((await media.readQuickMedia(item)).name, "voice.ogg");
    assert.equal(await (await media.readQuickMedia(item)).text(), "original audio");
    await media.removeQuickMedia(item.id);
    assert.deepEqual(await media.listQuickMedia(), []);
    await assert.rejects(media.readQuickMedia(item), /unavailable/);
  } finally { Object.assign(globalThis, previous); }
});

test("saved media is passed as a file to the addressed draft staging listener", () => {
  const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
  let staged;
  const stop = onQuickReplyMedia(selection => {
    if (selection.chatId !== "selected") return false;
    staged = quickReplyMediaToFile(selection);
    return true;
  });
  try {
    const clip = { file, dataUrl:"", fileName:file.name, mimeType:file.type, kind:"video", token:"id", target:"main" };
    assert.equal(emitQuickReplyMedia({ ...clip, chatId:"other" }), false);
    assert.equal(emitQuickReplyMedia({ ...clip, chatId:"selected" }), true);
    assert.equal(staged, file);
  } finally { stop(); }
});

test("generic Windows MIME does not block video import and size failures are distinct", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLVideoElement: globalThis.HTMLVideoElement };
  globalThis.window = new EventTarget();
  globalThis.HTMLVideoElement = class {};
  globalThis.document = { createElement: () => ({
    duration: 42,
    set src(_) { queueMicrotask(() => this.onloadeddata?.()); },
    removeAttribute() {}, load() {},
  }) };
  try {
    const file = new File(["fixture video"], "meeting.MP4", { type: "application/octet-stream" });
    assert.equal(await media.addQuickMedia(file), true);
    const [item] = await media.listQuickMedia();
    assert.equal(item.kind, "video");
    assert.equal(item.mime, "video/mp4");
    assert.equal(item.duration, 42);
    assert.equal(await (await media.readQuickMedia(item)).text(), "fixture video");
    await media.addQuickMedia(new File(["another video"], "another.webm"));
    await media.removeQuickMediaBatch([item.id, item.id]);
    assert.deepEqual((await media.listQuickMedia()).map(entry => entry.title), ["another.webm"]);
    await assert.rejects(media.readQuickMedia(item), /unavailable/);
    const [remaining] = await media.listQuickMedia();
    await media.clearQuickMedia();
    assert.deepEqual(await media.listQuickMedia(), []);
    await assert.rejects(media.readQuickMedia(remaining), /unavailable/);
    assert.equal(media.QUICK_MEDIA_MAX_BYTES, 100 * 1024 * 1024);
    await assert.rejects(media.addQuickMedia({ name: "too-big.mp4", type: "", size: media.QUICK_MEDIA_MAX_BYTES + 1 }), /quickMedia\.fileTooLarge/);
    await assert.rejects(media.addQuickMedia(new File([], "empty.mp4")), /quickMedia\.emptyFile/);
    await assert.rejects(media.addQuickMedia(new File(["unknown"], "unknown.bin")), /quickMedia\.unsupportedFile/);
  } finally { Object.assign(globalThis, previous); }
});
