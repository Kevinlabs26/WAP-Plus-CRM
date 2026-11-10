import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = buildSync({ entryPoints: [fileURLToPath(new URL('../src/lib/broadcastCampaign.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } });
const { buildCampaignOrError, normalizeCampaigns, broadcastItemMedia, campaignHasMedia } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const image = { id: 'image', kind: 'image', mime: 'image/png', fileName: 'hello.png' };
const video = { id: 'video', kind: 'video', mime: 'video/mp4', fileName: 'bonjour.mp4' };
const voice = { id: 'voice', kind: 'audio', mime: 'audio/ogg', voiceNote: true };
const contacts = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i, name: 'Name' + i, phone: '+12025550' + String(100 + i), company: 'Company' }));
const input = { accountId: 'wa-1', template: 'unused', contacts, contactIds: contacts.map(c => c.id),
  variants: [{ id: 'a', template: 'Hello {name}', media: [image] }, { id: 'b', template: 'Bonjour {company}', media: [video] }] };

test('every recipient gets one complete version with its own rendered text and media', () => {
  const original = Math.random;
  try {
    for (const [random, id, body, media] of [[0.1, 'a', 'Hello Name', image], [0.9, 'b', 'Bonjour Company', video]]) {
      Math.random = () => random;
      const built = buildCampaignOrError(input);
      assert.equal(built.ok, true);
      assert.equal(built.campaign.items.length, contacts.length);
      assert.equal(campaignHasMedia(built.campaign), true);
      for (const item of built.campaign.items) {
        assert.equal(item.variantId, id);
        assert.ok(item.bodyRendered.startsWith(body));
        assert.equal(item.mediaId, media.id);
        assert.deepEqual(broadcastItemMedia(built.campaign, item), [media]);
      }
    }
  } finally { Math.random = original; }
});

test('reload freezes assignments and stops a running campaign without changing text or attachments', () => {
  const built = buildCampaignOrError(input).campaign;
  built.status = 'running';
  const restored = normalizeCampaigns(JSON.parse(JSON.stringify([built])))[0];
  assert.equal(restored.status, 'paused');
  assert.deepEqual(restored.variants, normalizeCampaigns([built])[0].variants);
  assert.deepEqual(restored.items.map(i => [i.variantId, i.bodyRendered, i.mediaId]), built.items.map(i => [i.variantId, i.bodyRendered, i.mediaId]));
  for (const item of restored.items) assert.equal(broadcastItemMedia(restored, item)[0].id, item.mediaId);
});

test('all versions are validated, including unused versions, variables, empty content, voice captions and duplicate IDs', () => {
  for (const bad of [[], [input.variants[0]], Array(11).fill(input.variants[0]),
    [input.variants[0], { id: 'b', template: '' }],
    [input.variants[0], { id: 'b', template: '{unsupported}' }],
    [input.variants[0], { id: 'b', template: 'x'.repeat(2001) }],
    [input.variants[0], { id: 'b', template: 'caption', media: [voice] }],
    [input.variants[0], { id: 'b', template: 'Text', media: [{ id: 'broken', kind: 'unknown' }] }],
    [input.variants[0], { id: 'b', template: 'Text', media: [image, image] }],
    [input.variants[0], { ...input.variants[1], id: 'a' }]]) {
    assert.equal(buildCampaignOrError({ ...input, variants: bad }).ok, false);
  }
  assert.equal(buildCampaignOrError({ ...input, variants: [input.variants[0], { id: 'b', template: '', media: [voice] }] }).ok, true);
});

test('a text-only version never borrows media from another version or the legacy media pool', () => {
  const original = Math.random;
  try {
    Math.random = () => 0.1;
    const campaign = buildCampaignOrError({ ...input, media: [video], variants: [{ id: 'a', template: 'Text only' }, input.variants[1]] }).campaign;
    for (const item of campaign.items) {
      assert.equal(item.bodyRendered, 'Text only');
      assert.equal(item.mediaId, undefined);
      assert.deepEqual(broadcastItemMedia(campaign, item), []);
    }
  } finally { Math.random = original; }
});

test('missing variant or attachment fails closed instead of sending different content or plain text', () => {
  const campaign = buildCampaignOrError(input).campaign;
  const item = campaign.items[0];
  assert.throws(() => broadcastItemMedia({ ...campaign, variants: [] }, item), /版本/);
  assert.throws(() => broadcastItemMedia({ ...campaign, variants: undefined }, item), /版本/);
  assert.throws(() => broadcastItemMedia(campaign, { ...item, variantId: undefined }), /版本/);
  assert.throws(() => broadcastItemMedia(campaign, { ...item, mediaId: undefined }), /附件/);
  assert.throws(() => broadcastItemMedia(campaign, { ...item, mediaId: 'wrong-file' }), /附件/);
});

test('fixed-content campaigns freeze random media too; older stored campaigns still use their media pool', () => {
  const campaign = buildCampaignOrError({ ...input, variants: undefined, template: 'Fixed', media: [image, video], mediaMode: 'random' }).campaign;
  for (const item of campaign.items) assert.equal(broadcastItemMedia(campaign, item)[0].id, item.mediaId);
  const legacy = normalizeCampaigns([{ ...campaign, items: campaign.items.map(({ mediaId, ...item }) => item) }])[0];
  assert.equal(legacy.variants, undefined);
  assert.deepEqual(broadcastItemMedia(legacy, legacy.items[0]), [image, video]);
});
