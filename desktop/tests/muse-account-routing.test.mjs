import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mocks = {
  "@/store/appStore": `export const useAppStore = { getState: () => globalThis.routingTestState };`,
  "./museWeb.ts": `
    export const museWebAccounts = async () => globalThis.routingPool;
    export const nextMuseAutoReplyAccount = async (...args) => globalThis.routingNextAccount(...args);
    export const generateMuseWeb = async (...args) => globalThis.routingGenerate(...args);
  `,
  "./musePlaybookSync.ts": `
    export const shareMusePlaybooks = async (paths) => globalThis.routingShare(paths);
    export const trainMuseAccountPlaybooks = async (accountId, materials) => globalThis.routingTrain(accountId, materials);
    export const forgetMuseAccountPlaybookCopies = async () => {};
  `,
  "./museSidebarData.ts": `
    export const museSidebarData = () => "";
    export const museSidebarDataVersion = () => "";
  `,
};

const suggestBundle = await build({
  stdin: {
    contents: `export { generateSuggestions } from './src/lib/aiSuggest.ts'; export { defaultSettings } from './src/store/settingsDefaults.ts'; export { playbookBindingKey } from './src/lib/aiPlaybooks.ts';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: { "@": root + "src" },
  plugins: [
    {
      name: "routing-boundaries",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /.*/ }, (args) =>
          mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: mocks[args.path],
        }));
      },
    },
  ],
});

const ai = await import(
  "data:text/javascript;base64," +
    Buffer.from(suggestBundle.outputFiles[0].text).toString("base64")
);

function createPlaybookRoutingFixture() {
  const revision = "a".repeat(64);
  const contact = { id: "contact-1", accountId: "wa-1", name: "Alice" };
  const history = [
    { id: "m1", chatId: "chat-1", accountId: "wa-1", direction: "in", body: "Bonjour", sentAt: "2026-11-24T10:00:00Z" },
  ];
  const settings = {
    ...ai.defaultSettings,
    aiProvider: "muse",
    aiPlaybookMuseMode: "workspace",
    aiPlaybookMuseAccountId: "primary",
    aiPlaybooks: [
      {
        id: "book-1",
        name: "Day 1",
        sourceName: "01-接新第一天.md",
        content: "",
        summary: "",
        musePath: "/home/hatch/workspace/playbooks/01.md",
        museRevision: revision,
      },
    ],
    aiPlaybookBindings: { [ai.playbookBindingKey("wa-1", "chat-1")]: "book-1" },
    waAccounts: [{ id: "wa-1", label: "Main WA" }],
  };
  globalThis.routingPool = {
    primaryId: "primary",
    selectedId: "primary",
    accounts: [
      { id: "primary", name: "Primary Muse", note: "", selected: true, primary: true },
      { id: "sub-2", name: "Muse 2", note: "", selected: false, primary: false },
    ],
  };
  globalThis.routingState = globalThis.routingTestState = { settings };
  const shareCalls = [];
  const trainCalls = [];
  const generateCalls = [];
  globalThis.routingShare = async (paths) => {
    shareCalls.push(paths);
    globalThis.routingTestState.settings = {
      ...globalThis.routingTestState.settings,
      aiPlaybooks: globalThis.routingTestState.settings.aiPlaybooks.map((book) =>
        paths.includes(book.musePath)
          ? { ...book, content: "SYNCED PLAYBOOK BODY", museShareRevision: revision }
          : book
      ),
    };
  };
  globalThis.routingTrain = async (accountId, materials) => {
    trainCalls.push({ accountId, ids: materials.map((item) => item.id) });
    globalThis.routingTestState.settings = {
      ...globalThis.routingTestState.settings,
      aiPlaybooks: globalThis.routingTestState.settings.aiPlaybooks.map((book) =>
        materials.some((item) => item.id === book.id)
          ? {
              ...book,
              museAccountCopies: {
                ...(book.museAccountCopies || {}),
                [accountId]: {
                  path: `/sub/workspace/WAP Plus CRM - Playbook/${book.id}.md`,
                  revision,
                },
              },
            }
          : book
      ),
    };
  };
  globalThis.routingGenerate = async (_prompt, _signal, _key, context, _priority, onStart, accountId) => {
    await onStart?.();
    generateCalls.push({ accountId, profile: context?.profile || "" });
    return JSON.stringify([{ text: `Reply from ${accountId}` }]);
  };
  return { contact, history, shareCalls, trainCalls, generateCalls };
}

test("manual reply on primary Muse account reads workspace source directly without sharing or self-training", async () => {
  const { contact, history, shareCalls, trainCalls, generateCalls } = createPlaybookRoutingFixture();
  const outcome = await ai.generateSuggestions(
    contact,
    history,
    globalThis.routingTestState.settings,
    { accountId: "wa-1", chatId: "chat-1", count: 1 }
  );
  assert.equal(outcome.fallback, false);
  assert.equal(outcome.museAccountId, "primary");
  assert.equal(shareCalls.length, 0);
  assert.equal(trainCalls.length, 0);
  assert.equal(generateCalls.length, 1);
  assert.match(generateCalls[0].profile, /\/home\/hatch\/workspace\/playbooks\/01\.md/);
});

test("auto-reply rotates primary and secondary accounts: primary reads directly, secondary shares & trains once then reuses", async () => {
  const { contact, history, shareCalls, trainCalls, generateCalls } = createPlaybookRoutingFixture();
  const rotationOrder = ["primary", "sub-2", "sub-2"];
  let turn = 0;
  globalThis.routingNextAccount = async () => rotationOrder[turn++] || "sub-2";

  // Turn 1: primary reads source directly (0 share, 0 train).
  const first = await ai.generateSuggestions(
    contact,
    history,
    globalThis.routingTestState.settings,
    { auto: true, accountId: "wa-1", chatId: "chat-1", count: 1 }
  );
  assert.equal(first.museAccountId, "primary");
  assert.equal(shareCalls.length, 0);
  assert.equal(trainCalls.length, 0);

  // Turn 2: secondary extracts once from primary and trains once onto sub-2.
  const second = await ai.generateSuggestions(
    contact,
    history,
    globalThis.routingTestState.settings,
    { auto: true, accountId: "wa-1", chatId: "chat-1", count: 1 }
  );
  assert.equal(second.museAccountId, "sub-2");
  assert.equal(shareCalls.length, 1);
  assert.equal(trainCalls.length, 1);
  assert.equal(trainCalls[0].accountId, "sub-2");
  assert.match(generateCalls[1].profile, /WAP Plus CRM - Playbook\/book-1\.md/);

  // Turn 3: secondary reuses trained copy with 0 additional share or train calls.
  const third = await ai.generateSuggestions(
    contact,
    history,
    globalThis.routingTestState.settings,
    { auto: true, accountId: "wa-1", chatId: "chat-1", count: 1 }
  );
  assert.equal(third.museAccountId, "sub-2");
  assert.equal(shareCalls.length, 1);
  assert.equal(trainCalls.length, 1);
  assert.match(generateCalls[2].profile, /WAP Plus CRM - Playbook\/book-1\.md/);
});

test("proactive outreach rotates eligible accounts when aiOutreachMuseAccountId is empty and respects pinned accounts", async () => {
  const { contact, history } = createPlaybookRoutingFixture();
  const rotatedAccounts = ["primary", "sub-2"];
  let rotationIndex = 0;
  globalThis.routingNextAccount = async () => rotatedAccounts[rotationIndex++ % rotatedAccounts.length];
  globalThis.routingGenerate = async (_prompt, _signal, _key, _context, _priority, onStart, accountId) => {
    await onStart?.();
    return JSON.stringify({
      action: "send",
      text: `Outreach via ${accountId}`,
      reason: "Customer asked yesterday",
      evidence: "Bonjour",
    });
  };
  await globalThis.routingShare(["/home/hatch/workspace/playbooks/01.md"]);
  await globalThis.routingTrain("sub-2", [{ id: "book-1", name: "Day 1", content: "SYNCED PLAYBOOK BODY", revision: "a".repeat(64) }]);

  const rotated1 = await ai.generateSuggestions(
    contact,
    history,
    { ...globalThis.routingTestState.settings, aiOutreachMuseAccountId: "" },
    { auto: true, accountId: "wa-1", chatId: "chat-1", outreach: "Follow up", outreachDecision: true }
  );
  const rotated2 = await ai.generateSuggestions(
    contact,
    history,
    { ...globalThis.routingTestState.settings, aiOutreachMuseAccountId: "" },
    { auto: true, accountId: "wa-1", chatId: "chat-1", outreach: "Follow up", outreachDecision: true }
  );
  assert.equal(rotated1.decisionDetails?.museAccountId, "primary");
  assert.equal(rotated2.decisionDetails?.museAccountId, "sub-2");

  const pinned = await ai.generateSuggestions(
    contact,
    history,
    { ...globalThis.routingTestState.settings, aiOutreachMuseAccountId: "sub-2" },
    { auto: true, accountId: "wa-1", chatId: "chat-1", outreach: "Follow up", outreachDecision: true }
  );
  assert.equal(pinned.decisionDetails?.museAccountId, "sub-2");
});

test("nextMuseAutoReplyAccount probes unprobed secondary accounts in the background so they enter rotation", async () => {
  const museWebBundle = await build({
    stdin: {
      contents: `export { museWebStatus, nextMuseAutoReplyAccount } from './src/lib/museWeb.ts'; export { setMusePrivacySettingsProvider } from './src/lib/museChatPrivacy.ts';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "native-probe-boundary",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /bridge\.ts$/ }, () => ({ path: "bridge", namespace: "probe" }));
          pluginBuild.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "tauri", namespace: "probe" }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "probe" }, (args) => ({
            contents:
              args.path === "bridge"
                ? "export const isTauri = () => true;"
                : "export const invoke = (cmd, args) => globalThis.probeInvoke(cmd, args);",
          }));
        },
      },
    ],
  });
  const museClient = await import(
    "data:text/javascript;base64," +
      Buffer.from(museWebBundle.outputFiles[0].text).toString("base64")
  );
  museClient.setMusePrivacySettingsProvider(() => ({
    primary: { trainingDisabledConfirmedAt: 1700000000000 },
    "sub-2": { trainingDisabledConfirmedAt: 1700000000001 },
  }));
  const probedIds = [];
  globalThis.probeInvoke = async (cmd, args) => {
    if (cmd === "muse_web_accounts") {
      return {
        primaryId: "primary",
        selectedId: "primary",
        accounts: [
          { id: "primary", name: "Primary", note: "", selected: true, primary: true },
          { id: "sub-2", name: "Muse 2", note: "", selected: false, primary: false },
        ],
      };
    }
    if (cmd === "muse_web_status") {
      probedIds.push(args.accountId);
      return { opened: true, ready: true, state: "ready", message: "Connected" };
    }
    return undefined;
  };

  // Warm only primary first, leaving sub-2 unprobed.
  await museClient.museWebStatus(false, "primary");
  assert.equal(await museClient.nextMuseAutoReplyAccount(), "primary");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(probedIds, ["primary", "sub-2"]);

  // Now sub-2 is ready and rotates on alternating calls.
  assert.equal(await museClient.nextMuseAutoReplyAccount(), "sub-2");
  assert.equal(await museClient.nextMuseAutoReplyAccount(), "primary");
});
