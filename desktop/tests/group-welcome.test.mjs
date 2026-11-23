import assert from "node:assert/strict";
import test from "node:test";
import { liveGroupJoin } from "../baileys-bridge/groupEvents.mjs";
import { buildGroupWelcomeQueue, groupWelcomeKey, normalizeGroupWelcomeRules, recentWelcomeEvents } from "../src/lib/groupWelcome.ts";

const now = Date.parse("2026-11-23T12:00:00Z");
const jid = "123456789@g.us";
const stubs = { GROUP_PARTICIPANT_ADD: 1, GROUP_PARTICIPANT_INVITE: 2, GROUP_PARTICIPANT_ADD_REQUEST_JOIN: 3 };
const message = {
  key: { remoteJid: jid, id: "wa-join" }, messageTimestamp: now / 1000, messageStubType: 3,
  messageStubParameters: ['{"id":"new-1@s.whatsapp.net"}', '{"id":"new-2@s.whatsapp.net"}'],
};

test("only live, confirmed joins produce a single event with the original WhatsApp ID", () => {
  const read = (input, type = "notify") => liveGroupJoin(input, type, stubs, jid => jid === "self@lid");
  assert.deepEqual(read(message), {groupJid:jid,messageId:"wa-join",joinedAt:now});
  assert.equal(read(message, "append"), undefined);
  assert.equal(read({...message, messageStubType: 4}), undefined);
  assert.equal(read({...message,messageStubParameters:['{"id":"self@lid"}']}), undefined);
  assert.equal(read({...message,messageTimestamp:undefined}), undefined);
});

test("one queued template per live batch, including replay after restart and after cleaning the task list", () => {
  const accountId = "wa-test";
  const key = groupWelcomeKey(accountId, jid);
  const state = {
    hydrated: true,
    settings: { sendChannel:"baileys", waAccounts:[{id:accountId},{id:"other"}], scheduledMessages: [],
      groupWelcomeRules: {[key]:{enabled:true,templates:["Welcome!", "Glad you're here!"]}}, groupWelcomeSeen:{} },
    contacts:[{id:"wrong",isGroup:true,channelAddress:jid,accountId:"other"},{id:"right",name:"Group",isGroup:true,channelAddress:jid,accountId}],
    chats:[{id:"chat-1",contactId:"wrong",accountId:"other"},{id:"chat-2",contactId:"right",accountId}],
  };
  const join = liveGroupJoin(message, "notify", stubs, () => false);
  const event = { type:"messages.sync",deviceId:accountId,payload:{source:"group-welcome-live",live:true,...join} };
  const batch = buildGroupWelcomeQueue(state, [event,event], now);
  assert.equal(batch.added.length,1);
  assert.equal(batch.added[0].accountId,accountId);
  assert.equal(batch.added[0].chatId,"chat-2");
  assert.equal(batch.added[0].recipient,jid);
  assert.ok(state.settings.groupWelcomeRules[key].templates.includes(batch.added[0].text));
  state.settings.groupWelcomeSeen = recentWelcomeEvents(JSON.parse(JSON.stringify(batch.seen)), now + 1000);
  assert.equal(buildGroupWelcomeQueue(state,[event],now + 1000),undefined);
  assert.equal(buildGroupWelcomeQueue(state,[event],now + 6 * 60_000),undefined);
  assert.equal(buildGroupWelcomeQueue(state,[{...event,deviceId:"other"}],now),undefined);
  assert.equal(buildGroupWelcomeQueue(state,[{...event,payload:{...event.payload,live:false}}],now),undefined);
  assert.equal(buildGroupWelcomeQueue(state,[{...event,payload:{...event.payload,messageId:"new-join"}}],now).added.length,1);
  const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  for (const text of ["", "Welcome!"]) {
    const version = { text, imageDataUrl };
    state.settings.groupWelcomeRules = normalizeGroupWelcomeRules({ [key]: { enabled: true, templates: [version] } });
    const imageEvent = { ...event, payload: { ...event.payload, messageId: "image-join" } };
    const batch = buildGroupWelcomeQueue(state, [imageEvent, imageEvent], now);
    assert.equal(batch.added.length, 1);
    assert.equal(batch.added[0].text, text);
    assert.equal(batch.added[0].imageDataUrl, imageDataUrl);
    state.settings.groupWelcomeSeen = recentWelcomeEvents(JSON.parse(JSON.stringify(batch.seen)), now + 1000);
    assert.equal(buildGroupWelcomeQueue(state, [imageEvent], now + 1000), undefined);
    state.settings.groupWelcomeSeen = {};
  }
  assert.deepEqual(normalizeGroupWelcomeRules({ [key]: { enabled: true, templates: ["Legacy text", { text: "", imageDataUrl: "https://example.com/image.png" }] } })[key],
    { enabled: true, templates: ["Legacy text"] });
});
