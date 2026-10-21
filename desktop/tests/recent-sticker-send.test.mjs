import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: "export const useRef=current=>({current});",
  "@/store/appStore": "export const useAppStore={getState:()=>({draftReply:''})};",
  "./sendImageMessage": "export const sendImageMessage=async(file,sticker)=>{globalThis.sentSticker={file,sticker};return true;};",
  "./sendFileMessage": "export const sendFileMessage=async()=>true;",
  "./sendAudioMessage": "export const sendAudioMessage=async()=>true;",
  "./sendGifMessage": "export const sendGifMessage=async()=>true;",
};
const result = await build({ entryPoints: [fileURLToPath(new URL("../src/components/chat/useMediaSend.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser", alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "sticker-io", setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path] }));
  } }],
});
const { useMediaSend } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
test("recent stickers reuse cached bytes without fetching a data URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("production CSP forbids data URL fetch");
  try {
    const media = useMediaSend({ guardBlockedSend: () => true, pushToast: assert.fail });
    await media.sendRecentSticker("data:image/webp;base64,SGVsbG8=");
    assert.equal(globalThis.sentSticker.sticker, true);
    assert.equal(globalThis.sentSticker.file.type, "image/webp");
    assert.equal(await globalThis.sentSticker.file.text(), "Hello");
  } finally { globalThis.fetch = originalFetch; delete globalThis.sentSticker; }
});
