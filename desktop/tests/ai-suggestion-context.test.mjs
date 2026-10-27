import assert from "node:assert/strict";
import test from "node:test";
import { generateSuggestions, getSuggestionContextKey } from "../src/lib/aiSuggest.ts";

const settings = { aiProvider: "custom", customAiBaseUrl: "https://example.invalid/v1", customAiKey: "secret-key", customAiModel: "model-a" };
const contact = { id: "person", name: "Alice", accountId: "a", tags: [], notes: "" };
const message = (id, patch = {}) => ({ id, chatId: "chat-a", accountId: "a", direction: "in", body: id, sentAt: new Date(Date.UTC(2026, 0, 1, 0, Number(id) || 0)).toISOString(), ...patch });

test("context includes earlier conversation, real voice examples, transcripts and quotes without treating unsent messages as spoken", async (t) => {
  let input;
  t.mock.method(globalThis, "fetch", async (_url, opts) => {
    input = JSON.parse(opts.body).messages[1].content;
    return Response.json({ choices: [{ message: { content: '[{"text":"Bien reçu."}]' } }] });
  });
  const history = Array.from({ length: 50 }, (_, i) => message(String(i)));
  history[0] = message("0", { direction: "out", body: "Salut, ça marche !" });
  history[1] = message("1", { direction: "out", systemKind: "ai_auto_reply", body: "ARTIFICIAL VOICE" });
  history[25].body = "IMPORTANT EARLIER DETAIL";
  history[49] = message("49", { mediaType: "audio", body: "[audio]", transcript: "Le rendez-vous est mardi.", quoted: { id: "25", body: "À quelle date ?", fromMe: true } });
  history.push(message("50", { direction: "out", deliveryStatus: "queued", body: "NOT SENT YET" }));
  const result = await generateSuggestions(contact, history, settings);
  assert.equal(result.fallback, false);
  assert.ok(input.includes("IMPORTANT EARLIER DETAIL"));
  assert.ok(input.includes("Le rendez-vous est mardi."));
  assert.ok(input.includes("replying to Me:"));
  assert.ok(input.includes("À quelle date ?"));
  assert.ok(input.includes("Salut, ça marche !"));
  assert.ok(!input.includes("ARTIFICIAL VOICE"));
  assert.ok(!input.includes("NOT SENT YET"));
  assert.equal(result.suggestions.length, 1, "never duplicate a reply to fill three slots");
});

test("long context stays bounded and truncation cannot split an emoji", async (t) => {
  let input;
  t.mock.method(globalThis, "fetch", async (_url, opts) => {
    input = JSON.parse(opts.body).messages[1].content;
    return Response.json({ choices: [{ message: { content: '["OK"]' } }] });
  });
  const history = Array.from({ length: 1000 }, (_, i) => message(String(i), { body: "x".repeat(1999) + "😀" + "long".repeat(1000) }));
  history[999].body = "LATEST MESSAGE";
  await generateSuggestions({ ...contact, notes: "n".repeat(100_000) }, history, settings);
  assert.ok(input.length < 16_000);
  assert.ok(input.includes("LATEST MESSAGE"));
  assert.equal(input.replace(/[\uD800-\uDFFF]/gu, "�"), input);
});

test("suggestion keys follow replies, edits, transcripts, notes, account and model changes but ignore receipts and secrets", () => {
  const history = [message("0")];
  const key = getSuggestionContextKey(contact, history, settings);
  const sameReceipt = [{ ...history[0], deliveryStatus: "read", reactions: [{ emoji: "👍" }], mediaUrl: "different-local-file" }];
  assert.equal(getSuggestionContextKey(contact, sameReceipt, { ...settings, customAiKey: "other-secret" }), key);
  for (const newer of [
    [...history, message("1", { direction: "out", deliveryStatus: "sent", body: "I already answered." })],
    [{ ...history[0], body: "edited" }],
    [{ ...history[0], transcript: "voice text" }],
    [{ ...history[0], quoted: { body: "quote changed" } }],
  ]) assert.notEqual(getSuggestionContextKey(contact, newer, settings), key);
  for (const patch of [{ customAiModel: "model-b" }, { customAiBaseUrl: "https://other.invalid/v1" }, { aiSystemPrompt: "my voice" }]) {
    assert.notEqual(getSuggestionContextKey(contact, history, { ...settings, ...patch }), key);
  }
  assert.notEqual(getSuggestionContextKey({ ...contact, notes: "new note" }, history, settings), key);
  assert.notEqual(getSuggestionContextKey({ ...contact, stage: "won" }, history, settings), key);
  assert.notEqual(getSuggestionContextKey(contact, history, settings, "b"), key);
  assert.ok(!key.includes("secret-key"));
});

test("suggestions discard invalid items and repeated text instead of fabricating extra alternatives", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: JSON.stringify([
    { text: 123 }, { text: " Bien reçu. ", tone: 10 }, "bien   reçu.", null, "Merci !",
  ]) } }] }));
  const result = await generateSuggestions(contact, [message("0")], settings);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.suggestions.map(item => item.text), ["Bien reçu.", "Merci !"]);
});
