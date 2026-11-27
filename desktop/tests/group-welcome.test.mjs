import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { redactAiContent, setAiPrivacyPolicyProvider } from "../src/lib/aiPrivacy.ts";
import { liveGroupJoin } from "../baileys-bridge/groupEvents.mjs";
import { buildGroupWelcomeQueue, groupWelcomeKey, normalizeGroupWelcomeRules, recentWelcomeEvents } from "../src/lib/groupWelcome.ts";

const now = Date.parse("2026-11-23T12:00:00Z");
const jid = "123456789@g.us";
const stubs = { GROUP_PARTICIPANT_ADD: 1, GROUP_PARTICIPANT_INVITE: 2, GROUP_PARTICIPANT_ADD_REQUEST_JOIN: 3 };
const message = {
  key: { remoteJid: jid, id: "wa-join" }, messageTimestamp: now / 1000, messageStubType: 3,
  messageStubParameters: ['{"id":"new-1@s.whatsapp.net"}', '{"id":"new-2@s.whatsapp.net"}'],
};

test('regular scheduled history does not block a welcome and a full active welcome queue reports the skipped event',()=>{
  const accountId='a',group={id:'g',name:'Group',accountId,isGroup:true,channelAddress:jid};
  const regular=Array.from({length:200},(_,i)=>({id:`regular-${i}`,status:'sent'}));
  const settings={waAccounts:[{id:accountId}],sendChannel:'baileys',scheduledMessages:regular,
    groupWelcomeRules:{[groupWelcomeKey(accountId,jid)]:{enabled:true,templates:['Welcome']}}};
  const state={hydrated:true,settings,contacts:[group],chats:[{id:'gc',contactId:group.id,accountId}]};
  const arrival={type:'messages.sync',deviceId:accountId,payload:{source:'group-welcome-live',live:true,groupJid:jid,messageId:'test',joinedAt:now}};
  const added=buildGroupWelcomeQueue(state,[arrival],now);
  assert.equal(added.tasks.length,201);
  assert.equal(added.added.length,1);
  settings.scheduledMessages=Array.from({length:200},(_,i)=>({id:`group-welcome:old-${i}`,status:'pending'}));
  const blocked=buildGroupWelcomeQueue(state,[arrival],now);
  assert.equal(blocked.capacitySkipped,1);
  assert.equal(blocked.added.length,0);
});

test("privacy matching handles equivalent multilingual text and preserves surrounding words", () => {
  setAiPrivacyPolicyProvider(() => ({terms:"ΟΣ\n가\ncafé",redaction:"[hidden]"}));
  try {
    assert.equal(redactAiContent("prefix ΟΣ / 가 / cafe\u0301 suffix"),"prefix [hidden] / [hidden] / [hidden] suffix");
  } finally {
    setAiPrivacyPolicyProvider(undefined);
  }
});

test("welcome tabs keep each text and image paired across switching and reopening saved settings", async t => {
  const mocks = {
    react: `export const useEffect=()=>{}; export const useId=()=>"welcome";
      export const useRef=value=>globalThis.welcomeEditor.ref(value);
      export const useState=value=>globalThis.welcomeEditor.state(value);`,
    "react/jsx-runtime": "export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment='fragment';",
    "lucide-react": "export const ImageOff='image-off', ImagePlus='image-plus', Plus='plus', Trash2='trash';",
    "@/i18n": "export const useI18n=()=>({t:(key,params)=>params?.count ? key+':'+params.count : key});",
    "@/store/appStore": "export const useAppStore=select=>select(globalThis.welcomeEditor.store);useAppStore.getState=()=>globalThis.welcomeEditor.store;",
  };
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../src/components/chat/GroupWelcomeSettings.tsx", import.meta.url))],
    bundle: true, write: false, format: "esm", jsx: "automatic",
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    plugins: [{ name: "welcome-editor-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
    } }],
  });
  const { GroupWelcomeSettings } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  const accountId = "wa-test";
  const store = {settings:{groupWelcomeRules:{}}, updateSettings(patch) { this.settings = {...this.settings,...patch}; }};
  const slots = [];
  let cursor = 0;
  const slot = initial => {
    const id = cursor++;
    if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial;
    return id;
  };
  const originalEditor = globalThis.welcomeEditor;
  const originalReader = globalThis.FileReader;
  t.after(() => {
    if (originalEditor === undefined) delete globalThis.welcomeEditor; else globalThis.welcomeEditor = originalEditor;
    if (originalReader === undefined) delete globalThis.FileReader; else globalThis.FileReader = originalReader;
  });
  globalThis.welcomeEditor = {
    store,
    state(initial) {
      const id = slot(initial);
      return [slots[id], value => { slots[id] = typeof value === "function" ? value(slots[id]) : value; }];
    },
    ref(initial) { return slots[slot(() => ({current:initial}))]; },
  };
  globalThis.FileReader = class {
    readAsDataURL(file) { queueMicrotask(() => { this.result = file.dataUrl; this.onloadend(); }); }
  };
  const flat = tree => Array.isArray(tree) ? tree.flatMap(flat) : tree?.props ? [tree, ...flat(tree.props.children)] : [];
  const render = () => {
    cursor = 0;
    return flat(GroupWelcomeSettings({accountId,groupJid:jid}));
  };
  const tab = number => render().find(node => node.props.role === "tab" && node.props.children === `groupWelcome.version:${number}`);
  const select = number => tab(number).props.onClick();
  const action = label => render().find(node => node.type === "button" && (node.props["aria-label"] === label || node.props.children === label));
  const imageOne = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE5kAAAAASUVORK5CYII=";
  const imageTwo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const edit = text => render().find(node => node.type === "textarea").props.onChange({target:{value:text}});
  const addImage = dataUrl => render().find(node => node.type === "input" && node.props.type === "file").props.onChange({
    currentTarget:{files:[{size:80,type:"image/png",dataUrl}],value:"upload"},
  });
  const verify = (number,text,image) => {
    const tree = render();
    assert.equal(tab(number).props["aria-selected"],true);
    assert.deepEqual(tree.filter(node => node.type === "textarea").map(node => node.props.value),[text]);
    assert.deepEqual(tree.filter(node => node.type === "img").map(node => node.props.src),image ? [image] : []);
  };

  edit("Bienvenue, version un !");
  action("groupWelcome.addVersion").props.onClick();
  edit("Bienvenue, version deux !");
  select(1);
  addImage(imageOne);
  select(2);
  await Promise.resolve();
  verify(2,"Bienvenue, version deux !");
  addImage(imageTwo);
  await Promise.resolve();
  verify(2,"Bienvenue, version deux !",imageTwo);
  select(1);
  verify(1,"Bienvenue, version un !",imageOne);
  select(2);
  assert.equal(action("dialog.save").props.disabled,false);
  action("dialog.save").props.onClick();

  const saved = JSON.parse(JSON.stringify(store.settings.groupWelcomeRules));
  assert.deepEqual(saved[groupWelcomeKey(accountId,jid)].templates,[
    {text:"Bienvenue, version un !",imageDataUrl:imageOne},
    {text:"Bienvenue, version deux !",imageDataUrl:imageTwo},
  ]);
  slots.length = 0;
  store.settings.groupWelcomeRules = normalizeGroupWelcomeRules(saved);
  verify(1,"Bienvenue, version un !",imageOne);
  select(2);
  verify(2,"Bienvenue, version deux !",imageTwo);
  assert.equal(action("dialog.save").props.disabled,true);
});

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
