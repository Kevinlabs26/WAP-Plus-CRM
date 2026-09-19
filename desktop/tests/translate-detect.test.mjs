import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMessageLanguage,
  resolveTargetLang,
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
