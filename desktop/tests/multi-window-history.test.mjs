import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: "export const useCallback=fn=>fn;export const useRef=current=>({current});export const useState=initial=>[initial,fn=>{globalThis.multiHistory=fn(globalThis.multiHistory||initial);}];",
  "@/store/appStore": "export const useAppStore={getState:()=>globalThis.multiState,setState:fn=>{globalThis.multiState={...globalThis.multiState,...fn(globalThis.multiState)};}};",
  "@/lib/storage": "export const loadMessagesPage=opts=>globalThis.multiLoad(opts);",
};
const result = await build({ entryPoints: [fileURLToPath(new URL("../src/features/multiWindow/hooks/useMultiWindowHistory.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser", alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "history-io", setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path] }));
  } }],
});
const { useMultiWindowHistory } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
const message = (id, time, extra = {}) => ({ id, chatId: "chat", accountId: "wa-a", body: id, sentAt: `2026-10-01T${time}:00Z`, ...extra });

test("multi-window paging crosses duplicate aliases with a disk cursor and continues on the next request", async () => {
  const warm = message("warm", "12:00", { waMessageId: "protocol" });
  globalThis.multiState = { messages: [warm], messagesByChatId: { chat: [warm] } };
  globalThis.multiHistory = {};
  const cursors = [], pages = [
    { items: [message("alias", "11:00", { waMessageId: "protocol" })], limit: 1 },
    { items: [message("older", "10:00")], limit: 1 },
    { items: [message("oldest", "09:00")], limit: 40 },
  ];
  globalThis.multiLoad = async opts => { cursors.push(opts.beforeId); return { ok: true, total: 100, ...pages.shift() }; };
  try {
    const history = useMultiWindowHistory({ getMessages: () => [warm] });
    assert.equal(await history.loadOlder("chat"), 1);
    assert.equal(await history.loadOlder("chat"), 1);
    assert.deepEqual(cursors, ["warm", "alias", "older"]);
    assert.equal(globalThis.multiHistory.chat.hasMore, false);
    assert.deepEqual(globalThis.multiState.messages.map(m => m.id), ["oldest", "older", "warm"]);
  } finally { for (const key of ["multiState", "multiHistory", "multiLoad"]) delete globalThis[key]; }
});

test("multi-window read failures remain retryable and concurrent requests are suppressed", async () => {
  globalThis.multiState = { messages: [], messagesByChatId: {} }; globalThis.multiHistory = {};
  let reject, reads = 0;
  globalThis.multiLoad = () => { reads++; return new Promise((_, fail) => { reject = fail; }); };
  try {
    const history = useMultiWindowHistory({ getMessages: () => [] });
    const first = history.loadOlder("chat");
    assert.equal(await history.loadOlder("chat"), 0); assert.equal(reads, 1);
    reject(Error("disk busy")); assert.equal(await first, 0); assert.equal(globalThis.multiHistory.chat.hasMore, true);
    globalThis.multiLoad = async () => ({ ok: true, items: [], total: 0, limit: 40 });
    assert.equal(await history.loadOlder("chat"), 0); assert.equal(globalThis.multiHistory.chat.hasMore, false);
  } finally { for (const key of ["multiState", "multiHistory", "multiLoad"]) delete globalThis[key]; }
});
