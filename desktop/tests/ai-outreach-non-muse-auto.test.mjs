import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateSuggestions } from "../src/lib/aiSuggest.ts";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const outreachContextBundle = await build({
  stdin: {
    contents: `export { inspectOutreachCandidate } from "./src/lib/aiOutreachContext.ts";`,
    resolveDir: desktopRoot,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: { "@": `${desktopRoot}src`, "@shared": `${repoRoot}shared` },
});
const { inspectOutreachCandidate } = await import(
  `data:text/javascript;base64,${Buffer.from(outreachContextBundle.outputFiles[0].text).toString("base64")}`
);

function createCustomSettings() {
  return {
    aiProvider: "custom",
    customAiKey: "sk-live-fixture-key",
    customAiBaseUrl: "https://example.invalid/v1",
    customAiModel: "gpt-4.1-mini",
    aiModel: "",
    aiSystemPrompt: "Be helpful and concise.",
    aiContextMode: "full",
    waAccounts: [{ id: "wa-a", label: "Alex", status: "connected" }],
    chatFolders: [],
    chatFolderClones: [],
  };
}

test("non-Muse provider supports structured auto outreach send decision with grounded chat evidence", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              action: "send",
              text: "Bonjour Alice, voici la mise a jour du catalogue demandee.",
              reason: "Customer asked for the updated catalog yesterday.",
              evidence: "Please share the updated catalog tomorrow",
            }),
          },
        },
      ],
    });

  const result = await generateSuggestions(
    { id: "c-1", name: "Alice", phone: "+243810000001", accountId: "wa-a", tags: [], stage: "contacted" },
    [
      {
        id: "m-1",
        chatId: "chat-1",
        direction: "in",
        body: "Please share the updated catalog tomorrow",
        sentAt: "2026-11-23T10:00:00.000Z",
      },
    ],
    createCustomSettings(),
    {
      auto: true,
      accountId: "wa-a",
      chatId: "chat-1",
      outreach: "Follow up on catalog request.",
      outreachDecision: true,
    }
  );

  assert.equal(result.fallback, false);
  assert.equal(result.outreachDecision?.action, "send");
  assert.equal(result.decisionDetails?.evidence, "Please share the updated catalog tomorrow");
  assert.equal(result.decisionDetails?.reason, "Customer asked for the updated catalog yesterday.");
  assert.equal(result.suggestions.length, 1);
});

test("Gemini proactive contact ignores a saved Muse account and uses Gemini", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (request) => {
    assert.equal(new URL(String(request)).hostname, "generativelanguage.googleapis.com");
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      action: "skip", reason: "No reason to contact the recipient.",
    }) }] } }] });
  });
  const result = await generateSuggestions(undefined, [], {
    ...createCustomSettings(), aiProvider: "gemini", geminiKey: "test-key",
    aiModel: "gemini-test", aiOutreachMuseAccountId: "saved-muse",
  }, { auto: true, outreach: "Check whether a follow-up is appropriate.", outreachDecision: true });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(result.source, "gemini");
  assert.equal(result.outreachDecision?.action, "skip");
  assert.equal(result.decisionDetails?.museAccountId, undefined);
});

