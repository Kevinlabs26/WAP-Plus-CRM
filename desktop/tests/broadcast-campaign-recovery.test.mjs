import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const result = buildSync({
  entryPoints: [join(dir, "../src/lib/broadcastCampaign.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  alias: { "@": join(dir, "../src") },
  write: false,
});

const { normalizeCampaigns } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
  const [campaign] = normalizeCampaigns([
    {
      id: "campaign-1",
      accountId: "wa-1",
      template: "hello",
      status: "running",
      createdAt: "2026-08-12T10:00:00.000Z",
      items: [
        {
          id: "item-1",
          contactId: "contact-1",
          contactName: "Alice",
          phoneE164: "+12025550100",
          bodyRendered: "hello",
          status: "sending",
        },
      ],
    },
  ]);
  assert.equal(campaign.status, "paused");
  assert.equal(campaign.items[0].status, "failed");
  assert.match(campaign.items[0].error, /结果未知/);
console.log("broadcast-campaign-recovery.test.mjs ok");
