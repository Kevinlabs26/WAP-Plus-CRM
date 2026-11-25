import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

globalThis.window ??= {
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
};

const tauriShellMocks = {
  "@tauri-apps/api/core": "export const invoke = async () => null; export const convertFileSrc = (p) => p;",
  "@tauri-apps/api/event": "export const listen = async () => () => {}; export const emit = async () => {};",
  "@tauri-apps/api/window": "export const getCurrentWindow = () => ({ label: 'main', listen: async () => () => {} });",
  "@tauri-apps/api/webviewWindow": "export const WebviewWindow = class {};",
  "@tauri-apps/plugin-notification": "export const isPermissionGranted = async () => false; export const requestPermission = async () => 'denied'; export const sendNotification = () => {};",
  "@tauri-apps/plugin-shell": "export const open = async () => {};",
  "@tauri-apps/plugin-updater": "export const check = async () => null;",
};

const bundled = await build({
  stdin: {
    contents: `
      export { useAppStore } from "./src/store/appStore.ts";
      export { parseContactsImport } from "./src/lib/contactImport.ts";
      export { buildImportExecutionPlan } from "./src/components/settings/contactImportModalHelpers.ts";
      export { performContactImportExecution } from "./src/components/settings/runContactImportExecution.ts";
      export { createDefaultContactsFilter, queryContactsTable } from "./src/lib/contactsTableQuery.ts";
    `,
    resolveDir: desktopRoot,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: {
    "@": `${desktopRoot}src`,
    "@shared": `${repoRoot}shared`,
  },
  plugins: [
    {
      name: "tauri-shell-boundaries",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /.*/ }, (args) =>
          tauriShellMocks[args.path] ? { path: args.path, namespace: "mock" } : undefined
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: tauriShellMocks[args.path],
        }));
      },
    },
  ],
});

const {
  useAppStore,
  parseContactsImport,
  buildImportExecutionPlan,
  performContactImportExecution,
  createDefaultContactsFilter,
  queryContactsTable,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function resetRealStore() {
  useAppStore.setState({
    activeNav: "chats",
    selectedContactId: null,
    selectedChatId: null,
    contacts: [],
    chats: [],
    messages: [],
    followUps: [],
    activities: [],
    broadcastCampaigns: [],
    scheduledMessages: [],
    toasts: [],
    settings: {
      ...useAppStore.getState().settings,
      sendChannel: "baileys",
      activeAccountId: "wa-a",
      liveBaileysAccountId: "wa-a",
      waAccounts: [
        { id: "wa-a", label: "Alex", phoneE164: "+243810000000", status: "connected" },
        { id: "wa-b", label: "Benoit", phoneE164: "+225070000000", status: "connected" },
      ],
    },
  });
}

test("real store workflow: import updates existing placeholder contacts and creates new ones accurately", async () => {
  resetRealStore();
  useAppStore.setState({
    contacts: [
      {
        id: "bridge-contact-1",
        name: "群成员",
        phone: "+24104128106",
        accountId: "wa-a",
        tags: [],
        stage: "new",
      },
    ],
    chats: [
      {
        id: "bridge-chat-1",
        contactId: "bridge-contact-1",
        contactName: "群成员",
        lastMessage: "Hi",
        unread: 0,
        updatedAt: "2026-11-23T10:00:00.000Z",
        phoneId: "wa-a",
        accountId: "wa-a",
        hasMessageHistory: true,
      },
    ],
  });

  const existingContacts = useAppStore.getState().contacts;
  const importAnalysis = parseContactsImport(
    "Koumba\t24104128106\nMireille\t242069495594",
    existingContacts,
    { headerMode: "auto" }
  );
  const executionPlan = buildImportExecutionPlan({
    importAnalysis,
    duplicateMode: "overwrite",
    nameOverrides: {},
    nameRule: { prefix: "11/24 ", suffix: "", emptyStrategy: "phone_tail" },
    targetAccountId: "wa-a",
    defaultSourceLabel: "批量导入",
  });

  const toasts = [];
  await performContactImportExecution({
    importAnalysis,
    executionPlan,
    saveToWhatsappCloud: false,
    selectedAccountId: "wa-a",
    syncToPhone: false,
    targetPhoneId: "",
    importContacts: (items) => useAppStore.getState().importContacts(items),
    batchUpdateContacts: (ids, patch, extra) =>
      useAppStore.getState().batchUpdateContacts(ids, patch, extra),
    pushToast: (msg, tone) => toasts.push({ msg, tone }),
    t: (key, params) => `${key}:${JSON.stringify(params || {})}`,
  });

  const state = useAppStore.getState();
  assert.equal(state.contacts.length, 2);
  const updated = state.contacts.find((contact) => contact.id === "bridge-contact-1");
  assert.equal(updated?.name, "11/24 Koumba");
  const updatedChat = state.chats.find((chat) => chat.id === "bridge-chat-1");
  assert.equal(updatedChat?.contactName, "11/24 Koumba");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].msg, /"created":1/);
  assert.match(toasts[0].msg, /"updated":1/);
});

