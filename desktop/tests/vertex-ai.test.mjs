import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { generateSuggestions } from "../src/lib/aiSuggest.ts";
import { geminiGenerate, geminiGenerateImage } from "../src/lib/gemini.ts";
import { translateDraftText } from "../src/lib/translateDraft.ts";
import { getTranslationSettings, translationSettingsPatch } from "../src/lib/translationConfig.ts";
import { listVertexModels, parseVertexServiceAccount, VERTEX_DEFAULT_MODEL } from "../src/lib/vertexAi.ts";

const root = "https://aiplatform.googleapis.com/v1";
const candidate = part => ({ candidates: [{ content: { parts: [part] } }] });

test("Vertex Express lists only text models accepted for the supplied key", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.headers.get("x-goog-api-key"), "vertex-key");
    assert.equal(options.method, "POST");
    assert.match(url, /:countTokens$/);
    if (url === `${root}/publishers/google/models/gemini-3.8-flash:countTokens`) return Response.json({ totalTokens: 1 });
    return new Response(null, { status: url.includes(VERTEX_DEFAULT_MODEL) ? 403 : 404 });
  });
  assert.deepEqual(await listVertexModels("vertex-key", "gemini-3.1-flash-image", new AbortController().signal), ["gemini-3.8-flash"]);
  assert.ok(fetchMock.mock.calls.every(call => !call.arguments[0].includes("-image")));
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 429 }));
  await assert.rejects(listVertexModels("vertex-key", "", new AbortController().signal), /429/);
});

test("Vertex service-account model discovery reads the catalog and probes its project", async t => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = JSON.stringify({
    type: "service_account", project_id: "crm-project", client_email: "bridge@crm-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "service-token" });
    assert.equal(options.headers.get("Authorization"), "Bearer service-token");
    if (url.startsWith("https://aiplatform.googleapis.com/v1beta1/publishers/google/models?")) {
      const page = new URL(url).searchParams.get("pageToken");
      return page
        ? Response.json({ publisherModels: [{ name: "publishers/google/models/gemini-4-argon" }] })
        : Response.json({ publisherModels: [{ name: "publishers/google/models/gemini-3.8-flash-tts" }], nextPageToken: "second" });
    }
    assert.match(url, /\/projects\/crm-project\/locations\/global\/publishers\/google\/models\/gemini-.*:countTokens$/);
    return url.endsWith("/gemini-4-argon:countTokens")
      ? Response.json({ totalTokens: 1 })
      : new Response(null, { status: 404 });
  });
  assert.deepEqual(await listVertexModels(credential, "", new AbortController().signal), ["gemini-4-argon"]);
  assert.equal(fetchMock.mock.calls.filter(call => call.arguments[0] === "https://oauth2.googleapis.com/token").length, 1);
  assert.ok(fetchMock.mock.calls.every(call => !call.arguments[0].includes("-tts")));
});

test("Vertex Express streams suggestions and uses its own API key", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `${root}/publishers/google/models/${VERTEX_DEFAULT_MODEL}:streamGenerateContent?alt=sse`);
    assert.equal(options.headers.get("x-goog-api-key"), "vertex-key");
    assert.equal(options.headers.get("Authorization"), null);
    return new Response(`data: ${JSON.stringify(candidate({ text: '[{"text":"Bonjour"}]' }))}\n\n`);
  });
  const updates = [];
  const result = await generateSuggestions({ id: "c", name: "Client", tags: [] }, [],
    { aiProvider: "vertex", vertexCredential: "vertex-key", geminiKey: "other-key", aiModel: "" },
    { onProgress: update => updates.push(update) });
  assert.equal(result.source, "vertex");
  assert.equal(result.suggestions[0].text, "Bonjour");
  assert.equal(updates[0].source, "vertex");
});

test("Vertex service account signs a Google OAuth assertion and calls its project", async t => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const email = "bridge@crm-project.iam.gserviceaccount.com";
  const credential = JSON.stringify({
    type: "service_account", project_id: "crm-project", client_email: email,
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://unexpected.example/token",
  });
  const oauth = "https://oauth2.googleapis.com/token";
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.redirect, "error");
    if (url === oauth) {
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [header, payload, signature] = options.body.get("assertion").split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url"));
      assert.equal(claims.aud, oauth);
      assert.equal(claims.iss, email);
      assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
      assert.equal(claims.exp - claims.iat, 3600);
      assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")));
      return Response.json({ access_token: "google-test-token" });
    }
    assert.equal(url, `${root}/projects/crm-project/locations/global/publishers/google/models/custom-model:generateContent`);
    assert.equal(options.headers.get("Authorization"), "Bearer google-test-token");
    assert.equal(options.headers.get("x-goog-api-key"), null);
    return Response.json(candidate({ text: "OK" }));
  });
  assert.equal(await geminiGenerate({ vertexCredential: credential, model: "custom-model", user: "Hello" }), "OK");
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.throws(() => parseVertexServiceAccount(credential.replace("crm-project", "crm-project/escape")));
  await assert.rejects(geminiGenerate({ vertexCredential: '{"type":"authorized_user"}', user: "Hello" }), /Invalid Google Cloud/);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("Vertex image generation uses the Vertex publisher endpoint", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `${root}/publishers/google/models/gemini-3.1-flash-image:generateContent`);
    assert.equal(options.headers.get("x-goog-api-key"), "vertex-key");
    return Response.json(candidate({ inlineData: { mimeType: "image/png", data: "AAAA" } }));
  });
  assert.deepEqual(await geminiGenerateImage({ vertexCredential: "vertex-key", prompt: "A tree" }), { mimeType: "image/png", data: "AAAA" });
});

test("Vertex translation keeps its credential separate from AI services", async t => {
  const patch = translationSettingsPatch({ aiProvider: "vertex", vertexCredential: "translation-key" });
  assert.equal(patch.translationProvider, "vertex");
  assert.equal(patch.translationApiKey, "translation-key");
  assert.equal(patch.vertexCredential, undefined);
  const settings = { aiProvider: "vertex", vertexCredential: "reply-key", translateService: "ai", ...patch };
  const translation = getTranslationSettings(settings);
  assert.equal(translation.aiProvider, "vertex");
  assert.equal(translation.vertexCredential, "translation-key");
  assert.equal(translation.aiModel, VERTEX_DEFAULT_MODEL);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `${root}/publishers/google/models/${VERTEX_DEFAULT_MODEL}:generateContent`);
    assert.equal(options.headers.get("x-goog-api-key"), "translation-key");
    return Response.json(candidate({ text: "请发送您的订单号。" }));
  });
  const result = await translateDraftText("Please send your order number.", "zh", settings);
  assert.equal(result.source, "vertex");
  assert.equal(result.text, "请发送您的订单号。");
});
