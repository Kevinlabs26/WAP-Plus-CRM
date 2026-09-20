import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMessageLanguage,
  resolveTargetLang,
  translationMatchesTarget,
} from "../src/lib/translateDraft.ts";

const settings = { translateTargetLang: "en" };

test("detect: character-script languages", () => {
  assert.equal(detectMessageLanguage("你好，请问这个多少钱？"), "zh");
  assert.equal(detectMessageLanguage("こんにちは、いくらですか？"), "ja");
  assert.equal(detectMessageLanguage("안녕하세요 얼마예요?"), "ko");
  assert.equal(detectMessageLanguage("Здравствуйте, сколько стоит?"), "ru");
  assert.equal(detectMessageLanguage("مرحبا كم السعر؟"), "ar");
});

test("detect: latin languages by common words", () => {
  assert.equal(detectMessageLanguage("Bonjour, je voudrais le prix s'il vous plaît"), "fr");
  assert.equal(detectMessageLanguage("Hola buenos días, ¿cuánto cuesta?"), "es");
  assert.equal(detectMessageLanguage("Guten Tag, wie viel kostet das bitte?"), "de");
  assert.equal(detectMessageLanguage("Olá bom dia, quanto custa?"), "pt");
  assert.equal(detectMessageLanguage("Hello, how much does it cost?"), "en");
});

test("detect: short casual french with diacritics", () => {
  assert.equal(
    detectMessageLanguage("De mon côté ça va aussi bien mon frère."),
    "fr"
  );
  assert.equal(detectMessageLanguage("Merci beaucoup !"), "fr");
  assert.equal(detectMessageLanguage("Ça va bien, et toi ?"), "fr");
});

test("detect: very short phrases franc alone misses", () => {
  assert.equal(detectMessageLanguage("Guten Tag"), "de");
  assert.equal(detectMessageLanguage("oui merci"), "fr");
  assert.equal(detectMessageLanguage("ja bitte"), "de");
  assert.equal(detectMessageLanguage("sim obrigado"), "pt");
  assert.equal(detectMessageLanguage("sí gracias"), "es");
  assert.equal(detectMessageLanguage("danke schön"), "de");
});

test("detect: ambiguous latin returns null (use global default)", () => {
  assert.equal(detectMessageLanguage("ok"), null);
  assert.equal(detectMessageLanguage(""), null);
  assert.equal(detectMessageLanguage("👍👍"), null);
});

test("translation validation rejects a long English result labeled as Chinese", () => {
  const source = "Mon frère, j'ai un problème et je voudrais vous expliquer la situation.";
  assert.equal(
    translationMatchesTarget(
      source,
      "Bro, I have a problem and I would like to explain the situation.",
      "zh"
    ),
    false
  );
  assert.equal(
    translationMatchesTarget(source, "弟兄，我遇到了一个问题，想向你说明情况。", "zh"),
    true
  );
  assert.equal(
    translationMatchesTarget(
      "弟兄，我遇到了一个问题，想向你详细说明现在的情况。",
      "Brother, I have a problem and want to explain it.",
      "zh"
    ),
    false
  );
});

test("translation validation follows every selected target language", () => {
  assert.equal(translationMatchesTarget("Alexandre", "Alexandre", "zh"), true);
  assert.equal(
    translationMatchesTarget("Bonjour mon frère", "Hello my brother", "en"),
    true
  );
  const source = "Hello my brother, I would like to explain the situation clearly.";
  assert.equal(
    translationMatchesTarget(source, "Bonjour mon frère, je voudrais expliquer clairement la situation.", "fr"),
    true
  );
  assert.equal(
    translationMatchesTarget(source, "Hello my brother, I would like to explain the situation clearly.", "fr"),
    false
  );
  assert.equal(
    translationMatchesTarget(source, "안녕하세요 형제님, 상황을 자세히 설명하고 싶습니다.", "ko"),
    true
  );
});

test("resolveTargetLang: explicit preference wins", () => {
  const contact = { preferredLang: "fr", country: "" };
  assert.equal(resolveTargetLang(contact, settings, "hello there"), "fr");
});

test("resolveTargetLang: country heuristic wins over message", () => {
  const contact = { country: "Spain", preferredLang: "" };
  assert.equal(resolveTargetLang(contact, settings, "Bonjour le prix"), "es");
});

test("resolveTargetLang: auto-detects from last inbound message", () => {
  const contact = { country: "", preferredLang: "" };
  assert.equal(
    resolveTargetLang(contact, settings, "Bonjour, combien ça coûte ?"),
    "fr"
  );
  assert.equal(
    resolveTargetLang(contact, settings, "Hola, ¿cuál es el precio?"),
    "es"
  );
});

test("resolveTargetLang: falls back to global default", () => {
  const contact = { country: "", preferredLang: "" };
  assert.equal(resolveTargetLang(contact, settings, ""), "en");
});