test("real store workflow: dedupeAccountContacts safely remaps real BroadcastCampaign items without TypeError", () => {
  resetRealStore();
  useAppStore.setState({
    contacts: [
      {
        id: "bridge-contact-1",
        name: "gloiremufura3",
        phone: "+243851802944",
        accountId: "wa-a",
        tags: ["WhatsApp"],
        stage: "contacted",
      },
      {
        id: "c-import-dup-1",
        name: "gloiremufura3",
        phone: "+243851802944",
        accountId: "wa-a",
        tags: ["VIP"],
        stage: "new",
        notes: "Excel import note",
      },
      {
        id: "bridge-contact-other-account",
        name: "gloiremufura3",
        phone: "+243851802944",
        accountId: "wa-b",
        tags: [],
        stage: "new",
      },
    ],
    chats: [
      {
        id: "bridge-chat-1",
        contactId: "bridge-contact-1",
        contactName: "gloiremufura3",
        lastMessage: "Hello",
        unread: 0,
        updatedAt: "2026-11-23T12:00:00.000Z",
        phoneId: "wa-a",
        accountId: "wa-a",
        hasMessageHistory: true,
      },
    ],
  });

  useAppStore.getState().createBroadcastCampaign({
    accountId: "wa-a",
    title: "Promo",
    template: "Hello {name}",
    contactIds: ["c-import-dup-1"],
  });
  assert.equal(useAppStore.getState().broadcastCampaigns.length, 1);

  const summary = useAppStore.getState().dedupeAccountContacts("wa-a");
  assert.equal(summary.groupsMerged, 1);
  assert.equal(summary.removedContacts, 1);

  const nextState = useAppStore.getState();
  assert.equal(nextState.contacts.length, 2);
  const kept = nextState.contacts.find((contact) => contact.id === "bridge-contact-1");
  assert.deepEqual(kept?.tags, ["WhatsApp", "VIP"]);
  assert.match(kept?.notes || "", /Excel import note/);
  assert.equal(nextState.broadcastCampaigns[0].items[0].contactId, "bridge-contact-1");
});

test("real store workflow: ContactsView nav, multi-filter query, batch stage/tag/follow-up updates", () => {
  resetRealStore();
  useAppStore.getState().setActiveNav("contacts");
  assert.equal(useAppStore.getState().activeNav, "contacts");

  useAppStore.setState({
    contacts: [
      {
        id: "c-1",
        name: "Alice",
        phone: "+243810000001",
        accountId: "wa-a",
        tags: [],
        stage: "new",
        lastMessageAt: "2026-11-01T10:00:00.000Z",
      },
      {
        id: "c-2",
        name: "Bob",
        phone: "+225070000002",
        accountId: "wa-b",
        tags: ["VIP"],
        stage: "won",
        lastMessageAt: "2026-11-23T10:00:00.000Z",
      },
    ],
  });

  useAppStore.getState().batchUpdateContacts(["c-1"], { stage: "quoting" }, { mergeTags: ["Hot"] });
  useAppStore.getState().scheduleFollowUps(["c-1"], "2026-11-26");

  const queried = queryContactsTable({
    contacts: useAppStore.getState().contacts,
    chats: useAppStore.getState().chats,
    followUps: useAppStore.getState().followUps,
    filter: {
      ...createDefaultContactsFilter("wa-a"),
      stage: "quoting",
      tag: "Hot",
      onlyWithFollowUp: true,
    },
    liveAccountId: "wa-a",
    nowMs: Date.parse("2026-11-24T00:00:00.000Z"),
  });

  assert.equal(queried.rows.length, 1);
  assert.equal(queried.rows[0].contact.id, "c-1");
  assert.equal(queried.rows[0].hasPendingFollowUp, true);
});

test("Android C03 security policy disallows global cleartext traffic and restricts it to loopback", () => {
  const manifest = readFileSync(
    `${repoRoot}android/app/src/main/AndroidManifest.xml`,
    "utf8"
  );
  const netConfig = readFileSync(
    `${repoRoot}android/app/src/main/res/xml/network_security_config.xml`,
    "utf8"
  );

  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(netConfig, /<base-config\s+cleartextTrafficPermitted="false"\s*\/>/);
  assert.match(netConfig, /<domain\s+includeSubdomains="false">127\.0\.0\.1<\/domain>/);
});
