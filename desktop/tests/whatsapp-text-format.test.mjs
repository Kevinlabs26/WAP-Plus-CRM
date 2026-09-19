import test from "node:test";
import assert from "node:assert/strict";
import {
  splitWhatsAppFormatting,
  stripWhatsAppFormatting,
} from "../src/lib/utils.ts";

test("WhatsApp bold markers are removed and the content is marked bold", () => {
  assert.deepEqual(splitWhatsAppFormatting("Salut *Alexandre*, *Pascal*"), [
    { type: "text", value: "Salut " },
    { type: "bold", value: "Alexandre" },
    { type: "text", value: ", " },
    { type: "bold", value: "Pascal" },
  ]);
});

test("unclosed WhatsApp bold marker stays visible", () => {
  assert.deepEqual(splitWhatsAppFormatting("Salut *Alexandre"), [
    { type: "text", value: "Salut *Alexandre" },
  ]);
});

test("WhatsApp italic and strike markers are parsed", () => {
  assert.deepEqual(splitWhatsAppFormatting("_important_ ~ancien~"), [
    { type: "italic", value: "important" },
    { type: "text", value: " " },
    { type: "strike", value: "ancien" },
  ]);
});

test("sidebar preview removes only the WhatsApp bold markers", () => {
  assert.equal(
    stripWhatsAppFormatting("Salut *Alexandre*, rendez-vous à 13h"),
    "Salut Alexandre, rendez-vous à 13h"
  );
});