test("non-Muse provider supports structured skip decision and downgrades ungrounded or array responses to draft", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const contact = {
    id: "c-1",
    name: "Alice",
    phone: "+243810000001",
    accountId: "wa-a",
    tags: [],
    stage: "contacted",
  };
  const thread = [
    {
      id: "m-1",
      chatId: "chat-1",
      direction: "in",
      body: "I will check next week.",
      sentAt: "2026-11-23T10:00:00.000Z",
    },
  ];
  const opts = {
    auto: true,
    accountId: "wa-a",
    chatId: "chat-1",
    outreach: "Check in politely.",
    outreachDecision: true,
  };

  // 1. Structured skip
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              action: "skip",
              reason: "Customer already said they will check next week.",
            }),
          },
        },
      ],
    });
  const skipped = await generateSuggestions(contact, thread, createCustomSettings(), opts);
  assert.equal(skipped.outreachDecision?.action, "skip");
  assert.equal(skipped.suggestions.length, 0);

  // 2. Ungrounded evidence downgrades to draft
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              action: "send",
              text: "Hello Alice, checking in on your order.",
              reason: "Follow up.",
              evidence: "Hallucinated quote that never existed in chat",
            }),
          },
        },
      ],
    });
  const ungrounded = await generateSuggestions(contact, thread, createCustomSettings(), opts);
  assert.equal(ungrounded.outreachDecision?.action, "draft");
  assert.equal(ungrounded.decisionDetails?.evidence, undefined);
  const noHistory = await generateSuggestions(contact, [], createCustomSettings(), opts);
  assert.equal(noHistory.outreachDecision?.action, "draft");
  assert.equal(noHistory.decisionDetails?.evidence, undefined);

  // 3. Legacy suggestion array downgrades gracefully to draft
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify([{ text: "Bonjour Alice, comment allez-vous ?" }]),
          },
        },
      ],
    });
  const legacyArray = await generateSuggestions(contact, thread, createCustomSettings(), opts);
  assert.equal(legacyArray.fallback, false);
  assert.equal(legacyArray.outreachDecision?.action, "draft");
  assert.equal(legacyArray.suggestions[0]?.text, "Bonjour Alice, comment allez-vous ?");
});

test("re-enabling scheduled outreach on the same day retries prior cancelled runs but still blocks sent ones", () => {
  const cancelledAt = "2026-11-24T09:05:00.000Z";
  const rescheduledStartAt = Date.parse("2026-11-24T10:00:00.000Z");
  const now = Date.parse("2026-11-24T10:05:00.000Z");

  const baseState = (priorStatus) => ({
    baileysUi: { connection: "connected" },
    contacts: [
      {
        id: "c-new-1",
        name: "Never Contacted Lead",
        phone: "+243810000099",
        accountId: "wa-a",
        tags: [],
        stage: "new",
      },
    ],
    chats: [
      {
        id: "chat-c-new-1",
        contactId: "c-new-1",
        contactName: "Never Contacted Lead",
        lastMessage: "",
        unread: 0,
        updatedAt: "2026-11-24T08:00:00.000Z",
        phoneId: "wa-a",
        accountId: "wa-a",
        hasMessageHistory: false,
      },
    ],
    messages: [],
    messagesByChatId: {},
    settings: {
      ...createCustomSettings(),
      sendChannel: "baileys",
      liveBaileysAccountId: "wa-a",
      activeAccountId: "wa-a",
      aiAutoReplyPaused: false,
      aiOutreachPaused: false,
      aiAutoReplyManualChatIds: [],
      aiOutreachExcludedRecipients: [],
      sendPausedAccountIds: [],
      chatFolders: [
        {
          id: "folder-1",
          name: "New Leads",
          chatIds: ["chat-c-new-1"],
          scope: { type: "account", accountId: "wa-a" },
          aiOutreach: {
            enabled: true,
            mode: "auto",
            startMode: "scheduled",
            time: "10:00",
            timeZone: "UTC",
            scheduleStartAt: rescheduledStartAt,
            goal: "Introduce our catalog politely.",
          },
        },
      ],
      aiOutreachRuns: [
        {
          id: "old-run-1",
          folderId: "folder-1",
          chatId: "chat-c-new-1",
          accountId: "wa-a",
          recipient: "+243810000099",
          day: "2026-11-24",
          basisAt: "2026-11-24T08:00:00.000Z",
          at: cancelledAt,
          status: priorStatus,
        },
      ],
    },
  });

  const afterCancel = inspectOutreachCandidate(baseState("cancelled"), "folder-1", "chat-c-new-1", now);
  assert.equal(afterCancel.reason, "ready");
  assert.ok(afterCancel.candidate);

  const afterSent = inspectOutreachCandidate(baseState("sent"), "folder-1", "chat-c-new-1", now);
  assert.equal(afterSent.reason, "already_contacted");
  assert.equal(afterSent.candidate, null);
});
