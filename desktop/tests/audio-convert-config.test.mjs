import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../baileys-bridge/audioConvert.mjs", import.meta.url),
  "utf8"
);

assert.match(source, /"-avoid_negative_ts",\s*"make_zero"/);
assert.match(source, /parsed\.buf\.length > 14_000_000/);
assert.match(source, /"-b:a",\s*"64k"/);
assert.match(source, /MAX_WHATSAPP_AUDIO_SECONDS\s*=\s*600/);
assert.match(source, /"-t",\s*String\(MAX_WHATSAPP_AUDIO_SECONDS\)/);
assert.match(source, /new Uint8Array\(64\)/);
assert.match(source, /waveform/);

console.log("audio-convert-config ok");
