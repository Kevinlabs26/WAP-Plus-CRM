import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const mocks = {
  react: "export const useRef=current=>({current});export const useEffect=fn=>{globalThis.campaignCleanup=fn();};",
  "@/store/appStore": "export const useAppStore={getState:()=>globalThis.campaignState};",
  "@/lib/baileys": `export const baileysStatus=async()=>({connection:'connected'});
    export const baileysSend=(...args)=>globalThis.campaignSend(...args);
    export const baileysSendImage=baileysSend,baileysSendSticker=baileysSend,baileysSendDocument=baileysSend;`,
  "@/lib/bridge": "export const isTauri=()=>true;export const bridgeInvoke=async()=>({});export const getBridgeStatus=async()=>({connected:true});",
  "@/lib/mediaCache": "export const readMediaCache=async()=>globalThis.campaignMedia;",
  "@/i18n": "export const translateCurrent=key=>key;",
};
const result = await build({
  stdin: { contents: `export {CampaignRunner} from './src/components/bridge/CampaignRunner.tsx';
    export {withSendGate} from './src/channels/sendGate.ts';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "campaign-io", setup(b) {
    b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path] }));
  } }],
});
const { CampaignRunner, withSendGate } = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
const settle = () => new Promise(setImmediate);

function setup(kind = "text") {
  const originals = { window: globalThis.window, FileReader: globalThis.FileReader, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  let tick;
  const sends = [];
  globalThis.window = { setInterval: fn => { tick = fn; return 1; }, clearInterval() {} };
  globalThis.fetch = async () => { throw Error("data URL fetch forbidden by production CSP"); };
  globalThis.setTimeout = (fn, ms, ...args) => ms >= 5000 ? (queueMicrotask(() => fn(...args)), 0) : originals.setTimeout(fn, ms, ...args);
  globalThis.FileReader = class {
    readAsDataURL(file) { file.arrayBuffer().then(bytes => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); }); }
  };
  globalThis.campaignMedia = `data:${kind === "image" ? "image/png" : "application/pdf"};base64,Zml4dHVyZQ==`;
  globalThis.campaignSend = async (...args) => { sends.push(args); return { ok: true, id: "protocol", jid: "12025550100@s.whatsapp.net" }; };
  let state = { hydrated: true, uiReady: true, messages: [], baileysUi: { connection: "connected" },
    settings: { sendChannel: "baileys", waAccounts: [{ id: "wa-a", status: "connected" }], liveBaileysAccountId: "wa-a", rateLimitEnabled: false, blockSendWhenOverheated: false },
    broadcastCampaigns: [{ id: "campaign", accountId: "wa-a", status: "running", extraGapSec: 5,
      media: kind === "text" ? undefined : [{ id: "media", kind, mime: kind === "image" ? "image/png" : "application/pdf" }],
      items: [{ id: "item", status: "pending", contactId: "customer", phoneE164: "+12025550100", bodyRendered: "hello" }] }],
  };
  const set = patch => { state = { ...state, ...patch }; globalThis.campaignState = state; };
  Object.assign(state, {
    ensureChatForContact: () => "chat", setBaileysLoginOpen() {}, pushToast() {},
    enqueueOutgoingMessage(input) { const id = `out-${state.messages.length}`; set({ messages: [...state.messages, { ...input, id, direction: "out", sentAt: new Date().toISOString() }] }); return id; },
    patchMessage(id, patch) { state.updateMessageDelivery(id, patch); },
    updateMessageDelivery(id, patch) { set({ messages: state.messages.map(m => m.id === id ? { ...m, ...patch } : m) }); },
    patchBroadcastItem(_id, itemId, patch) { set({ broadcastCampaigns: state.broadcastCampaigns.map(c => ({ ...c, items: c.items.map(i => i.id === itemId ? { ...i, ...patch } : i) })) }); },
    pauseBroadcastCampaign() { if (state.broadcastCampaigns[0].status === "running") state.changeStatus("paused"); },
    changeStatus(status) { set({ broadcastCampaigns: state.broadcastCampaigns.map(c => ({ ...c, status })) }); },
    completeBroadcastCampaignIfIdle() {},
  });
  globalThis.campaignState = state;
  return { sends, get: () => state, tick: () => tick(), cleanup() {
    globalThis.campaignCleanup?.();
    Object.assign(globalThis, originals);
    for (const key of ["campaignState", "campaignCleanup", "campaignMedia", "campaignSend"]) delete globalThis[key];
  } };
}

for (const kind of ["text", "image", "document"]) {
  test(`${kind}: continuing a campaign skips the delivery-unknown item`, async () => {
    const env = setup(kind);
    try {
      let attempts = 0;
      globalThis.campaignSend = async () => { attempts++; throw Object.assign(Error("发送结果未知"), { deliveryUncertain: true }); };
      CampaignRunner(); await settle();
      assert.equal(attempts, 1);
      assert.equal(env.get().broadcastCampaigns[0].status, "paused");
      assert.equal(env.get().broadcastCampaigns[0].items[0].status, "failed");
      assert.equal(env.get().messages[0].deliveryUncertain, true);
      env.get().changeStatus("running"); await env.tick(); await settle();
      assert.equal(attempts, 1);
    } finally { env.cleanup(); }
  });

  for (const status of ["cancelled", "paused"]) test(`${kind}: ${status} while waiting for the account gate blocks transmission`, async () => {
    const env = setup(kind);
    let release;
    const first = withSendGate({ accountId: "wa-a" }, { rateLimitEnabled: false, blockSendWhenOverheated: false }, () => new Promise(resolve => { release = resolve; }));
    try {
      await settle(); CampaignRunner(); await settle();
      assert.equal(env.sends.length, 0);
      env.get().changeStatus(status);
      release(); await first; await settle();
      assert.equal(env.sends.length, 0);
      assert.equal(env.get().broadcastCampaigns[0].status, status);
      assert.equal(env.get().broadcastCampaigns[0].items[0].status, status === "cancelled" ? "skipped" : "pending");
    } finally { release?.(); await first; env.cleanup(); }
  });

  if (kind !== "text") test(`${kind}: cached media sends successfully when data URL fetch is unavailable`, async () => {
    const env = setup(kind);
    try {
      CampaignRunner(); await settle();
      assert.equal(env.sends.length, 1);
      assert.equal(env.get().broadcastCampaigns[0].items[0].status, "sent");
      assert.equal(env.get().messages[0].systemKind, "broadcast_campaign");
    } finally { env.cleanup(); }
  });
}
