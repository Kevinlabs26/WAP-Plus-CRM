import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSuggestions,
  hasRealAiKey,
  resolveAiSystemPrompt,
} from "../src/lib/aiSuggest.ts";
import {
  DEFAULT_AUTO_REPLY_POLICY,
  evaluateAutoReplyDecision,
  getAutoReplyBlockReason,
  getAutoReplyOutputBlockReason,
  getRecentManualTakeover,
  isWithinAutoReplyHours,
  latestMessagesPerChat,
  normalizeAutoReplyPolicy,
  parseAutoReplyReplay,
  resolveAutoReplyPolicy,
} from "../src/lib/aiSafety.ts";

test("hasRealAiKey rejects mock / missing-key configs", () => {
  assert.equal(hasRealAiKey({ aiProvider: "mock" }), false);
  assert.equal(hasRealAiKey({ aiProvider: "openai", openaiKey: "   " }), false);
  assert.equal(
    hasRealAiKey({ aiProvider: "custom", customAiBaseUrl: "", customAiKey: "x" }),
    false
  );
  assert.equal(hasRealAiKey({ aiProvider: "groq", groqKey: "" }), false);
});

test("hasRealAiKey accepts configured real providers", () => {
  assert.equal(hasRealAiKey({ aiProvider: "openai", openaiKey: "sk-x" }), true);
  assert.equal(hasRealAiKey({ aiProvider: "groq", groqKey: "gsk-x" }), true);
  assert.equal(
    hasRealAiKey({ aiProvider: "ollama", ollamaUrl: "http://127.0.0.1:11434" }),
    true
  );
  assert.equal(
    hasRealAiKey({
      aiProvider: "custom",
      customAiBaseUrl: "https://api.deepseek.com/v1",
      customAiKey: "sk-x",
    }),
    true
  );
});

test("account identity overrides the default and empty values inherit", () => {
  const settings = {
    aiSystemPrompt: "默认身份",
    aiSystemPromptByAccountId: {
      personal: "个人身份",
      empty: "   ",
    },
  };
  assert.equal(resolveAiSystemPrompt(settings, "personal"), "个人身份");
  assert.equal(resolveAiSystemPrompt(settings, "empty"), "默认身份");
  assert.equal(resolveAiSystemPrompt(settings, "unknown"), "默认身份");
  assert.equal(resolveAiSystemPrompt(settings), "默认身份");
});

test("auto reply safety blocks sensitive or commitment-heavy messages", () => {
  assert.match(getAutoReplyBlockReason("你们这款多少钱？"), /价格/);
  assert.match(getAutoReplyBlockReason("Please process my refund"), /付款|合同|法律/);
  assert.match(getAutoReplyBlockReason("验证码是 123456"), /账号|支付/);
  assert.equal(getAutoReplyBlockReason("你好，最近怎么样？"), null);
  assert.match(getAutoReplyOutputBlockReason("We guarantee it will arrive"), /承诺/);
  assert.equal(
    getAutoReplyOutputBlockReason("Thanks, I will check and get back to you."),
    null
  );
});

test("account auto-reply policy inherits defaults and normalizes overrides", () => {
  const defaultPolicy = {
    activeStart: "09:00",
    activeEnd: "18:00",
    takeoverMinutes: 45,
    allowPricing: false,
  };
  const overrides = {
    personal: {
      activeStart: "22:00",
      activeEnd: "06:00",
      takeoverMinutes: 15,
      allowPricing: true,
    },
  };
  assert.deepEqual(
    resolveAutoReplyPolicy(defaultPolicy, overrides, "unknown"),
    defaultPolicy
  );
  assert.deepEqual(
    resolveAutoReplyPolicy(defaultPolicy, overrides, "personal"),
    overrides.personal
  );
  assert.deepEqual(
    normalizeAutoReplyPolicy({
      activeStart: "99:00",
      activeEnd: "18:00",
      takeoverMinutes: 9999,
      allowPricing: "yes",
    }),
    {
      ...DEFAULT_AUTO_REPLY_POLICY,
      activeEnd: "18:00",
      takeoverMinutes: 1440,
    }
  );
});

