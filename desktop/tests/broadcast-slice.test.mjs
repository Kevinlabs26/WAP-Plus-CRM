import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const result = await build({
  stdin: { contents: `export {createBroadcastSlice} from './src/store/broadcastSlice.ts'; export {trimCampaigns,normalizeCampaigns} from './src/lib/broadcastCampaign.ts'; export {routeBroadcastAccounts} from './src/lib/broadcastAccountRouting.ts';`, resolveDir: join(dir, '..') },
  bundle: true,
  format: "esm",
  platform: "browser",
  alias: { "@": join(dir, "../src") },
  external: ["@tauri-apps/api/core"],
  write: false,
  plugins:[{name:'broadcast-ui-boundary',setup(b){b.onResolve({filter:/^@\/i18n$/},()=>({path:'i18n',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const translateCurrent=(k,p)=>k+JSON.stringify(p||{});'}));}}],
});
const { createBroadcastSlice, trimCampaigns, normalizeCampaigns, routeBroadcastAccounts } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=broadcast-slice-test.js').toString("base64")}`
);

test('history retention preserves older unfinished campaigns during creation and reload',()=>{
 const base={accountId:'wa-1',template:'test',items:[{id:'item',status:'pending'}],createdAt:'2026-01-01T00:00:00Z'};
 const active=['running','paused','draft'].map(status=>({...base,id:status,status}));
 const done=Array.from({length:35},(_,n)=>({...base,id:`done-${n}`,status:'done',items:[],createdAt:new Date(Date.UTC(2026,1,n+1)).toISOString()}));
 for(const records of [trimCampaigns([...active,...done]),normalizeCampaigns([...active,...done])]){
  assert.equal(records.filter(campaign=>campaign.status==='done').length,30);
  for(const campaign of active)assert.ok(records.some(record=>record.id===campaign.id));
 }
});

test('ordinary broadcast creation rejects an account change after confirmation',()=>{
 const {actions,get}=setup();const state=get();
 state.contacts=[{id:'c',phone:'+12025550101',accountId:'wa-2'}];
 state.chats=[{id:'chat',contactId:'c',accountId:'wa-2',hasMessageHistory:true,updatedAt:'2026-01-01T00:00:00Z'}];
 const created=actions.createBroadcastCampaign({accountId:'wa-1',template:'Hello',contactIds:['c'],expectedAccountByPhone:{'+12025550101':'wa-1'}});
 assert.equal(created.ok,false);assert.match(created.reason,/账号已变化/);
});

test("ordinary broadcast refuses unknown history and preserves original and genuinely new routes", () => {
  const { actions, get } = setup();
  const state = get();
  state.contacts = [
    { id: "orphan", phone: "+12025550101", lastMessageAt: "2026-01-01T00:00:00Z" },
    { id: "legacy", phone: "+12025550102", accountId: "wa-1" },
    { id: "ownerless", phone: "+12025550103" },
    { id: "existing", phone: "+12025550104", accountId: "wa-1" },
    { id: "new", phone: "+12025550105" },
  ];
  state.chats = [
    { id: "legacy-chat", contactId: "legacy", accountId: "wa-1" },
    { id: "old-chat", contactId: "ownerless", hasMessageHistory: true },
    { id: "known-chat", contactId: "existing", accountId: "wa-1", hasMessageHistory: true },
  ].map(chat => ({ ...chat, updatedAt: "2026-01-01T00:00:00Z" }));
  state.broadcastCampaigns = [];
  const draft = { accountId: "wa-2", template: "Hello" };
  const preview = routeBroadcastAccounts(state, state.contacts.map(contact => contact.phone), draft.accountId);
  assert.deepEqual(preview.blockedByPhone, {
    "+12025550101": "unknownHistory", "+12025550102": "unknownHistory", "+12025550103": "unknownAccount",
  });
  assert.deepEqual(preview.accountByPhone, { "+12025550104": "wa-1", "+12025550105": "wa-2" });
  const pending = routeBroadcastAccounts({ ...state, messages: [...state.messages, {
    chatId: "known-chat", direction: "out", deliveryStatus: "queued",
  }] }, ["+12025550104"], draft.accountId);
  assert.deepEqual(pending.blockedByPhone, { "+12025550104": "pendingDelivery" });
  for (const id of ["orphan", "legacy", "ownerless"]) {
    const rejected = actions.createBroadcastCampaign({ ...draft, contactIds: [id] });
    assert.equal(rejected.ok, false, id);
    assert.match(rejected.reason, /无法确认/);
  }
  state.chats = [...state.chats, { id: "empty", contactId: "orphan", accountId: "wa-2", hasMessageHistory: false }];
  assert.equal(actions.createBroadcastCampaign({ ...draft, contactIds: ["orphan"] }).ok, false);
  assert.equal(actions.createBroadcastCampaign({ ...draft, contactIds: ["existing", "new"] }).ok, true);
  assert.deepEqual(get().broadcastCampaigns[0].items.map(item => item.accountId), ["wa-1", "wa-2"]);
});

function setup() {
  let state = {
    hydrated: false,
    settings: { waAccounts: [{ id: "wa-1" }, { id: "wa-2" }], scheduledPlans: [] },
    contacts: [],
    chats: [],
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

test("a previously contacted recipient with an unresolved delivery cannot enter another broadcast", () => {
  const {actions,get} = setup();
  const state = get();
  state.broadcastCampaigns = [];
  state.contacts = [{id:"customer",name:"Customer",phone:"+12025550100",accountId:"wa-1"}];
  state.chats = [{id:"chat-1",contactId:"customer",accountId:"wa-1",hasMessageHistory:true,updatedAt:"2026-08-12T10:05:00.000Z"}];
  state.messages = [
    {...state.messages[0],id:"confirmed",deliveryStatus:"sent"},
    {...state.messages[0],id:"uncertain",sentAt:"2026-08-12T10:05:00.000Z",deliveryStatus:"failed",deliveryUncertain:true},
  ];
  const result = actions.createBroadcastCampaign({accountId:"wa-2",template:"Hello",contactIds:["customer"],firstContactQuotas:{"wa-2":1}});
  assert.equal(result.ok,false);
  assert.match(result.reason,/无法确认/);
  assert.equal(get().broadcastCampaigns.length,0);
});

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

test('version routing and media assignments survive pause, retry and resume', () => {
  const { actions, get } = setup();
  get().broadcastCampaigns=[];
  get().contacts=[{id:'customer',name:'Alice',phone:'+12025550123',accountId:'wa-1'}];
  get().chats=[{id:'chat-2',contactId:'customer',accountId:'wa-2',lastMessageAt:'2026-11-08T12:00:00Z'}];
  get().messages=[{id:'latest',chatId:'chat-2',contactId:'customer',accountId:'wa-2',direction:'out',body:'Last conversation',sentAt:'2026-11-08T12:00:00Z'}];
  const created=actions.createBroadcastCampaign({accountId:'wa-1',template:'Unused',contactIds:['customer'],
    variants:[{id:'a',template:'Hi {name}',media:[{id:'a-image',kind:'image',mime:'image/png'}]},
      {id:'b',template:'Bonjour {name}',media:[{id:'b-image',kind:'image',mime:'image/png'}]}]});
  assert.equal(created.ok,true);
  let campaign=get().broadcastCampaigns[0];
  assert.equal(campaign.items[0].accountId,'wa-2');
  const before=JSON.stringify(campaign.items.map(i=>[i.variantId,i.bodyRendered,i.mediaId,i.accountId]));
  assert.equal(campaign.variants.length,2);
  assert.equal(actions.startBroadcastCampaign(created.id).ok,true);
  actions.pauseBroadcastCampaign(created.id);
  campaign=get().broadcastCampaigns[0];campaign.items[0].status='failed';campaign.items[0].error='rejected';
  assert.equal(actions.retryFailedBroadcastCampaign(created.id,[campaign.items[0].id]),1);
  assert.equal(actions.resumeBroadcastCampaign(created.id).ok,true);
  assert.equal(JSON.stringify(get().broadcastCampaigns[0].items.map(i=>[i.variantId,i.bodyRendered,i.mediaId,i.accountId])),before);
});
