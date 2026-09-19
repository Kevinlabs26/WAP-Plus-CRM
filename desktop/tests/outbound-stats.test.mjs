import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const result = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/lib/outboundStats.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { clearOutboundStats, getOutboundCounts, seedOutboundStatsFromMessages } =
  await import(moduleUrl);

clearOutboundStats();
const now = Date.now();
seedOutboundStatsFromMessages([
  { direction: "out", accountId: "a", sentAt: new Date(now).toISOString(), deliveryStatus: "sent" },
  { direction: "out", accountId: "a", sentAt: new Date(now).toISOString(), deliveryStatus: "local" },
  { direction: "out", accountId: "a", sentAt: new Date(now).toISOString(), deliveryStatus: "failed" },
  { direction: "out", accountId: "a", sentAt: new Date(now).toISOString(), deliveryStatus: "queued" },
  { direction: "out", accountId: "a", sentAt: new Date(now).toISOString() },
]);
assert.equal(getOutboundCounts("a", now).sentLastHour, 2);
console.log("outbound-stats.test.mjs ok");
