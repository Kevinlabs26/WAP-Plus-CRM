import test from "node:test";
import assert from "node:assert/strict";
import { LOCALES, normalizeLocale, translate } from "../src/i18n/core.ts";

test("desktop locales expose the same translation keys", () => {
  const localeKeys = Object.values(LOCALES).map(({ messages }) => Object.keys(messages).sort());
  for (const keys of localeKeys.slice(1)) {
    assert.deepEqual(keys, localeKeys[0]);
  }
});

test("locale normalization falls back safely", () => {
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("de"), "zh-CN");
  assert.equal(normalizeLocale(null), "zh-CN");
});

test("translations interpolate long values without truncating them", () => {
  const active = "Une image de fond avec un nom volontairement très long";
  const text = translate("fr", "appearance.chatBackgroundDesc", { active });
  assert.equal(text.endsWith(active), true);
  assert.equal(text.includes("{active}"), false);
});

test("monitor and health copy is fully translated outside Chinese", () => {
  for (const locale of ["en", "fr"]) {
    const entries = Object.entries(LOCALES[locale].messages).filter(
      ([key]) => key.startsWith("monitor.") || key.startsWith("health.")
    );
    assert.equal(entries.some(([, value]) => /\p{Script=Han}/u.test(value)), false);
  }
});

test("multi-window and settings copy is fully translated outside Chinese", () => {
  const prefixes = [
    "multi.",
    "settings",
    "baileysConnect.",
    "baileysLogin.",
    "contactImport.",
    "batchContacts.",
  ];
  for (const locale of ["en", "fr"]) {
    const entries = Object.entries(LOCALES[locale].messages).filter(([key]) =>
      prefixes.some((prefix) => key.startsWith(prefix))
    );
    assert.equal(entries.some(([, value]) => /\p{Script=Han}/u.test(value)), false);
  }
});
