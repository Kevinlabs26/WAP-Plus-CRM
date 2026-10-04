import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const built = await build({
  stdin: {
    contents: `export { notificationAvatar } from './src/lib/notificationAvatar.ts';
      export { notifyInboundMessages } from './src/lib/inboundMessageNotify.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true, write: false, platform: "browser", format: "esm",
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "record-notification", setup(b) {
    b.onResolve({ filter: /^@\/lib\/desktopNotify$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
      contents: `export const showDesktopNotify = options => { globalThis.notified.push(options); return Promise.resolve(true); };`,
    }));
  } }],
});
const { notificationAvatar, notifyInboundMessages } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

test("notification avatars normalize cached formats, crop centrally, and fall back without remote requests", async () => {
  const originals = { document: globalThis.document, Image: globalThis.Image };
  const draws = [], labels = [], sources = [];
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const context = { drawImage: (...args) => draws.push(args), fillRect() {},
    fillText: text => labels.push(text) };
  globalThis.document = { createElement: () => ({ getContext: () => context,
    toDataURL: type => { assert.equal(type, "image/png"); return png; } }) };
  globalThis.Image = class {
    naturalWidth = 240; naturalHeight = 120;
    set src(value) {
      sources.push(value);
      queueMicrotask(() => value.includes("broken") ? this.onerror?.() : this.onload?.());
    }
  };
  try {
    assert.equal(await notificationAvatar("data:image/webp;base64,AAAA", "Alice"), png);
    assert.deepEqual(draws[0].slice(1), [60, 0, 120, 120, 0, 0, 96, 96]);
    // A cached large image previously discarded by the 512KB native limit now becomes a thumbnail.
    assert.equal(await notificationAvatar("data:image/jpeg;base64," + "A".repeat(700_000), "Bob"), png);
    assert.equal(await notificationAvatar("data:image/png;base64,broken", "陈先生"), png);
    assert.equal(labels.at(-1), "陈");
    const sourceCount = sources.length;
    assert.equal(await notificationAvatar("https://example.com/avatar.jpg", "Alice"), png);
    assert.equal(sources.length, sourceCount);
    assert.equal(await notificationAvatar("data:image/svg+xml;base64,AAAA"), undefined);
    assert.equal(await notificationAvatar("data:image/png;base64," + "A".repeat(4_800_000)), undefined);
    assert.equal(await notificationAvatar(), undefined);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test("incoming notifications preserve contact identity except in hidden mode, and muted chats stay quiet", () => {
  const originals = { document: globalThis.document, notified: globalThis.notified };
  globalThis.document = { hasFocus: () => false, hidden: false };
  globalThis.notified = [];
  const handlers = { enabled: true, selectedChatId: null, mutedUntilByChatId: {},
    groupMessagesEnabled: true, openChat() {} };
  try {
    for (const privacy of ["full", "name", "hidden"]) {
      notifyInboundMessages([{ messageId: privacy, chatId: "test-chat", contactName: "Alice",
        avatarUrl: "data:image/webp;base64,AAAA", body: "Private text" }], { ...handlers, privacy });
    }
    assert.equal(globalThis.notified[0].avatarName, "Alice");
    assert.equal(globalThis.notified[0].avatarUrl, "data:image/webp;base64,AAAA");
    assert.equal(globalThis.notified[1].avatarName, "Alice");
    assert.equal(globalThis.notified[1].body, "收到新消息");
    assert.equal(globalThis.notified[2].avatarName, undefined);
    assert.equal(globalThis.notified[2].avatarUrl, undefined);
    assert.equal(globalThis.notified[2].title, "新消息");
    notifyInboundMessages([{ messageId: "muted", chatId: "muted-chat", contactName: "Alice", body: "Quiet" }],
      { ...handlers, mutedUntilByChatId: { "muted-chat": Date.now() + 60_000 } });
    assert.equal(globalThis.notified.length, 3);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
