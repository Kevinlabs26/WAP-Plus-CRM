import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const built = await build({
  stdin: {
    contents: `export { notificationAvatar, notificationImageBytes } from './src/lib/notificationAvatar.ts';
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
const { notificationAvatar, notificationImageBytes, notifyInboundMessages } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

test("PNG bytes reach the native boundary even when CSP blocks every fetch", () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Blocked by production CSP"); };
  try {
    assert.deepEqual(notificationImageBytes("data:image/png;base64,iVBORw0KGgo="), [137, 80, 78, 71, 13, 10, 26, 10]);
    for (const invalid of [undefined, "https://example.com/avatar.png", "blob:example",
      "data:image/png;base64,broken", "data:image/png;base64,AAAA",
      "data:image/png;base64," + "A".repeat(684_000)]) {
      assert.equal(notificationImageBytes(invalid), undefined);
    }
  } finally { globalThis.fetch = previousFetch; }
});

test("the full desktop notifier passes PNG bytes to Windows under a blocked-fetch policy", async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/desktopNotify.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "esm",
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    plugins: [{ name: "native-notification-boundary", setup(b) {
      b.onResolve({ filter: /^@tauri-apps\/(api\/(core|event)|plugin-notification)$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
        args.path.endsWith("/core") ? `export const invoke = async (command, options) => { globalThis.nativeCalls.push({command, options}); return true; };`
        : args.path.endsWith("/event") ? `export const listen = async () => () => {};`
        : `export const isPermissionGranted = async () => true; export const sendNotification = () => { throw Error('Unexpected fallback'); };`,
      }));
    } }],
  });
  const { showDesktopNotify } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  const originals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, nativeCalls: globalThis.nativeCalls };
  globalThis.window = { __TAURI_INTERNALS__: {} };
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }),
    toDataURL: () => "data:image/png;base64,iVBORw0KGgo=" }) };
  globalThis.fetch = () => { throw Error("Blocked by production CSP"); };
  globalThis.nativeCalls = [];
  try {
    assert.equal(await showDesktopNotify({ title: "Alice", avatarName: "Alice", tag: "chat-a" }), true);
    assert.equal(globalThis.nativeCalls[0].command, "show_windows_branded_notification");
    assert.deepEqual(globalThis.nativeCalls[0].options.avatarBytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(globalThis.nativeCalls[0].options.tag, "chat-a");
    assert.equal(await showDesktopNotify({ title: "新消息" }), true);
    assert.equal(globalThis.nativeCalls[1].options.avatarBytes, undefined);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

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
