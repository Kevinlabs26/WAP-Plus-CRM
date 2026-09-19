import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const result = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/channels/sendGate.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const mod = await import(moduleUrl);
  const {
    assertSendGate,
    recordOutboundSend,
    resolveEffectiveLimits,
    withSendGate,
  } = mod;

  assert.equal(
    assertSendGate(
      { accountId: "paused", phoneE164: "+12025550123" },
      { sendPausedAccountIds: ["paused"] }
    ).error,
    "send_paused"
  );

  const warmup = resolveEffectiveLimits(
    {
      waAccounts: [{ id: "new", createdAt: new Date(Date.now() - 3600_000).toISOString() }],
      rateLimits: { perPhonePerMinute: 10, perPhonePerHour: 100, minIntervalSec: 4 },
    },
    "new"
  );
  assert.equal(warmup.warmup, true);
  assert.ok(warmup.limits.perPhonePerMinute < 10);
  assert.ok(warmup.limits.minIntervalSec > 4);
  assert.equal(
    resolveEffectiveLimits(
      {
        waAccounts: [
          {
            id: "mature",
            createdAt: new Date().toISOString(),
            warmupExempt: true,
          },
        ],
        rateLimits: {
          perPhonePerMinute: 10,
          perPhonePerHour: 100,
          minIntervalSec: 4,
        },
      },
      "mature"
    ).warmup,
    false
  );

  const input = { accountId: "account-a", phoneE164: "+12025550123" };
  const config = {
    rateLimits: { perPhonePerMinute: 1, perPhonePerHour: 10, minIntervalSec: 0 },
    rateJitterSec: 0,
    globalMinGapSec: 0,
  };
  assert.equal(assertSendGate(input, config).ok, true);
  recordOutboundSend(input, config, config.rateLimits);
  assert.equal(assertSendGate(input, config).error, "rate_limited");
  assert.equal(
    assertSendGate(input, { ...config, rateLimitEnabled: false }).ok,
    true
  );
  assert.equal(
    assertSendGate(input, {
      ...config,
      rateLimitEnabled: false,
      sendPausedAccountIds: [input.accountId],
    }).error,
    "send_paused"
  );
  assert.equal(
    assertSendGate({ ...input, accountId: "account-b" }, config).ok,
    true
  );

  const isolatedInput = { ...input, accountId: "account-c" };
  let blockedSendCalled = false;
  const blocked = await withSendGate(
    { ...isolatedInput, accountId: "paused" },
    { ...config, sendPausedAccountIds: ["paused"] },
    async () => {
      blockedSendCalled = true;
      return { ok: true };
    }
  );
  assert.equal(blocked.ok, false);
  assert.equal(blockedSendCalled, false);
  const failed = await withSendGate(isolatedInput, config, async () => ({ ok: false }));
  assert.equal(failed.ok, true);
  assert.equal(
    (await withSendGate(isolatedInput, config, async () => ({ ok: true }))).ok,
    true
  );

  const localPreviewInput = { accountId: "android-preview", phoneE164: "+12025550124" };
  await withSendGate(localPreviewInput, config, async () => ({
    ok: true,
    delivered: false,
    status: "local",
  }));
  assert.equal(
    assertSendGate(localPreviewInput, config).ok,
    true,
    "Local Android preview must not consume outbound rate-limit quota."
  );

  const raceConfig = {
    rateLimits: { perPhonePerMinute: 1, perPhonePerHour: 10, minIntervalSec: 0 },
    rateJitterSec: 0,
    globalMinGapSec: 0,
  };
  let firstEntered;
  let releaseFirst;
  const firstReady = new Promise((resolve) => { firstEntered = resolve; });
  const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
  let actualSends = 0;
  const firstSend = withSendGate(
    { accountId: "race", phoneE164: "+12025550123" },
    raceConfig,
    async () => {
      actualSends += 1;
      firstEntered();
      await firstDone;
      return { ok: true };
    }
  );
  await firstReady;
  const secondSend = withSendGate(
    { accountId: "race", phoneE164: "+12025550123" },
    raceConfig,
    async () => {
      actualSends += 1;
      return { ok: true };
    }
  );
  releaseFirst();
  const [, secondResult] = await Promise.all([firstSend, secondSend]);
  assert.equal(actualSends, 1, "Concurrent sends must not both enter the sender.");
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.gate.error, "rate_limited");

  console.log("send-gate.test.mjs ok");
