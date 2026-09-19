import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/store/broadcastSlice.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  alias: { "@": join(dir, "../src") },
  external: ["@tauri-apps/api/core"],
  write: false,
});
const { createBroadcastSlice } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

function setup() {
  let state = {
    hydrated: false,
    settings: { waAccounts: [] },
    contacts: [],
    messages: [
      {
        id: "message-1",
        chatId: "chat-1",
        direction: "out",
        body: "hello",
        sentAt: "2026-08-12T10:00:00.000Z",
        accountId: "wa-1",
        deliveryStatus: "queued",
      },
    ],
    broadcastCampaigns: [
      {
        id: "campaign-1",
        accountId: "wa-1",
        template: "hello",
        status: "running",
        createdAt: "2026-08-12T10:00:00.000Z",
        extraGapSec: 20,
        extraGapMaxSec: 30,
        items: [
          { id: "sending", status: "sending" },
          { id: "pending", status: "pending" },
          { id: "failed", status: "failed", error: "network" },
        ],
      },
    ],
  };
  const get = () => state;
  const set = (update) => {
    state = { ...state, ...(typeof update === "function" ? update(state) : update) };
  };
  const actions = createBroadcastSlice({ get, set });
  return { actions, get };
}

test("cancel keeps the in-flight item for the runner to reconcile", () => {
  const { actions, get } = setup();
  actions.cancelBroadcastCampaign("campaign-1");
  const campaign = get().broadcastCampaigns[0];
  assert.equal(campaign.status, "cancelled");
  assert.equal(campaign.items.find((item) => item.id === "sending").status, "sending");
  assert.equal(campaign.items.find((item) => item.id === "pending").status, "skipped");
});

test("removing an account freezes its queue and campaign", () => {
  const { actions, get } = setup();
  actions.retireAccountMessaging("wa-1");
  assert.equal(get().messages[0].deliveryStatus, "failed");
  assert.equal(get().messages[0].retryCount, 5);
  assert.equal(get().broadcastCampaigns[0].status, "cancelled");
  assert.equal(
    get().broadcastCampaigns[0].items.find((item) => item.id === "pending").status,
    "skipped"
  );
});

test("failed recipients only retry after the explicit action", () => {
  const { actions, get } = setup();
  assert.equal(actions.retryFailedBroadcastCampaign("campaign-1"), 1);
  const campaign = get().broadcastCampaigns[0];
  assert.equal(campaign.status, "paused");
  assert.equal(campaign.items.find((item) => item.id === "failed").status, "pending");
});

test("media campaign carries media pool and mode", () => {
  const { actions, get } = setup();
  get().contacts.push({
    id: "c-1",
    name: "张三",
    phone: "+8613800000000",
    accountId: "wa-1",
    tags: [],
    stage: "new",
  });
  const created = actions.createBroadcastCampaign({
    accountId: "wa-1",
    template: "您好 {name}",
    contactIds: ["c-1"],
    media: [
      { id: "m1", kind: "image", mime: "image/png", fileName: "a.png" },
      { id: "m2", kind: "video", mime: "video/mp4", fileName: "b.mp4" },
    ],
    mediaMode: "random",
  });
  assert.equal(created.ok, true);
  const campaign = get().broadcastCampaigns.find((c) => c.id === created.id);
  assert.equal(campaign.media.length, 2);
  assert.equal(campaign.mediaMode, "random");
  assert.equal(campaign.items.length, 1);
  assert.equal(campaign.items[0].bodyRendered, "您好 张三");
  assert.equal(campaign.media[1].kind, "video");
});
