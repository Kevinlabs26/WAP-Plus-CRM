import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [join(dir, "../src/store/broadcastSlice.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  alias: { "@": join(dir, "../src") },
  external: ["@tauri-apps/api/core"],
  write: false,
  plugins:[{name:'broadcast-ui-boundary',setup(b){b.onResolve({filter:/^@\/i18n$/},()=>({path:'i18n',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const translateCurrent=(k,p)=>k+JSON.stringify(p||{});'}));}}],
});
const { createBroadcastSlice } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=broadcast-slice-test.js').toString("base64")}`
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

test("account removal or replacement retires scheduled plan targets without adopting the replacement identity", () => {
  const {actions,get}=setup();
  get().settings.scheduledPlans=[{id:'plan',status:'running',items:[
    {id:'sent',accountId:'wa-1',status:'sent'},
    {id:'inflight',accountId:'wa-1',status:'sending'},
    {id:'pending',accountId:'wa-1',status:'pending'},
    {id:'other',accountId:'wa-2',status:'pending'},
  ]}];
  actions.retireAccountMessaging('wa-1');
  const plan=get().settings.scheduledPlans[0];assert.equal(plan.status,'paused');
  assert.deepEqual(plan.items.map(item=>item.status),['sent','cancelled','cancelled','pending']);
  assert.equal(plan.items[1].retired,true);assert.equal(plan.items[2].retired,true);
  assert.equal(plan.items[3].retired,undefined);
});

test("failed recipients only retry after the explicit action", () => {
  const { actions, get } = setup();
  get().broadcastCampaigns[0].status="paused";get().broadcastCampaigns[0].items[0].status="sent";
  assert.equal(actions.retryFailedBroadcastCampaign("campaign-1"), 1);
  const campaign = get().broadcastCampaigns[0];
  assert.equal(campaign.status, "paused");
  assert.equal(campaign.items.find((item) => item.id === "failed").status, "pending");
});

test('unknown results require one reviewed selection and confirmed receipts cannot be retried',()=>{
 const {actions,get}=setup();const c=get().broadcastCampaigns[0];c.status='paused';c.items=[{id:'known',status:'failed',error:'rejected'},{id:'unknown',status:'failed',error:'发送结果未知'},{id:'confirmed',status:'failed',messageId:'confirmed'}];
 get().messages.push({id:'confirmed',direction:'out',deliveryStatus:'delivered'});
 assert.equal(actions.retryFailedBroadcastCampaign(c.id,['known','unknown','confirmed']),1);
 assert.equal(get().broadcastCampaigns[0].items[1].status,'failed');
 assert.equal(actions.retryFailedBroadcastCampaign(c.id,['unknown'],['unknown']),1);
 assert.equal(get().broadcastCampaigns[0].items[2].status,'failed');
});

test('retry cannot mutate a running campaign or its in-flight request',()=>{
 const {actions,get}=setup();assert.equal(actions.retryFailedBroadcastCampaign('campaign-1',['failed']),0);
 get().broadcastCampaigns[0].status='paused';assert.equal(actions.retryFailedBroadcastCampaign('campaign-1',['failed']),0);
});

test('legacy creation warns about overlapping plans and only accepts reviewed duplicate IDs',()=>{
 const {actions,get}=setup();get().broadcastCampaigns=[];
 get().contacts=[{id:'recipient',name:'Customer',phone:'+12025550123',accountId:'wa-1'}];
 get().settings.scheduledPlans=[{id:'existing-plan',text:'same text',status:'pending',dueAt:new Date().toISOString(),items:[{accountId:'wa-1',recipient:'+12025550123',status:'pending'}]}];
 const input={accountId:'wa-1',template:'same text',contactIds:['recipient']};
 const blocked=actions.createBroadcastCampaign(input);assert.equal(blocked.ok,false);assert.deepEqual(blocked.duplicateIds,['existing-plan']);assert.equal(get().broadcastCampaigns.length,0);
 const created=actions.createBroadcastCampaign({...input,confirmedDuplicateIds:blocked.duplicateIds});assert.equal(created.ok,true);
 const rechecked=actions.createBroadcastCampaign({...input,confirmedDuplicateIds:blocked.duplicateIds});assert.equal(rechecked.ok,false);assert.deepEqual(rechecked.duplicateIds,[created.id]);
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
