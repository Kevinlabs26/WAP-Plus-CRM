import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  voiceDurationSeconds,
  voiceSignalLevel,
} from "../src/lib/voiceRecord.ts";
import {
  normalizeVoiceInputLanguage,
  resolveVoiceInputLanguageTag,
} from "../src/lib/voiceInputLanguage.ts";

test("voice duration requires a complete second", () => {
  assert.equal(voiceDurationSeconds(120), 0);
  assert.equal(voiceDurationSeconds(999), 0);
  assert.equal(voiceDurationSeconds(1000), 1);
  assert.equal(voiceDurationSeconds(2400), 2);
});

test("voice signal level distinguishes silence from microphone activity", () => {
  assert.equal(voiceSignalLevel(new Uint8Array([128, 128, 128])), 0);
  assert.ok(voiceSignalLevel(new Uint8Array([96, 128, 160])) > 0.4);
});

test("voice input language is independent from translation language", () => {
  assert.equal(normalizeVoiceInputLanguage("FR"), "fr");
  assert.equal(resolveVoiceInputLanguageTag("fr", "zh-CN"), "fr-FR");
  assert.equal(resolveVoiceInputLanguageTag("", "zh-CN"), "zh-CN");
});

test("browser speech only appends recognition results changed by this event", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/speechToText.ts"),
    "utf8"
  );
  assert.match(source, /for \(let i = event\.resultIndex \?\? 0;/);
});

test("AI transcription sends an explicitly selected language", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/transcribeVoice.ts"),
    "utf8"
  );
  assert.match(source, /form\.append\("language", language\)/);
});