test("active hours support daytime, overnight, and all-day policies", () => {
  const daytime = { ...DEFAULT_AUTO_REPLY_POLICY, activeStart: "09:00", activeEnd: "18:00" };
  assert.equal(isWithinAutoReplyHours(daytime, new Date(2026, 0, 1, 9, 0)), true);
  assert.equal(isWithinAutoReplyHours(daytime, new Date(2026, 0, 1, 18, 0)), false);

  const overnight = { ...daytime, activeStart: "22:00", activeEnd: "06:00" };
  assert.equal(isWithinAutoReplyHours(overnight, new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(isWithinAutoReplyHours(overnight, new Date(2026, 0, 2, 5, 59)), true);
  assert.equal(isWithinAutoReplyHours(overnight, new Date(2026, 0, 2, 12, 0)), false);
  assert.equal(
    isWithinAutoReplyHours(DEFAULT_AUTO_REPLY_POLICY, new Date(2026, 0, 2, 12, 0)),
    true
  );
});

test("pricing can be enabled without relaxing other safety boundaries", () => {
  const now = new Date(2026, 0, 1, 10, 0).getTime();
  const pricingMessage = {
    direction: "in",
    body: "这款价格是多少？",
    sentAt: new Date(now - 1000).toISOString(),
  };
  assert.equal(evaluateAutoReplyDecision([], pricingMessage, now).allow, false);
  assert.equal(
    evaluateAutoReplyDecision([], pricingMessage, now, {
      ...DEFAULT_AUTO_REPLY_POLICY,
      allowPricing: true,
    }).allow,
    true
  );
  assert.equal(
    getAutoReplyOutputBlockReason("The price is $10.", { allowPricing: true }),
    null
  );
  assert.match(
    getAutoReplyOutputBlockReason("We guarantee this price.", {
      allowPricing: true,
    }),
    /承诺/
  );
  assert.match(
    getAutoReplyOutputBlockReason("Please pay now.", { allowPricing: true }),
    /付款|合同|法律/
  );
});

test("policy controls active hours and manual takeover duration", () => {
  const tenOClock = new Date(2026, 0, 1, 10, 0).getTime();
  const inbound = {
    id: "in-2",
    direction: "in",
    body: "你好",
    sentAt: new Date(tenOClock - 1000).toISOString(),
  };
  const outside = evaluateAutoReplyDecision([], inbound, tenOClock, {
    ...DEFAULT_AUTO_REPLY_POLICY,
    activeStart: "11:00",
    activeEnd: "18:00",
  });
  assert.equal(outside.kind, "outside_hours");

  const manual = {
    id: "manual",
    direction: "out",
    sentAt: new Date(tenOClock - 4 * 60_000).toISOString(),
  };
  assert.equal(
    evaluateAutoReplyDecision([manual, inbound], inbound, tenOClock, {
      ...DEFAULT_AUTO_REPLY_POLICY,
      takeoverMinutes: 3,
    }).allow,
    true
  );
  assert.equal(
    evaluateAutoReplyDecision([manual, inbound], inbound, tenOClock, {
      ...DEFAULT_AUTO_REPLY_POLICY,
      takeoverMinutes: 5,
    }).kind,
    "manual_takeover"
  );
});

test("consecutive inbound messages keep only the latest item per chat", () => {
  const latest = latestMessagesPerChat([
    { id: "a1", chatId: "a", sentAt: "2026-01-01T00:00:00Z" },
    { id: "b1", chatId: "b", sentAt: "2026-01-01T00:01:00Z" },
    { id: "a2", chatId: "a", sentAt: "2026-01-01T00:02:00Z" },
  ]);
  assert.deepEqual(latest.map((message) => message.id), ["a2", "b1"]);
});

test("manual reply pauses automation only for the current conversation turn", () => {
  const manual = {
    id: "manual-1",
    direction: "out",
    systemKind: "",
    sentAt: "2026-01-01T00:05:00.000Z",
  };
  const inbound = {
    id: "in-2",
    direction: "in",
    sentAt: "2026-01-01T00:06:00.000Z",
  };
  assert.equal(
    getRecentManualTakeover(
      [
        { direction: "in", sentAt: "2026-01-01T00:00:00.000Z" },
        manual,
        inbound,
      ],
      inbound,
      Date.parse("2026-01-01T00:10:00.000Z")
    )?.id,
    "manual-1"
  );
  assert.equal(
    getRecentManualTakeover(
      [manual, inbound],
      inbound,
      Date.parse("2026-01-01T01:00:00.000Z")
    ),
    null
  );
});

test("chat replay parses roles and uses the same automatic decision", () => {
  const now = Date.parse("2026-01-01T00:10:00.000Z");
  const safe = parseAutoReplyReplay(
    "对方：你好\nAI：你好，我是 AI 助手\n对方：最近怎么样？",
    now
  );
  assert.deepEqual(
    safe.map((message) => [message.direction, message.systemKind || ""]),
    [
      ["in", ""],
      ["out", "ai_auto_reply"],
      ["in", ""],
    ]
  );
  assert.equal(evaluateAutoReplyDecision(safe, safe[2], now).allow, true);

  const risky = parseAutoReplyReplay("对方：你好\n对方：你们多少钱？", now);
  const decision = evaluateAutoReplyDecision(risky, risky[1], now);
  assert.equal(decision.allow, false);
  assert.equal(decision.kind, "risk");
});

test("generateSuggestions mock mode returns 3 suggestions in Chinese for zh cue", async () => {
  const result = await generateSuggestions(
    { name: "张先生", phone: "+8613800000000", tags: [], stage: "new" },
    [
      {
        id: "m1",
        chatId: "c",
        direction: "in",
        body: "你们这款多少钱？能寄样品吗",
        sentAt: "2026-01-01T00:00:00Z",
      },
    ],
    { aiProvider: "mock" }
  );
  assert.equal(result.source, "mock");
  assert.equal(result.fallback, false);
  assert.equal(result.suggestions.length, 3);
  for (const s of result.suggestions) {
    assert.ok(s.text.length > 0);
    assert.ok(/[\u4e00-\u9fff]/.test(s.text), "expected Chinese suggestion");
  }
});

test("generateSuggestions mock mode returns English for english cue", async () => {
  const result = await generateSuggestions(
    { name: "Alice", phone: "+1...", tags: [], stage: "new" },
    [
      {
        id: "m1",
        chatId: "c",
        direction: "in",
        body: "What is your MOQ and price?",
        sentAt: "2026-01-01T00:00:00Z",
      },
    ],
    { aiProvider: "mock" }
  );
  assert.equal(result.suggestions.length, 3);
  assert.ok(
    result.suggestions.every((s) => /[A-Za-z]/.test(s.text)),
    "expected English suggestions"
  );
});
