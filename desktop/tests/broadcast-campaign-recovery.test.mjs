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

const { normalizeCampaigns, buildCampaignOrError } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const recordedVoice = { id: "voice", kind: "audio", mime: "audio/ogg", voiceNote: true };
const voiceInput = { accountId: "wa-a", template: "", contactIds: ["recipient"],
  contacts: [{ id: "recipient", name: "Recipient", phone: "+12025550123", accountId: "wa-a" }], media: [recordedVoice] };
const voiceOnly = buildCampaignOrError(voiceInput);
assert.equal(voiceOnly.ok, true);
assert.equal(voiceOnly.campaign.items[0].status, "pending");
assert.equal(voiceOnly.campaign.items[0].bodyRendered, "");
assert.equal(voiceOnly.campaign.media[0].voiceNote, true);
assert.equal(normalizeCampaigns([voiceOnly.campaign])[0].media[0].voiceNote, true);
assert.equal(buildCampaignOrError({ ...voiceInput, media: [] }).ok, false);
assert.equal(buildCampaignOrError({ ...voiceInput, template: "caption" }).ok, false);
assert.equal(buildCampaignOrError({ ...voiceInput, template: "caption", media: [{ ...recordedVoice, voiceNote: false }] }).ok, true);
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
  const [legacy] = normalizeCampaigns([{ ...campaign, items: [{ ...campaign.items[0], status: "pending", error: "发送结果未知，请核对" }] }]);
  assert.equal(legacy.items[0].status, "failed", "legacy unknown results cannot reenter the ordinary resume queue");
console.log("broadcast-campaign-recovery.test.mjs ok");
