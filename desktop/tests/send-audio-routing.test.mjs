import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/components/chat/sendAudioMessage.ts", import.meta.url),
  "utf8"
);

assert.match(source, /const raw = deps\.isBaileys\s*\n?\s*\?/);
assert.match(source, /baileysSendVoice\(recipient, dataUrl/);
assert.match(source, /isLongAudio\s*\?/);
assert.match(source, /baileysSendDocument\(recipient, dataUrl, file\.name/);
assert.match(source, /mediaType: isLongAudio \? "document" : "audio"/);
assert.match(source, /deps\.openAndroidMediaShare\(file, dataUrl, caption, recipient\)/);
assert.match(source, /deliveryStatus: "local"/);

console.log("send-audio-routing.test.mjs ok");
